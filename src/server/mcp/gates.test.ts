import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

import type { GateLevel } from "@/server/services/agent-journal";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];
let gates: typeof import("./gates");

const TOKEN = "sentinel-graph-token-77c1";

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  (await import("@/server/db/test-migrate")).migrate();
  ({ buildMcpServer } = await import("./mcp-server"));
  gates = await import("./gates");
});

const fetchSpy = vi.fn(async () => new Response("{}"));

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
  for (const t of [tables.gateDrafts, tables.plannedPosts, tables.secrets]) await db.delete(t);
  const now = new Date().toISOString();
  await db.insert(tables.secrets).values({ name: "IG_GRAPH_TOKEN", value: TOKEN, updatedAt: now });
  await db.insert(tables.plannedPosts).values({ id: "p-sched", title: "Scheduled reel", state: "scheduled", createdAt: now, updatedAt: now });
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

test("the registered tools are exactly the 38 in TOOL_LEVELS", async () => {
  const { tools } = await (await connect(buildMcpServer())).listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(gates.TOOL_LEVELS).sort());
  expect(tools).toHaveLength(38);
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

test("a gate 1 call runs as before and is journaled with its result", async () => {
  const client = await connect(buildMcpServer());
  const before = lastJournalId();
  const res = await client.callTool({ name: "crowsnest_set_plan_fields", arguments: { postId: "p-sched", keyword: "GATES" } });
  expect(res.isError).toBeFalsy();
  const bad = await client.callTool({ name: "crowsnest_propose_plan", arguments: { period: "month", periodKey: "nope", agent: "claude", reels: [] } });
  expect(bad.isError).toBe(true);
  expect(journalSince(before).map(({ tool, gate, result, caller }) => ({ tool, gate, result, caller }))).toEqual([
    { tool: "crowsnest_set_plan_fields", gate: "gate1", result: "ok", caller: "gates-test" },
    { tool: "crowsnest_propose_plan", gate: "gate1", result: "error", caller: "gates-test" },
  ]);
});

test("attach_video refuses a scheduled plan, so an agent cannot change what the scheduler publishes", async () => {
  const client = await connect(buildMcpServer());
  const res = await client.callTool({ name: "crowsnest_attach_video", arguments: { postId: "p-sched", path: "/tmp/never-read.mp4" } });
  expect(res.isError).toBe(true);
  expect(res.structuredContent).toMatchObject({ code: "PLAN_SCHEDULED", postId: "p-sched" });
});

test("the journal is append-only", () => {
  db.insert(tables.agentActions).values({ at: "2026-01-01T00:00:00.000Z", caller: "x", tool: "t", input: "{}", result: "ok", gate: "free" }).run();
  expect(() => db.update(tables.agentActions).set({ caller: "y" }).run()).toThrow("append-only");
  expect(() => db.delete(tables.agentActions).run()).toThrow("append-only");
});
