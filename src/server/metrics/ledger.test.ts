import { beforeAll, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const CHANGED_TARGET = 0.37;

vi.mock("@/server/metrics/ledger", async (orig) => {
  const real = await orig<typeof import("./ledger")>();
  return { ...real, METRIC_LEDGER: { ...real.METRIC_LEDGER, checkout_rate: { ...real.METRIC_LEDGER.checkout_rate, target: CHANGED_TARGET } } };
});

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  const { saveFunnel } = await import("@/server/services/funnel");
  saveFunnel({ agent: "claude", rows: [{ keyword: "TARGETKW", source: "umami", metric: "visits", value: 3, capturedAt: "2026-10-01T00:00:00Z" }] });
});

type Entry = { keyword: string; metrics: { id: string; target: number | null; status: string }[] };
const checkoutRate = (entries: Entry[]) => entries.find((e) => e.keyword === "TARGETKW")?.metrics.find((m) => m.id === "checkout_rate");

test("a target changed in the ledger reaches the MCP funnel tool, the board's bridge call, and the ledger call", async () => {
  const real = await vi.importActual<typeof import("./ledger")>("./ledger");
  expect(real.METRIC_LEDGER.checkout_rate.target).not.toBe(CHANGED_TARGET);

  const { buildMcpServer } = await import("@/server/mcp/mcp-server");
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([buildMcpServer().connect(serverT), client.connect(clientT)]);
  const mcp = await client.callTool({ name: "crowsnest_funnel", arguments: { keyword: "targetkw" } });
  expect(checkoutRate((mcp.structuredContent as { data: Entry[] }).data)).toMatchObject({ target: CHANGED_TARGET, status: "not-connected" });

  const { dispatchEngineCall } = await import("@/server/bridge/engine-calls");
  const board = await dispatchEngineCall("getFunnel", ["targetkw"]);
  expect(board.ok && checkoutRate(board.value as Entry[])).toMatchObject({ target: CHANGED_TARGET });

  const ledger = await dispatchEngineCall("getMetricLedger", []);
  expect(ledger).toMatchObject({ ok: true, value: { checkout_rate: { target: CHANGED_TARGET } } });
});
