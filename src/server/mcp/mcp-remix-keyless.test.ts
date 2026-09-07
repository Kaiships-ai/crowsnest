import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";

/**
 * P0 slice 2b: the MCP remix chain is keyless end to end. No internal model (getLlm) is
 * ever called anywhere in this chain — the three generate stages (hooks, outline,
 * variants) return an assembled { system, user, context } prompt for the calling agent
 * to fulfill itself, instead of calling Claude. Proven here by deleting
 * ANTHROPIC_API_KEY before running the whole chain: if any handler under test still
 * called getLlm(), it would throw NoApiKeyError and the tool call would come back
 * isError:true — so a clean run through session -> set_prompt -> research -> hooks ->
 * choose_hook -> style -> outline -> save_script -> finish -> brief is itself the proof.
 */

// registerTool's callback isn't part of McpServer's public type — same internal-registry
// pattern the other mcp-server tests use to call a tool directly without a client/
// transport pair.
function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ structuredContent: unknown; isError?: boolean }> }>;
  })._registeredTools;
  return registry[name].handler(args, {});
}

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];

beforeAll(async () => {
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ buildMcpServer } = await import("./mcp-server"));
  migrate();
});

async function seedVideo(): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const now = new Date().toISOString();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@keyless-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `keyless-${videoId}`,
    url: "https://example.com/p", postedAt: now, firstSeenAt: now,
  });
  return videoId;
}

test("P0 slice 2b: remix chain runs end to end with no ANTHROPIC_API_KEY set — no handler calls getLlm", async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const videoId = await seedVideo();
    const server = buildMcpServer();

    // 1. Save an agent-authored analysis so research/hooks/outline have real source
    //    material, same as an external agent would via crowsnest_save_analysis.
    const saved = await callTool(server, "crowsnest_save_analysis", {
      videoId,
      hookType: "curiosity-gap",
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "opens with a question", transcript: "here is the mistake" }],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut"],
      whyItWorked: "cold-open question kept retention high",
    });
    expect(saved.isError).not.toBe(true);

    // 2. session
    const session = await callTool(server, "crowsnest_remix_session", { videoId });
    expect(session.isError).not.toBe(true);
    const sessionId = (session.structuredContent as { id: string }).id;

    // 3. set_prompt
    const setPrompt = await callTool(server, "crowsnest_remix_set_prompt", { sessionId, topic: "the biggest mistake beginners make", niche: "fitness" });
    expect(setPrompt.isError).not.toBe(true);

    // 4. research — already documented as "no model call"
    const research = await callTool(server, "crowsnest_remix_research", { sessionId });
    expect(research.isError).not.toBe(true);

    // 5. hooks — returns a prompt, not generated hooks
    const hooks = await callTool(server, "crowsnest_remix_hooks", { sessionId });
    expect(hooks.isError).not.toBe(true);
    const hookPrompt = hooks.structuredContent as { system: string; user: string; context: unknown };
    expect(typeof hookPrompt.system).toBe("string");
    expect(hookPrompt.system.length).toBeGreaterThan(0);
    // niche comes from the global niche profile setting, not the session's own `niche`
    // field — same source generateHooks always read, preserved as-is here.
    expect(hookPrompt.user).toContain("the biggest mistake beginners make");
    expect(hookPrompt.user).toContain("curiosity-gap");

    // 6. choose_hook — the agent's own text, no generated options involved
    const chosenHook = "Here's the one mistake nobody warns you about";
    const chooseHook = await callTool(server, "crowsnest_remix_choose_hook", { sessionId, hook: chosenHook });
    expect(chooseHook.isError).not.toBe(true);

    // 7. style
    const style = await callTool(server, "crowsnest_remix_style", { sessionId });
    expect(style.isError).not.toBe(true);

    // 8. outline — with no outline arg, returns a prompt
    const outline = await callTool(server, "crowsnest_remix_outline", { sessionId });
    expect(outline.isError).not.toBe(true);
    const outlinePrompt = outline.structuredContent as { system: string; user: string; context: unknown };
    expect(typeof outlinePrompt.system).toBe("string");
    expect(outlinePrompt.user).toContain(chosenHook);

    // 8b. outline — WITH an outline, saves it onto the session. This is the bug fix:
    // buildScriptPrompt reads session.outline, which was always empty on the keyless
    // path before this (the agent had a prompt to fulfill but no way to save its
    // result back), so the script prompt silently fell back to the "no outline beats
    // yet" placeholder instead of carrying the agent's real beats.
    const agentOutline = { beats: [{ label: "Hook", content: "Open with the mistake", targetSec: 3 }, { label: "Payoff", content: "Reveal the fix", targetSec: 20 }] };
    const saveOutline = await callTool(server, "crowsnest_remix_outline", { sessionId, outline: agentOutline });
    expect(saveOutline.isError).not.toBe(true);
    expect((saveOutline.structuredContent as { ok: boolean }).ok).toBe(true);

    // Also prove crowsnest_remix_variants returns a prompt (not generated variants),
    // with context.angles for the agent to write more than one take if it wants to,
    // and that its user prompt carries the agent's OWN saved outline beats, not the
    // "(no outline beats yet)" placeholder.
    const variants = await callTool(server, "crowsnest_remix_variants", { sessionId });
    expect(variants.isError).not.toBe(true);
    const scriptPrompt = variants.structuredContent as { system: string; user: string; context: { angles?: string[] } };
    expect(typeof scriptPrompt.system).toBe("string");
    expect(scriptPrompt.user).toContain(chosenHook);
    expect(scriptPrompt.user).toContain("Open with the mistake");
    expect(scriptPrompt.user).toContain("Reveal the fix");
    expect(scriptPrompt.user).not.toContain("no outline beats yet");
    expect(Array.isArray(scriptPrompt.context.angles)).toBe(true);
    expect((scriptPrompt.context.angles ?? []).length).toBeGreaterThan(0);

    // 9. save_script — the agent's own script text, no variantIndex
    const agentScript = "Here's the one mistake nobody warns you about.\n[VISUAL] close-up, direct to camera.\n...";
    const saveScript = await callTool(server, "crowsnest_remix_save_script", { sessionId, title: "Keyless remix", script: agentScript });
    expect(saveScript.isError).not.toBe(true);
    const scriptId = (saveScript.structuredContent as { scriptId: string }).scriptId;
    expect(typeof scriptId).toBe("string");

    const [scriptRow] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId));
    expect(scriptRow.content).toBe(agentScript);
    expect(scriptRow.title).toBe("Keyless remix");

    // 10. finish — creates the planned post carrying that script
    const finish = await callTool(server, "crowsnest_remix_finish", { sessionId });
    expect(finish.isError).not.toBe(true);
    const finishBody = finish.structuredContent as { postId: string; created: boolean; scriptId: string | null };
    expect(finishBody.created).toBe(true);
    expect(finishBody.scriptId).toBe(scriptId);

    // 11. brief — reads the planned post back
    const brief = await callTool(server, "crowsnest_brief", { postId: finishBody.postId });
    expect(brief.isError).not.toBe(true);
    const briefBody = brief.structuredContent as { plan: { scriptId: string | null }; remix: { session: { chosenHook: string | null } } | null };
    expect(briefBody.plan.scriptId).toBe(scriptId);
    expect(briefBody.remix?.session.chosenHook).toBe(chosenHook);
  } finally {
    if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

test("crowsnest_remix_regenerate_variant is no longer on the MCP surface", async () => {
  const server = buildMcpServer();
  const registry = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  expect(registry).not.toHaveProperty("crowsnest_remix_regenerate_variant");
});
