import { beforeAll, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

// A real client<->server round trip over the SDK's in-memory transport, instead of
// reaching into the private _registeredTools registry the other tests use (ENH-2). A
// round trip is what would have caught the "structuredContent must be a record" defect:
// the SDK validates the wire shape here, the internal registry call does not.
let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];
let handleMcpRequest: typeof import("./http")["handleMcpRequest"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  process.env.MEDIA_ROOT ??= mkdtempSync(path.join(os.tmpdir(), "crowsnest-media-"));
  ({ buildMcpServer } = await import("./mcp-server"));
  ({ handleMcpRequest } = await import("./http"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

async function connectedClient() {
  const server = buildMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

test("a client can list the new read and write tools over a real transport", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "crowsnest_channels",
      "crowsnest_channel_stats",
      "crowsnest_research_set",
      "crowsnest_outlier_pack",
      "crowsnest_sync_selected",
      "crowsnest_sync_status",
      "crowsnest_sync_cancel",
      "crowsnest_ig_status",
      "crowsnest_save_analysis",
      "crowsnest_save_artifact",
      "crowsnest_artifacts",
      // P0 slice 2b: the remix generate stages are prompt providers, not generators —
      // still on the surface, just reshaped — and save_script takes the agent's own
      // script text.
      "crowsnest_remix_hooks",
      "crowsnest_remix_outline",
      "crowsnest_remix_variants",
      "crowsnest_remix_save_script",
      "crowsnest_set_plan_fields",
      "crowsnest_attach_video",
      "crowsnest_save_funnel",
      "crowsnest_funnel",
      "crowsnest_propose_plan",
      "crowsnest_plan_versions",
      "crowsnest_approve_plan",
      "crowsnest_undo_plan",
    ]),
  );
  // regenerate_variant made no sense once there are no crowsnest-generated variants to
  // regenerate — the calling agent just re-fulfills crowsnest_remix_variants' prompt.
  expect(names).not.toContain("crowsnest_remix_regenerate_variant");
});

test("crowsnest_remix_save_script's schema takes the agent's own script text, not a variant index", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const saveScript = tools.tools.find((t) => t.name === "crowsnest_remix_save_script");
  expect(saveScript).toBeDefined();
  const props = (saveScript?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  expect(props).toHaveProperty("script");
  expect(props).toHaveProperty("title");
  expect(props).toHaveProperty("sessionId");
  expect(props).not.toHaveProperty("variantIndex");
});

test("crowsnest_remix_hooks and crowsnest_remix_outline return a { system, user, context } prompt over the wire", async () => {
  const client = await connectedClient();
  const { db, tables, newId } = await import("@/server/db");
  const channelId = newId();
  const videoId = newId();
  const now = new Date().toISOString();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@rt-remix-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `rt-remix-${videoId}`,
    url: "https://example.com/p", postedAt: now, firstSeenAt: now,
  });

  const session = await client.callTool({ name: "crowsnest_remix_session", arguments: { videoId } });
  expect(session.isError).not.toBe(true);
  const sessionId = (session.structuredContent as { id: string }).id;

  const hooks = await client.callTool({ name: "crowsnest_remix_hooks", arguments: { sessionId } });
  expect(hooks.isError).not.toBe(true);
  expect(hooks.structuredContent).toHaveProperty("system");
  expect(hooks.structuredContent).toHaveProperty("user");
  expect(hooks.structuredContent).toHaveProperty("context");
});

test("crowsnest_remix_outline's schema takes an optional outline to save, bidirectional like choose_hook", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const outlineTool = tools.tools.find((t) => t.name === "crowsnest_remix_outline");
  expect(outlineTool).toBeDefined();
  const props = (outlineTool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  expect(props).toHaveProperty("outline");
  expect(props).toHaveProperty("sessionId");
});

test("crowsnest_channels returns a well-formed (record) structuredContent over the wire", async () => {
  const client = await connectedClient();
  const res = await client.callTool({ name: "crowsnest_channels", arguments: {} });
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toHaveProperty("channels");
});

test("crowsnest_sync_selected's non-empty guard surfaces as isError over the wire", async () => {
  const client = await connectedClient();
  const res = await client.callTool({ name: "crowsnest_sync_selected", arguments: { channelIds: [] } });
  expect(res.isError).toBe(true);
});

