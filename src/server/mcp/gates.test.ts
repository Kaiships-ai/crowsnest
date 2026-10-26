import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sql } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { getSecretStore, setSecretStore } from "../../shared/secret-store";

import { UNSCRUBBED_LOCKED, type GateLevel } from "@/server/services/agent-journal";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];
let gates: typeof import("./gates");

const TOKEN = "sentinel-graph-token-77c1";

beforeAll(async () => {
  process.env.MEDIA_ROOT ??= mkdtempSync(path.join(os.tmpdir(), "crowsnest-media-"));
  ({ db, tables } = await import("@/server/db"));
  (await import("@/server/db/test-migrate")).migrate();
  ({ buildMcpServer } = await import("./mcp-server"));
  gates = await import("./gates");
});

const fetchSpy = vi.fn(async () => new Response("{}"));

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
  for (const t of [tables.gateDrafts, tables.plannedPosts, tables.secrets, tables.sealedSecrets]) await db.delete(t);
  const now = new Date().toISOString();
  await db.insert(tables.secrets).values({ name: "IG_GRAPH_TOKEN", value: TOKEN, updatedAt: now });
  await db.insert(tables.plannedPosts).values([
    { id: "p-draft", title: "Draft reel", createdAt: now, updatedAt: now },
    { id: "p-sched", title: "Scheduled reel", state: "scheduled", createdAt: now, updatedAt: now },
    { id: "p-failed", title: "Failed reel", state: "failed", attemptCount: 1, errorClass: "timeout", createdAt: now, updatedAt: now },
  ]);
});

afterEach(() => vi.unstubAllGlobals());

async function connect(server: McpServer) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "gates-test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const journalSince = (id: number) => db.select().from(tables.agentActions).all().filter((r) => r.id > id);
const lastJournalId = () => db.select().from(tables.agentActions).all().at(-1)?.id ?? 0;

test("a tool with no gate level fails registration and names the tool", () => {
  const levels: Record<string, GateLevel> = gates.TOOL_LEVELS;
  const tool = gates.gatedRegistrar(new McpServer({ name: "t", version: "0" }), levels);
  expect(() => tool("crowsnest_unleveled", { title: "x", description: "x", inputSchema: {} }, () => ({ content: [] }))).toThrow(
    "MCP tool crowsnest_unleveled has no gate level",
  );
});

test("the registered tools are exactly the 36 in TOOL_LEVELS", async () => {
  const { tools } = await (await connect(buildMcpServer())).listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(gates.TOOL_LEVELS).sort());
  expect(tools).toHaveLength(36);
});

test("every gate 2 tool stores a pending draft, journals scrubbed input, and never runs or calls out", async () => {
  const server = new McpServer({ name: "t", version: "0" });
  const levels = { ...gates.TOOL_LEVELS, fixture_publish: "gate2" } as const;
  const tool = gates.gatedRegistrar(server, levels);
  const ran = vi.fn();
  for (const name of Object.keys(levels).filter((n) => levels[n as keyof typeof levels] === "gate2")) {
    tool(name as keyof typeof levels, { title: name, description: name, inputSchema: { caption: z.string() } }, async () => {
      ran();
      await fetch("https://graph.facebook.com/publish");
      return { content: [] };
    });
  }
  const client = await connect(server);
  const before = lastJournalId();

  const res = await client.callTool({ name: "fixture_publish", arguments: { caption: `token ${TOKEN}` } });

  const out = res.structuredContent as { status: string; draftId: string };
  expect(out.status).toBe("pending_approval");
  expect(ran).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  const [draft] = db.select().from(tables.gateDrafts).all();
  expect(draft).toMatchObject({ id: out.draftId, tool: "fixture_publish", status: "pending", caller: "gates-test", rawInput: { caption: `token ${TOKEN}` } });
  const [row] = journalSince(before);
  expect(row).toMatchObject({ tool: "fixture_publish", gate: "gate2", result: "drafted", draftId: out.draftId, caller: "gates-test" });
  expect(row.input).toBe(JSON.stringify({ caption: "token [redacted]" }));
});

test("reads are not journaled", async () => {
  const client = await connect(buildMcpServer());
  const before = lastJournalId();
  await client.callTool({ name: "crowsnest_plans", arguments: {} });
  await client.callTool({ name: "crowsnest_channels", arguments: {} });
  expect(journalSince(before)).toEqual([]);
});

