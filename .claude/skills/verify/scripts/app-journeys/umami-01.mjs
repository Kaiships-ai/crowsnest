import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// DoD ids whose pass criterion this journey asserts (run-all-report.mjs reads this line).
export const dod = ["B1-02", "B1-07"];

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const state = (file) => readFileSync(path.join(import.meta.dirname, "../../../../../data/verify/app", file), "utf8").trim();
const { userDataDir } = JSON.parse(state("state.json"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const umamiUrl = `http://127.0.0.1:${state("fake-umami.port")}`;
const fmt = (n) => new Intl.NumberFormat().format(n);
const SECRETS = { UMAMI_URL: umamiUrl, UMAMI_WEBSITE_ID: "lane-site", UMAMI_USERNAME: "lane-umami", UMAMI_PASSWORD: "lane-umami-pass" };
const latest = (metric) => Number(sql(`select value from reel_funnel where keyword = 'OWN01' and source = 'umami' and metric = '${metric}' order by captured_at desc, rowid desc limit 1`));

async function openBoard(page, id) {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.locator(`[data-testid="new-tab-board"][data-board-id="${id}"]`).click();
  await page.getByRole("menu").waitFor({ state: "detached" });
}

const CARD = '[data-testid="source-card"][data-connector-id="umami"]';

async function openSources(page) {
  await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
  await page.locator(CARD).waitFor({ timeout: 10_000 });
}

const backToApp = (page) => page.getByRole("button", { name: "Back to app" }).click();

export default async function umami01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");
  const card = page.locator(CARD);
  await page.setViewportSize({ width: 1440, height: 875 });

  await step("Sources: Connect saves the four Umami fields and the card leaves Not configured", async () => {
    await openSources(page);
    const fresh = sql("select count(*) from sealed_secrets where name like 'UMAMI_%'") === "0";
    if (fresh && (await card.getAttribute("data-state")) !== "not-connected") throw new Error(`before: ${await card.getAttribute("data-state")}`);
    await card.getByTestId("source-primary").click();
    const dialog = page.getByTestId("source-key-dialog");
    for (const [name, value] of Object.entries(SECRETS)) {
      await dialog.locator(`[data-testid="source-key-input"][data-secret-name="${name}"]`).fill(value);
    }
    await dialog.getByTestId("source-key-save").click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state !== "not-connected", CARD, { timeout: 10_000 });
    if ((await page.content()).includes(SECRETS.UMAMI_PASSWORD)) throw new Error("the password is on screen");
  });

  await step("Re-check logs in to Umami and finds the website", async () => {
    await card.getByTestId("source-recheck").click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === "ready" && !document.querySelector(`${sel} [data-testid="source-recheck"]`)?.disabled, CARD, { timeout: 10_000 });
    const row = sql("select state || ' ' || (checked_at is not null) from connector_status where connector_id = 'umami'");
    console.log(`check: card ready, db ${row}`);
    if (row !== "ready 1") throw new Error(`db ${row}`);
  });

  await step("Pull pulls every page, the card reads Ready, and the lane DB holds the day and OWN01's 4 visits and 2 emails", async () => {
    await card.getByTestId("source-pull").click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === "ready" && !document.querySelector(`${sel} [data-testid="source-pull"]`)?.disabled, CARD, { timeout: 15_000 });
    const day = sql("select test_sessions_dropped || ' ' || json_extract(clean, '$.byCampaign.own01.giftVisits') || ' ' || json_extract(raw, '$.byCampaign.own01.giftVisits') from umami_days order by day desc limit 1");
    console.log(`umami_days newest: dropped, clean visits, raw visits = ${day}; OWN01 visits ${latest("visits")}, emails ${latest("emails")}`);
    if (day !== "1 4 5") throw new Error(`umami_days ${day}`);
    if (latest("visits") !== 4 || latest("emails") !== 2) throw new Error("reel_funnel");
    if ((await page.content()).includes(SECRETS.UMAMI_PASSWORD)) throw new Error("the password is on screen");
  });
  await snap("umami-01-sources");
  await backToApp(page);

  await step("Funnel: the gift-page step and OWN01's row show the pulled visits", async () => {
    await openBoard(page, "funnel");
    const step = board.locator('[data-testid="funnel-step"][data-step-id="gift_page_visit"]');
    await step.waitFor({ timeout: 10_000 });
    const { value } = await call(page, "getFunnelBoard");
    const total = value.steps.find((s) => s.id === "gift_page_visit").total;
    const ownRow = value.keywords.find((k) => k.keyword === "OWN01").steps[3];
    console.log(`gift_page_visit total ${JSON.stringify(total)}, OWN01 ${JSON.stringify(ownRow)}`);
    if (ownRow.value !== 4) throw new Error("OWN01 reads the seed, not the pull");
    if ((await step.locator("[data-num]").first().innerText()) !== fmt(total.value)) throw new Error(`step shows ${await step.locator("[data-num]").first().innerText()}`);
    const cells = await board.locator('[data-testid="funnel-keyword-row"][data-row-key="OWN01"] > td').allInnerTexts();
    if (!cells[5]?.startsWith("4")) throw new Error(`OWN01 row ${cells.join(" | ")}`);
  });
  await snap("umami-01-funnel");

  await step("My channel: the Site column of the OWN01 reel shows 4", async () => {
    await openBoard(page, "own");
    await board.getByTestId("own-panel-home").waitFor({ timeout: 10_000 });
    await board.getByTestId("own-tab-content").click();
    const cell = board.locator('[data-testid="own-post-row"][data-post-id="own-reel-1"] [data-testid="own-after-gift_page_visit"]');
    await cell.waitFor({ timeout: 10_000 });
    console.log(`own-reel-1 Site: ${await cell.innerText()} (${await cell.getAttribute("data-status")})`);
    if ((await cell.getAttribute("data-status")) !== "value" || !(await cell.innerText()).startsWith("4")) throw new Error(await cell.innerText());
  });
  await snap("umami-01-own");

  await step("a 503 on events page 2 makes Pull read Partial, and nothing new is stored", async () => {
    const before = sql("select count(*) || ' ' || max(captured_at) from reel_funnel where source = 'umami'");
    const days = sql("select group_concat(day || fetched_at) from umami_days");
    await fetch(`${umamiUrl}/__fail?page=2`, { method: "POST" });
    try {
      await openSources(page);
      await card.getByTestId("source-pull").click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === "partial", CARD, { timeout: 15_000 });
      const problem = await card.getByTestId("source-explanation").innerText();
      const { value } = await call(page, "getVaultBoard");
      const last = value.find((r) => r.id === "umami");
      console.log(`state partial; detail ${last.detail}; problem: ${problem}`);
      if (last.state !== "partial" || !last.detail.includes("HTTP 503")) throw new Error(JSON.stringify(last));
      if (sql("select count(*) || ' ' || max(captured_at) from reel_funnel where source = 'umami'") !== before) throw new Error("a partial pull wrote funnel rows");
      if (sql("select group_concat(day || fetched_at) from umami_days") !== days) throw new Error("a partial pull wrote a day");
    } finally {
      await fetch(`${umamiUrl}/__fail?page=0`, { method: "POST" });
    }
  });
  await snap("umami-01-partial");
  await backToApp(page);
}
