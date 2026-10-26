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
  return JSON.parse(data.slice(6)).result;
}

async function journal(page) {
  const res = await call(page, "listAgentActions", 50);
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.value;
}

export default async function gates01({ page, step, snap }) {
  let newest = 0;
  await step("a read over MCP leaves no journal row", async () => {
    newest = (await journal(page))[0]?.id ?? 0;
    await mcp("crowsnest_plans", {});
    await mcp("crowsnest_channels", {});
    const after = (await journal(page)).filter((r) => r.id > newest);
    if (after.length) throw new Error(JSON.stringify(after));
  });
  await step("a gate 1 call is journaled with caller, scrubbed input, result, and gate", async () => {
    const res = await mcp("crowsnest_propose_plan", { period: "week", periodKey: "2026-W53", agent: "gates-01", reels: [{ key: "g1", title: "Gate one" }] });
    const rows = (await journal(page)).filter((r) => r.id > newest);
    const row = rows.find((r) => r.tool === "crowsnest_propose_plan");
    const expected = res.isError ? "error" : "ok";
    if (!row || row.gate !== "gate1" || row.result !== expected || row.caller !== "local" || !row.input.includes('"agent":"gates-01"')) throw new Error(JSON.stringify(rows));
    console.log(`journal row: ${JSON.stringify(row)}`);
  });
  await step("a free call is journaled as free", async () => {
    await mcp("crowsnest_save_funnel", { agent: "gates-01", rows: [{ keyword: "GATES01", source: "chatbotx", metric: "dms", value: 1, capturedAt: new Date(Date.now() - 60_000).toISOString() }] });
    const row = (await journal(page)).find((r) => r.tool === "crowsnest_save_funnel" && r.id > newest);
    if (row?.gate !== "free" || row.result !== "ok") throw new Error(JSON.stringify(row));
  });
  await snap("gates-01");
}
