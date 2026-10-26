import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const state = (file) => readFileSync(path.join(import.meta.dirname, "../../../../../data/verify/app", file), "utf8").trim();
const port = state("mcp.port");
const token = state("mcp.token");

async function mcp(name, args) {
  const res = await fetch(`http://localhost:${port}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const data = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(JSON.parse(data.slice(6)).result.content[0].text);
}

const metric = (entries, id) => entries.find((e) => e.keyword === "LEDGER01")?.metrics.find((m) => m.id === id);

export default async function funnel01({ page, step, snap }) {
  let ledger;
  await step("the bridge returns the metric ledger", async () => {
    const res = await call(page, "getMetricLedger");
    if (!res.ok || res.value.checkout_rate?.numerator !== "checkout") throw new Error(JSON.stringify(res));
    ledger = res.value;
    console.log(`getMetricLedger: ${Object.keys(ledger).join(", ")}`);
  });
  await step("an agent saves funnel rows over MCP", async () => {
    const saved = await mcp("crowsnest_save_funnel", { agent: "verify", rows: [{ keyword: "LEDGER01", source: "chatbotx", metric: "dms", value: 12, capturedAt: new Date(Date.now() - 60_000).toISOString() }] });
    if (saved.saved !== 1) throw new Error(JSON.stringify(saved));
  });
  await step("MCP and the bridge read the same ledger numbers", async () => {
    const fromMcp = await mcp("crowsnest_funnel", { keyword: "ledger01" });
    const fromBridge = await call(page, "getFunnel", "ledger01");
    if (!fromBridge.ok) throw new Error(JSON.stringify(fromBridge));
    for (const entries of [fromMcp, fromBridge.value]) {
      const dm = metric(entries, "dm");
      const rate = metric(entries, "checkout_rate");
      if (dm?.status !== "value" || dm.value !== 12) throw new Error(`dm ${JSON.stringify(dm)}`);
      if (rate?.target !== ledger.checkout_rate.target) throw new Error(`checkout_rate ${JSON.stringify(rate)}`);
    }
    console.log(`dm: ${JSON.stringify(metric(fromMcp, "dm"))}`);
  });
  await step("a metric with no source reads not-connected, never 0", async () => {
    const res = await call(page, "getFunnel", "ledger01");
    const checkout = metric(res.value, "checkout");
    if (checkout?.status !== "not-connected" || "value" in checkout) throw new Error(JSON.stringify(checkout));
    console.log(`checkout: ${JSON.stringify(checkout)}`);
  });
  await snap("funnel-01");
}
