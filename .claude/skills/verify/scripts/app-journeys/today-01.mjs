import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const MCP_SH = path.join(import.meta.dirname, "../mcp.sh");
const mcp = (tool, args) => {
  const reply = execFileSync("bash", [MCP_SH, "--app", tool, JSON.stringify(args)], { encoding: "utf8" });
  if (!reply.includes('"result"') || reply.includes('"isError":true')) throw new Error(`${tool}: ${reply.slice(0, 300)}`);
};
const BLOCKS = ["today-offer", "today-gates", "today-pulls", "today-workspaces"];

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

// A 1440x900 screen loses the 25px macOS menu bar; the window's title bar is inside its content.
const SCREEN = { width: 1440, height: 875 };

export default async function today01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");

  await step("the viewport is a 1440x900 screen less the menu bar", async () => {
    await page.setViewportSize(SCREEN);
    console.log(`viewport: ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`);
  });

  await step("an agent saves funnel rows and proposes a week plan over MCP", async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    mcp("crowsnest_save_funnel", { agent: "today-01", rows: [
      { keyword: "TODAY01", source: "chatbotx", metric: "dms", value: 40, capturedAt },
      { keyword: "TODAY01", source: "umami", metric: "visits", value: 12, capturedAt },
      { keyword: "TODAY01", source: "polar", metric: "orders", value: 2, capturedAt },
    ] });
    mcp("crowsnest_propose_plan", { agent: "today-01", period: "week", periodKey: "2099-W01", reels: [{ key: "today-01", title: "today-01 reel" }] });
  });

  await step("open Hôm nay from the new-tab menu and see every block with a source label", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="today"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    for (const id of BLOCKS) {
      const block = board.getByTestId(id);
      await block.waitFor({ timeout: 10_000 });
      const labels = await block.getByTestId("source-label").allInnerTexts();
      if (labels.length === 0) throw new Error(`${id} has no source label`);
      console.log(`${id}: ${labels.join(" | ")}`);
    }
  });

  await step("every number on the board sits in a block that names its source", async () => {
    const orphans = await board.locator('[data-num], [data-testid="reading-value"]').evaluateAll((nodes) =>
      nodes.filter((n) => !n.closest('[data-testid="today-offer-step"], [data-testid="today-step"], [data-testid="today-gates"], [data-testid="today-pulls"], [data-testid="today-workspaces"]')).length,
    );
    if (orphans !== 0) throw new Error(`${orphans} numbers outside a sourced block`);
    for (const s of await board.locator('[data-testid="today-step"], [data-testid="today-offer-step"]').all()) {
      if ((await s.getByTestId("source-label").count()) !== 1) throw new Error(`step ${await s.getAttribute("data-step-id")} has no source label`);
    }
  });

  await step("checkout reads chưa nối, never 0, and with no targets the drop says chưa đặt chuẩn", async () => {
    const checkout = board.locator('[data-testid="today-offer-step"][data-step-id="checkout"]');
    if ((await checkout.getByTestId("reading-not-connected").count()) !== 1) throw new Error(await checkout.innerText());
    if ((await checkout.getByTestId("reading-value").count()) !== 0) throw new Error("checkout shows a number");
    const drop = board.getByTestId("today-drop");
    if ((await drop.getAttribute("data-status")) !== "no-target") throw new Error(await drop.innerText());
    console.log(`drop: ${await drop.innerText()}`);
  });

  await step("gate counts match the lane DB", async () => {
    const drafts = sql("select count(*) from gate_drafts where status = 'pending'");
    const plans = sql(`select count(*) from plan_versions p where p.status = 'proposed' and p.version > coalesce((select max(l.version) from plan_versions l where l.period = p.period and l.period_key = p.period_key and l.status = 'live'), 0)`);
    const shown = [await board.getByTestId("today-gate-plans").innerText(), await board.getByTestId("today-gate-drafts").innerText()];
    console.log(`gates: plans ${shown[0]} (db ${plans}), drafts ${shown[1]} (db ${drafts})`);
    if (shown[0] !== plans || shown[1] !== drafts) throw new Error(JSON.stringify(shown));
  });

  await step("last night's pulls show each connector's state from the Vault data", async () => {
    const vault = await call(page, "getVaultBoard");
    const want = vault.value.map((r) => `${r.id}:${r.state}`);
    const shown = await board.getByTestId("today-pull-row").evaluateAll((rows) => rows.map((r) => `${r.dataset.connectorId}:${r.dataset.state}`));
    console.log(`pulls: ${shown.join(" ")}`);
    if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`vault ${want.join(" ")}`);
  });

  await step("the board fits 1440x900 with no scroll", async () => {
    const overflow = await board.evaluate((tab) => {
      const all = [tab, ...tab.querySelectorAll("*")];
      return all.filter((n) => n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== "visible").map((n) => n.dataset.testid ?? n.tagName);
    });
    const tab = await board.boundingBox();
    const clipped = [];
    for (const id of BLOCKS) {
      const box = await board.getByTestId(id).boundingBox();
      if (box.y + box.height > tab.y + tab.height + 1) clipped.push(id);
    }
    console.log(`board: ${Math.round(tab.width)}x${Math.round(tab.height)}, overflow: [${overflow.join(", ")}], clipped: [${clipped.join(", ")}]`);
    if (overflow.length || clipped.length) throw new Error("the board scrolls or clips");
  });
  await setTheme(page, "dark");
  await snap("today-01-dark");
  await setTheme(page, "light");
  await snap("today-01-light");
  await setTheme(page, "dark");
}
