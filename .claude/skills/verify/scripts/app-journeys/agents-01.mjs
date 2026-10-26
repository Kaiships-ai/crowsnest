import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const port = readFileSync(path.join(import.meta.dirname, "../../../../../data/verify/app/mcp.port"), "utf8").trim();
const MCP_SH = path.join(import.meta.dirname, "../mcp.sh");
const JOURNALED_TOOL = "crowsnest_save_funnel";
const toolArgs = () => ({ agent: "agents-01", rows: [{ keyword: "AGENTS01", source: "chatbotx", metric: "dms", value: 1, capturedAt: new Date(Date.now() - 60_000).toISOString() }] });

async function mcpStatus(token) {
  const res = await fetch(`http://localhost:${port}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: JOURNALED_TOOL, arguments: toolArgs() } }),
  });
  await res.text();
  return res.status;
}

// Theme colors transition; without the app's disable class a snap catches text mid-fade.
async function setTheme(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function agents01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");
  const name = `agents-01-${Date.now()}`;
  const tokenRow = board.locator(`[data-testid="agents-token-row"][data-token-name="${name}"]`);

  await step("one MCP call with the local token shows in the journal as one ok row with caller local", async () => {
    const reply = execFileSync("bash", [MCP_SH, "--app", JOURNALED_TOOL, JSON.stringify(toolArgs())], { encoding: "utf8" });
    if (!reply.includes('"result"')) throw new Error(reply.slice(0, 200));
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="agents"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    const first = board.getByTestId("agents-journal-row").first();
    await first.waitFor({ timeout: 10_000 });
    const top = await first.evaluate((r) => ({ text: `${r.dataset.caller} ${r.dataset.tool} ${r.dataset.result}`, callId: r.dataset.callId }));
    console.log(`newest journal row: ${top.text}`);
    if (top.text !== `local ${JOURNALED_TOOL} ok`) throw new Error(top.text);
    const sameCall = await board.locator(`[data-testid="agents-journal-row"][data-call-id="${top.callId}"]`).count();
    if (sameCall !== 1) throw new Error(`${sameCall} rows for one call`);
  });
  await snap("agents-01-dark");
  await setTheme(page, "light");
  await snap("agents-01-light");
  await setTheme(page, "dark");

  await step("the caller filter keeps only that caller's rows", async () => {
    await board.getByTestId("agents-caller-filter").getByRole("radio", { name: "local" }).click();
    const callers = await board.getByTestId("agents-journal-row").evaluateAll((rows) => [...new Set(rows.map((r) => r.dataset.caller))]);
    if (JSON.stringify(callers) !== '["local"]') throw new Error(JSON.stringify(callers));
  });

  let token;
  await step("Tạo shows the new token once, and Xong hides it for good", async () => {
    await board.getByTestId("agents-token-name").fill(name);
    await board.getByTestId("agents-token-create").click();
    token = await board.getByTestId("agents-new-token-value").innerText();
    if (!token.startsWith("cn_")) throw new Error(`token ${token.slice(0, 3)}...`);
    await tokenRow.waitFor({ timeout: 10_000 });
    await snap("agents-01-created");
    await board.getByTestId("agents-new-token-done").click();
    if ((await page.content()).includes(token)) throw new Error("the token is still on screen");
    const listed = await page.evaluate(() => window.api.crowsnest.call("listMcpTokens"));
    if (JSON.stringify(listed).includes(token)) throw new Error("listMcpTokens carries the token");
    if ((await mcpStatus(token)) !== 200) throw new Error("the new token is refused");
  });

  await step("Thu hồi asks to confirm, then the token gets 401", async () => {
    await tokenRow.getByTestId("agents-revoke").click();
    if ((await mcpStatus(token)) !== 200) throw new Error("revoked before the confirm");
    await tokenRow.getByTestId("agents-revoke-confirm").click();
    await board.locator(`[data-testid="agents-token-row"][data-token-name="${name}"][data-revoked="true"]`).waitFor({ timeout: 10_000 });
    const status = await mcpStatus(token);
    console.log(`after revoke: ${status}`);
    if (status !== 401) throw new Error(`status ${status}`);
  });
  await snap("agents-01");
}
