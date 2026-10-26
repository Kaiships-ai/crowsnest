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

  const board = page.getByTestId("board-tab");
  await step("open Phễu from the new-tab menu and see the six steps, each with its source", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="funnel"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("funnel-step").first().waitFor({ timeout: 10_000 });
    const steps = await board.getByTestId("funnel-step").evaluateAll((rows) => rows.map((r) => `${r.dataset.stepId}:${r.dataset.status}`));
    console.log(`steps: ${steps.join(" ")}`);
    const ids = steps.map((s) => s.split(":")[0]);
    if (ids.join(",") !== "view,comment_keyword,dm,gift_page_visit,checkout,purchase") throw new Error(ids.join(","));
    for (const row of await board.getByTestId("funnel-step").all()) {
      if ((await row.getByTestId("source-label").count()) !== 1) throw new Error(`no source on ${await row.getAttribute("data-step-id")}`);
    }
    const board2 = await call(page, "getFunnelBoard");
    const dm = await board.locator('[data-testid="funnel-step"][data-step-id="dm"] [data-testid="reading-value"]').innerText();
    const want = new Intl.NumberFormat().format(board2.value.steps.find((s) => s.id === "dm").total.value);
    if (dm !== want) throw new Error(`dm ${dm}, bridge ${want}`);
    if ((await board.locator('[data-testid="funnel-keyword-row"][data-keyword="LEDGER01"]').count()) !== 1) throw new Error("no LEDGER01 row");
  });
  await step("a step with no source shows chưa nối and a Vault link, never 0", async () => {
    const checkout = board.locator('[data-testid="funnel-step"][data-step-id="checkout"]');
    if ((await checkout.getAttribute("data-status")) !== "not-connected") throw new Error(await checkout.innerText());
    if ((await checkout.getByTestId("reading-value").count()) !== 0) throw new Error("checkout shows a number");
    console.log(`checkout: ${(await checkout.innerText()).replace(/\s+/g, " ")}`);
    const coverage = await board.getByTestId("funnel-coverage-visits").innerText();
    console.log(`coverage: ${coverage.replace(/\s+/g, " ")}`);
  });
  await setTheme(page, "dark");
  await snap("funnel-01-board-dark");
  await setTheme(page, "light");
  await snap("funnel-01-board-light");
  await setTheme(page, "dark");
  await step("the Vault link opens the Vault board", async () => {
    await board.locator('[data-testid="funnel-step"][data-step-id="checkout"]').getByTestId("open-vault").click();
    await page.locator('[data-testid="board-tab"][data-board-id="vault"]').waitFor({ timeout: 10_000 });
  });
}
