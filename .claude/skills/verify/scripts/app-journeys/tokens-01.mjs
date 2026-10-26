import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const port = readFileSync(path.join(import.meta.dirname, "../../../../../data/verify/app/mcp.port"), "utf8").trim();

async function bridge(page, name, ...args) {
  const res = await call(page, name, ...args);
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.value;
}

async function mcp(token, name, args) {
  return fetch(`http://localhost:${port}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

const freeCall = (token) =>
  mcp(token, "crowsnest_save_funnel", { agent: "tokens-01", rows: [{ keyword: "TOKENS01", source: "chatbotx", metric: "dms", value: 1, capturedAt: new Date(Date.now() - 60_000).toISOString() }] });

export default async function tokens01({ page, step, snap }) {
  await step("a call with no token is refused with 401", async () => {
    const res = await mcp(null, "crowsnest_plans", {});
    if (res.status !== 401) throw new Error(`status ${res.status}`);
  });
  const name = `tokens-01-${Date.now()}`;
  let created;
  await step("a token made through the bridge calls the MCP and names the journal row", async () => {
    created = await bridge(page, "createMcpToken", name);
    const newest = (await bridge(page, "listAgentActions", 1))[0]?.id ?? 0;
    const res = await freeCall(created.token);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    await res.text();
    const row = (await bridge(page, "listAgentActions", 10)).find((r) => r.id > newest && r.tool === "crowsnest_save_funnel");
    if (row?.caller !== name) throw new Error(JSON.stringify(row));
    const listed = (await bridge(page, "listMcpTokens")).find((t) => t.id === created.id);
    if (!listed || "token" in listed || "tokenHash" in listed || !listed.lastUsedAt) throw new Error(JSON.stringify(listed));
    console.log(`token row: ${JSON.stringify(listed)}`);
  });
  await step("a revoked token is refused with 401 right after revoke", async () => {
    if (!(await bridge(page, "revokeMcpToken", created.id)).revoked) throw new Error("not revoked");
    const res = await freeCall(created.token);
    if (res.status !== 401) throw new Error(`status ${res.status}`);
  });
  await snap("tokens-01");
}