test("crowsnest_save_artifact persists an agent-authored idea bank and crowsnest_artifacts reads it back", async () => {
  const client = await connectedClient();
  const ideas = Array.from({ length: 120 }, (_, i) => ({ concept: `idea ${i}`, angle: "curiosity" }));

  const saved = await client.callTool({
    name: "crowsnest_save_artifact",
    arguments: {
      kind: "idea_bank",
      title: "120 ideas for launch week",
      data: { ideas },
      agent: "claude",
      model: "claude-opus-4-8",
      sourceVideoIds: ["v1", "v2"],
      assumptions: "audience skews technical founders",
    },
  });
  expect(saved.isError).not.toBe(true);
  const { id, artifact } = saved.structuredContent as { id: string; artifact: { data: { ideas: unknown[] }; agent: string } };
  expect(id).toBeTruthy();
  // 100+ ideas in one artifact: the flat idea table's one-per-video cap does not apply here.
  expect(artifact.data.ideas).toHaveLength(120);
  expect(artifact.agent).toBe("claude");

  // read one back by id
  const byId = await client.callTool({ name: "crowsnest_artifacts", arguments: { id } });
  expect(byId.isError).not.toBe(true);
  expect((byId.structuredContent as { id: string }).id).toBe(id);

  // list by kind
  const byKind = await client.callTool({ name: "crowsnest_artifacts", arguments: { kind: "idea_bank" } });
  expect(byKind.isError).not.toBe(true);
  const list = byKind.structuredContent as { total: number; items: { id: string }[] };
  expect(list.total).toBeGreaterThanOrEqual(1);
  expect(list.items.some((i) => i.id === id)).toBe(true);
});

test("crowsnest_save_artifact rejects an unknown kind over the wire", async () => {
  const client = await connectedClient();
  const res = await client.callTool({
    name: "crowsnest_save_artifact",
    arguments: { kind: "not_a_kind", title: "x", data: { a: 1 }, agent: "claude" },
  });
  expect(res.isError).toBe(true);
});

test("crowsnest_set_plan_fields sets keyword and guide link, crowsnest_plans reads them back, a taken keyword is refused", async () => {
  const { db, tables, newId, nowIso } = await import("@/server/db");
  const a = newId();
  const b = newId();
  await db.insert(tables.plannedPosts).values([
    { id: a, state: "draft", title: "A", createdAt: nowIso(), updatedAt: nowIso() },
    { id: b, state: "draft", title: "B", createdAt: nowIso(), updatedAt: nowIso() },
  ]);
  const client = await connectedClient();

  const set = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: a, keyword: "PLUGIN", magnetUrl: "https://example.com/guide" } });
  expect(set.isError).not.toBe(true);

  const plans = await client.callTool({ name: "crowsnest_plans", arguments: {} });
  const rowA = (plans.structuredContent as { data: { id: string; keyword: string | null; magnetUrl: string | null }[] }).data.find((p) => p.id === a);
  expect(rowA).toMatchObject({ keyword: "PLUGIN", magnetUrl: "https://example.com/guide" });

  const taken = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: b, keyword: "plugin", magnetUrl: "https://example.com/other" } });
  expect(taken.isError).toBe(true);
  expect((taken.structuredContent as { code: string }).code).toBe("KEYWORD_TAKEN");
  const [rowB] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, b));
  expect(rowB).toMatchObject({ keyword: null, magnetUrl: null });

  const brief = await client.callTool({ name: "crowsnest_brief", arguments: { postId: a } });
  expect((brief.structuredContent as { plan: unknown }).plan).toMatchObject({ keyword: "PLUGIN", magnetUrl: "https://example.com/guide" });

  for (const magnetUrl of ["not a url", "javascript:alert(1)", "http:foo", "https://example.com/a\nb"]) {
    const badUrl = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: b, magnetUrl } });
    expect(badUrl.structuredContent).toMatchObject({ code: "PLAN_MAGNET_URL_INVALID", postId: b, error: expect.any(String) });
  }
  for (const keyword of ["  ", "X".repeat(65), "A\u2028B"]) {
    const badKeyword = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: b, keyword } });
    expect(badKeyword.structuredContent).toMatchObject({ code: "PLAN_KEYWORD_INVALID", postId: b, error: expect.any(String) });
  }

  const cleared = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: a, keyword: null } });
  expect(cleared.structuredContent).toMatchObject({ keyword: null, magnetUrl: "https://example.com/guide" });

  const missing = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: "no-such-plan", keyword: "X" } });
  expect((missing.structuredContent as { code: string }).code).toBe("PLAN_NOT_FOUND");

  const retake = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: b, keyword: "plugin" } });
  expect(retake.isError).not.toBe(true);
});

