/**
 * The happy path for crowsnest_sync_selected, isolated so it can mock the sync action
 * without a real sidecar or a detached run. The main mcp-server.test.ts covers the
 * empty-channelIds rejection against the real action; this one confirms that a non-empty
 * call passes the guard, reaches startSyncAction, and surfaces the job id it returns.
 */
import { beforeEach, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mocks = vi.hoisted(() => ({
  startSyncAction: vi.fn(),
  getSyncProgressAction: vi.fn(),
  getChannelSyncProgressAction: vi.fn(),
  cancelSyncAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);

import { buildMcpServer } from "./mcp-server";

function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ structuredContent: unknown; isError?: boolean }> }>;
  })._registeredTools;
  return registry[name].handler(args, {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("crowsnest_sync_selected passes non-empty ids to startSyncAction and returns the jobId", async () => {
  mocks.startSyncAction.mockResolvedValue({ ok: true, jobId: "job-1" });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_sync_selected", { channelIds: ["c1", "c2"] });

  expect(mocks.startSyncAction).toHaveBeenCalledTimes(1);
  expect(mocks.startSyncAction).toHaveBeenCalledWith(["c1", "c2"]);
  expect(r.isError).not.toBe(true);
  expect(r.structuredContent).toMatchObject({ jobId: "job-1" });
});

test("crowsnest_sync_selected surfaces a refused start as a handled error, not a throw", async () => {
  mocks.startSyncAction.mockResolvedValue({ ok: false, error: "A sync is already running", code: "SYNC_ALREADY_RUNNING" });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_sync_selected", { channelIds: ["c1"] });

  expect(r.isError).toBe(true);
  expect(r.structuredContent).toMatchObject({ code: "SYNC_ALREADY_RUNNING" });
});

test("crowsnest_sync_selected's sidecar-down error carries the exact bootstrap command", async () => {
  mocks.startSyncAction.mockResolvedValue({ ok: false, error: "The Instagram service isn't running.", code: "IG_SERVICE_DOWN" });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_sync_selected", { channelIds: ["c1"] });

  expect(r.isError).toBe(true);
  expect(r.structuredContent).toMatchObject({ code: "IG_SERVICE_DOWN", bootstrap: "pnpm run ig:service" });
});

test("crowsnest_sync_selected's non-sidecar error does not carry a bootstrap field", async () => {
  mocks.startSyncAction.mockResolvedValue({ ok: false, error: "A sync is already running", code: "SYNC_ALREADY_RUNNING" });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_sync_selected", { channelIds: ["c1"] });

  expect(r.structuredContent).not.toHaveProperty("bootstrap");
});