test("a gate 1 call writes a pending row before it runs and an outcome row after, with one call id", async () => {
  const client = await connect(buildMcpServer());
  const before = lastJournalId();
  const res = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: "p-draft", keyword: "GATES" } });
  expect(res.isError).toBeFalsy();
  const bad = await client.callTool({ name: "crowsnest_propose_plan", arguments: { period: "month", periodKey: "nope", agent: "claude", reels: [] } });
  expect(bad.isError).toBe(true);
  const rows = journalSince(before);
  expect(rows.map(({ tool, gate, result, caller }) => ({ tool, gate, result, caller }))).toEqual([
    { tool: "crowsnest_set_plan_fields", gate: "gate1", result: "pending", caller: "gates-test" },
    { tool: "crowsnest_set_plan_fields", gate: "gate1", result: "ok", caller: "gates-test" },
    { tool: "crowsnest_propose_plan", gate: "gate1", result: "pending", caller: "gates-test" },
    { tool: "crowsnest_propose_plan", gate: "gate1", result: "error", caller: "gates-test" },
  ]);
  expect(rows[0].callId).toBe(rows[1].callId);
  expect(rows[2].callId).not.toBe(rows[0].callId);
});

function fixtureTool(handler: () => void) {
  const server = new McpServer({ name: "t", version: "0" });
  gates.gatedRegistrar(server, { fixture_write: "free" })("fixture_write", { title: "w", description: "w", inputSchema: { note: z.string().optional() } }, () => {
    handler();
    return { content: [{ type: "text", text: "done" }] };
  });
  return connect(server);
}

test("a call whose pending row cannot be written fails closed and never runs", async () => {
  const ran = vi.fn();
  const client = await fixtureTool(ran);
  db.run(sql`CREATE TEMP TRIGGER journal_down BEFORE INSERT ON agent_actions WHEN NEW.result = 'pending' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  try {
    const res = await client.callTool({ name: "fixture_write", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ code: "JOURNAL_UNAVAILABLE" });
    expect(ran).not.toHaveBeenCalled();
  } finally {
    db.run(sql`DROP TRIGGER journal_down`);
  }
});

test("an outcome row that cannot be written keeps the result and never records a false error", async () => {
  const ran = vi.fn();
  const client = await fixtureTool(ran);
  const before = lastJournalId();
  db.run(sql`CREATE TEMP TRIGGER outcome_down BEFORE INSERT ON agent_actions WHEN NEW.result <> 'pending' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  try {
    const res = await client.callTool({ name: "fixture_write", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: "done" }]);
    expect(ran).toHaveBeenCalledOnce();
  } finally {
    db.run(sql`DROP TRIGGER outcome_down`);
  }
  expect(journalSince(before).map((r) => r.result)).toEqual(["pending"]);
});

test("input is journaled as unscrubbed-locked, never raw, while the secret store is locked", async () => {
  const store = getSecretStore();
  await db.delete(tables.secrets);
  await db.insert(tables.sealedSecrets).values({ name: "IG_GRAPH_TOKEN", sealed: "c2VhbGVk", updatedAt: new Date().toISOString() });
  setSecretStore({ ...store, isEncryptionAvailable: () => false });
  const client = await fixtureTool(() => {});
  const before = lastJournalId();
  try {
    await client.callTool({ name: "fixture_write", arguments: { note: `token ${TOKEN}` } });
  } finally {
    setSecretStore(store);
    await db.delete(tables.sealedSecrets);
  }
  expect(journalSince(before).map((r) => r.input)).toEqual([UNSCRUBBED_LOCKED, UNSCRUBBED_LOCKED]);
});

test("a secret with quotes or backslashes is scrubbed in its JSON-escaped form", async () => {
  const quoted = 'pa"ss\\word-77c1';
  await db.update(tables.secrets).set({ value: quoted });
  const client = await fixtureTool(() => {});
  const before = lastJournalId();
  await client.callTool({ name: "fixture_write", arguments: { note: `x ${quoted} y` } });
  expect(journalSince(before)[0].input).toBe(JSON.stringify({ note: "x [redacted] y" }));
});

test("attach_video takes only a draft: a scheduled or failed plan, which the scheduler can publish on its own, is refused", async () => {
  const client = await connect(buildMcpServer());
  const fixture = path.resolve("src/server/media/__fixtures__/tiny.mp4");
  for (const postId of ["p-sched", "p-failed"]) {
    const res = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId, path: fixture } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ code: "PLAN_NOT_DRAFT", postId });
  }
  const ok = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: "p-draft", path: fixture } });
  expect(ok.isError).toBeFalsy();
  const videos = Object.fromEntries(db.select().from(tables.plannedPosts).all().map((p) => [p.id, p.videoAssetId]));
  expect(videos["p-sched"]).toBeNull();
  expect(videos["p-failed"]).toBeNull();
  expect(videos["p-draft"]).not.toBeNull();
});

test("the journal is append-only", () => {
  db.insert(tables.agentActions).values({ callId: "c", at: "2026-01-01T00:00:00.000Z", caller: "x", tool: "t", input: "{}", result: "ok", gate: "free" }).run();
  expect(() => db.update(tables.agentActions).set({ caller: "y" }).run()).toThrow("append-only");
  expect(() => db.delete(tables.agentActions).run()).toThrow("append-only");
});