test("crowsnest_attach_video attaches a real mp4, dedupes the asset, and refuses an unknown or published plan", async () => {
  const { db, tables, newId, nowIso } = await import("@/server/db");
  const fixture = path.join(__dirname, "..", "media", "__fixtures__", "tiny.mp4");
  const [a, b, done] = [newId(), newId(), newId()];
  await db.insert(tables.plannedPosts).values([
    { id: a, state: "draft", title: "A", createdAt: nowIso(), updatedAt: nowIso() },
    { id: b, state: "draft", title: "B", createdAt: nowIso(), updatedAt: nowIso() },
    { id: done, state: "published", title: "Done", createdAt: nowIso(), updatedAt: nowIso() },
  ]);
  const client = await connectedClient();
  const assetsBefore = (await db.select().from(tables.mediaAssets)).length;

  const attached = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: a, path: fixture } });
  expect(attached.isError).not.toBe(true);
  const assetId = (attached.structuredContent as { videoAssetId: string | null }).videoAssetId;
  expect(assetId).toEqual(expect.any(String));

  await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: b, path: fixture } });
  const [rowB] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, b));
  expect(rowB.videoAssetId).toBe(assetId);

  const noPlan = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: "no-such-plan", path: fixture } });
  expect((noPlan.structuredContent as { code: string }).code).toBe("PLAN_NOT_FOUND");

  const locked = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: done, path: fixture } });
  expect((locked.structuredContent as { code: string }).code).toBe("PLAN_LOCKED");

  const [doneRow] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, done));
  expect(doneRow.videoAssetId).toBeNull();

  const relative = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: a, path: path.relative(process.cwd(), fixture) } });
  expect(relative.isError).toBe(true);

  const empty = path.join(mkdtempSync(path.join(os.tmpdir(), "crowsnest-empty-")), "empty.mp4");
  writeFileSync(empty, "");
  const emptyRes = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: a, path: empty } });
  expect((emptyRes.structuredContent as { code: string }).code).toBe("PLAN_EMPTY_FILE");

  const missing = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: a, path: "/no/such/file.mp4" } });
  expect((missing.structuredContent as { code: string }).code).toBe("PLAN_FILE_MISSING");

  expect((await db.select().from(tables.mediaAssets)).length).toBe(assetsBefore + 1);
});

test("/api/mcp refuses a non-local Host or Origin and serves a local client", async () => {
  const server = http.createServer((req, res) => void handleMcpRequest(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const send = (headers: Record<string, string>, method = "POST") =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { port, path: "/api/mcp", method, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end(method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) : undefined);
    });
  const call = async (headers: Record<string, string>, method?: string) => (await send(headers, method)).status;
  try {
    expect(await call({ host: `localhost:${port}` })).toBe(200);
    expect(await call({ host: `[::1]:${port}`, origin: `http://127.0.0.1:${port}` })).toBe(200);
    expect(await call({ host: "evil.example" })).toBe(403);
    expect(await call({ host: `localhost.evil.example:${port}` })).toBe(403);
    expect(await call({ host: `localhost:${port}`, origin: "http://evil.example" })).toBe(403);
    expect(await call({ host: `localhost:${port}`, origin: "null" })).toBe(403);
    expect(await call({ host: `LOCALHOST:${port}` })).not.toBe(403);
    expect(await call({ host: "[::1]" })).toBe(200);
    expect(await call({ host: "evil.example" }, "GET")).toBe(403);
    expect(await call({ host: "evil.example" }, "DELETE")).toBe(403);
    const refused = await send({ host: "evil.example" });
    expect(JSON.parse(refused.body)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "crowsnest MCP only answers local clients." },
      id: null,
    });
  } finally {
    server.close();
  }
});

