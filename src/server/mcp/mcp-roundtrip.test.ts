import { beforeAll, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// A real client<->server round trip over the SDK's in-memory transport, instead of
// reaching into the private _registeredTools registry the other tests use (ENH-2). A
// round trip is what would have caught the "structuredContent must be a record" defect:
// the SDK validates the wire shape here, the internal registry call does not.
let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  ({ buildMcpServer } = await import("./mcp-server"));
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
  expect(tools.tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      "crowsnest_channels",
      "crowsnest_channel_stats",
      "crowsnest_research_set",
      "crowsnest_outlier_pack",
      "crowsnest_sync_selected",
      "crowsnest_sync_status",
      "crowsnest_sync_cancel",
      "crowsnest_save_analysis",
    ]),
  );
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
