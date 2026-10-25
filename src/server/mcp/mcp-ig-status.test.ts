/**
 * crowsnest_ig_status: sidecar readiness for an external MCP agent, so a sync attempt
 * against a down sidecar isn't the agent's first signal that it needs one. Mocks
 * getIgStatusAction the same way sidecar-actions.test.ts does — no real health probe
 * fires here, this is only about how the MCP tool shapes that result.
 */
import { beforeEach, expect, test, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mocks = vi.hoisted(() => ({
  getIgStatusAction: vi.fn(),
}));

vi.mock("@/server/actions/ig-actions", () => mocks);

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

test("crowsnest_ig_status reports reachable=true and loggedIn when the health probe is up", async () => {
  mocks.getIgStatusAction.mockResolvedValue({
    ok: true,
    status: { loggedIn: true, credentialsConfigured: true, username: "burner", instagrapiVersion: "2.0.0", sessionLoaded: true, cooldownUntil: null },
  });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_ig_status", {});

  expect(r.isError).not.toBe(true);
  expect(r.structuredContent).toMatchObject({ reachable: true, loggedIn: true, bootstrap: "pnpm run ig:service" });
});

test("crowsnest_ig_status reports a future cooldown as retryAfterSec", async () => {
  const cooldownUntil = new Date(Date.now() + 30_000).toISOString();
  mocks.getIgStatusAction.mockResolvedValue({
    ok: true,
    status: { loggedIn: false, credentialsConfigured: true, username: null, instagrapiVersion: "2.0.0", sessionLoaded: false, cooldownUntil },
  });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_ig_status", {});

  expect(r.structuredContent).toMatchObject({ reachable: true, loggedIn: false });
  expect((r.structuredContent as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
});

test("crowsnest_ig_status stays reachable=true when the sidecar answers with a non-down error", async () => {
  // A sidecar that responds but reports drift or an unauthorized session has still
  // answered: reachable must stay true, so the agent does not bootstrap a running sidecar.
  mocks.getIgStatusAction.mockResolvedValue({
    ok: false,
    error: "Session drifted from the configured account.",
    code: "IG_DRIFT",
    retryable: false,
    needsUserAction: true,
  });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_ig_status", {});

  expect(r.isError).not.toBe(true);
  expect(r.structuredContent).toMatchObject({ reachable: true });
});

test("crowsnest_ig_status reports reachable=false and the bootstrap command when the sidecar is down", async () => {
  mocks.getIgStatusAction.mockResolvedValue({
    ok: false,
    error: "Instagram service is not reachable.",
    code: "IG_SERVICE_DOWN",
    retryable: true,
    needsUserAction: false,
  });
  const server = buildMcpServer();

  const r = await callTool(server, "crowsnest_ig_status", {});

  expect(r.isError).not.toBe(true);
  expect(r.structuredContent).toMatchObject({ reachable: false, loggedIn: null, bootstrap: "pnpm run ig:service" });
});