test("crowsnest_save_funnel writes a batch and crowsnest_funnel reads the latest value with its plan", async () => {
  const { db, tables, newId, nowIso } = await import("@/server/db");
  const id = newId();
  await db.insert(tables.plannedPosts).values({ id, state: "draft", title: "Funnel", keyword: "FUNNELKW", createdAt: nowIso(), updatedAt: nowIso() });
  const client = await connectedClient();

  const saved = await client.callTool({ name: "crowsnest_save_funnel", arguments: { agent: "claude", rows: [
    { keyword: "funnelkw", source: "chatbotx", metric: "dms", value: 5, capturedAt: "2026-10-01T00:00:00Z" },
    { keyword: "FUNNELKW", source: "chatbotx", metric: "dms", value: 9, capturedAt: "2026-10-02T00:00:00Z" },
  ] } });
  expect(saved.structuredContent).toEqual({ ok: true, saved: 2 });

  const bad = await client.callTool({ name: "crowsnest_save_funnel", arguments: { agent: "claude", rows: [
    { keyword: "FUNNELKW", source: "chatbotx", metric: "dms", value: 1, capturedAt: "2026-10-01T00:00:00Z" },
    { keyword: "FUNNELKW", source: "nope", metric: "dms", value: 1, capturedAt: "2026-10-01T00:00:00Z" },
  ] } });
  expect(bad.isError).toBe(true);
  expect(bad.structuredContent).toMatchObject({ code: "INVALID_ROWS", error: expect.stringContaining("rows[1].source") });

  const read = await client.callTool({ name: "crowsnest_funnel", arguments: { keyword: "funnelkw" } });
  const rows = (read.structuredContent as { data: { keyword: string; value: number; plan: unknown }[] }).data;
  expect(rows).toEqual([expect.objectContaining({ value: 9, plan: { id, title: "Funnel" } })]);
});

test("plan versions propose, diff, approve and undo over the wire", async () => {
  const client = await connectedClient();
  const ref = { period: "week", periodKey: "2026-W30" };
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const reel = (key: string, title: string) => ({ key, title, date: "2026-07-21" });

  const bad = await call("crowsnest_propose_plan", { ...ref, agent: "claude", reels: [] });
  expect(bad).toMatchObject({ isError: true, structuredContent: { code: "INVALID_PLAN" } });
  const badPeriod = await call("crowsnest_propose_plan", { period: "year", periodKey: "2026", agent: "claude", reels: [reel("a", "A")] });
  expect(badPeriod).toMatchObject({ isError: true, structuredContent: { code: "INVALID_PLAN" } });
  const noTitle = await call("crowsnest_propose_plan", { ...ref, agent: "claude", reels: [{ key: "a" }] });
  expect(noTitle).toMatchObject({ isError: true, structuredContent: { code: "INVALID_PLAN" } });
  const noAgent = await call("crowsnest_propose_plan", { ...ref });
  expect(noAgent).toMatchObject({ isError: true, structuredContent: { code: "INVALID_PLAN" } });
  const v1 = (await call("crowsnest_propose_plan", { ...ref, agent: "claude", reels: [reel("a", "Hook A"), reel("b", "Hook B")] })).structuredContent as { id: string; version: number };
  const v2 = (await call("crowsnest_propose_plan", { ...ref, agent: "claude", reels: [reel("a", "Hook A"), reel("b", "Hook B2")] })).structuredContent as { id: string };
  expect(v1.version).toBe(1);

  const versions = (await call("crowsnest_plan_versions", ref)).structuredContent as { data: { version: number; status: string; diff: string }[] };
  expect(versions.data.map((v) => [v.version, v.status, v.diff])).toEqual([[2, "proposed", "vs v1: changed Hook B2 (title)"], [1, "proposed", "first version"]]);

  expect((await call("crowsnest_approve_plan", { versionId: v1.id })).structuredContent).toMatchObject({ ok: true, created: 2 });
  expect((await call("crowsnest_approve_plan", { versionId: v2.id })).structuredContent).toMatchObject({ ok: true, updated: 2, created: 0 });
  expect((await call("crowsnest_undo_plan", ref)).structuredContent).toMatchObject({ ok: true, live: { id: v1.id, version: 1 } });
  const undoNone = await call("crowsnest_undo_plan", { period: "week", periodKey: "2026-W31" });
  expect(undoNone.structuredContent).toMatchObject({ code: "NOTHING_TO_UNDO" });
});
