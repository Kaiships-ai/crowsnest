import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// DoD ids whose pass criterion this journey asserts (run-all-report.mjs reads this line).
export const dod = ["B1-02", "B1-07"];

const ROOT = path.join(import.meta.dirname, "../../../../..");
const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const state = (file) => readFileSync(path.join(ROOT, "data/verify/app", file), "utf8").trim();
const { userDataDir } = JSON.parse(state("state.json"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const umamiUrl = `http://127.0.0.1:${state("fake-umami.port")}`;
const KEY = "lane-umami-key";
const fake = (route) => fetch(`${umamiUrl}${route}`, { method: "POST" });
const fmt = (n) => new Intl.NumberFormat().format(n);
const latest = (metric) => Number(sql(`select value from reel_funnel where keyword = 'OWN01' and source = 'umami' and metric = '${metric}' order by captured_at desc, rowid desc limit 1`));
const umamiSecrets = () => sql("select group_concat(name) from (select name from sealed_secrets where name like 'UMAMI_%' union select name from secrets where name like 'UMAMI_%' order by name)");
const SHOTS = path.join(ROOT, process.env.UMAMI_SHOTS ?? "data/verify/evidence/umami-01-cards");

const CARD = '[data-testid="source-card"][data-connector-id="umami"]';

async function openBoard(page, id) {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.locator(`[data-testid="new-tab-board"][data-board-id="${id}"]`).click();
  await page.getByRole("menu").waitFor({ state: "detached" });
}

async function openSources(page) {
  await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
  await page.locator(CARD).waitFor({ timeout: 10_000 });
}

const backToApp = (page) => page.getByRole("button", { name: "Back to app" }).click();

async function setTheme(page, dark) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, dark);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

const viewIs = (page, view, timeout = 15_000) => page.waitForFunction(([sel, view]) => document.querySelector(sel)?.dataset.view === view, [CARD, view], { timeout });
const checkIs = (page, check) => page.waitForFunction((check) => document.querySelector('[data-testid="umami-form-check"]')?.dataset.check === check, check, { timeout: 15_000 });

export default async function umami01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");
  const card = page.locator(CARD);
  await page.setViewportSize({ width: 1440, height: 875 });
  mkdirSync(SHOTS, { recursive: true });
  /** The Umami card in both themes, for the review beside the prototype. */
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      await card.screenshot({ path: path.join(SHOTS, `umami-${name}-${dark ? "dark" : "light"}.png`) });
    }
    console.log(`shot: umami-${name}`);
  };
  const form = page.getByTestId("umami-form");
  const save = page.getByTestId("umami-form-save");
  const fill = async (address, key) => {
    await page.getByTestId("umami-addr-input").fill(address);
    await page.getByTestId("umami-key-input").fill(key);
  };

  await step("Sources: the Umami card is Not connected and asks for an address and an API key", async () => {
    await fake("/__mode?m=normal");
    sql("insert or replace into secrets (name, value, updated_at) values ('UMAMI_USERNAME', 'lane-old-user', '2026-01-01T00:00:00Z'), ('UMAMI_PASSWORD', 'lane-old-pass', '2026-01-01T00:00:00Z')");
    await openSources(page);
    await viewIs(page, "not-connected");
    await shot("not-connected");
  });

  await step("Connect Umami opens the dialog; nothing tests on typing and Save stays off", async () => {
    await card.getByTestId("umami-enter").click();
    await form.waitFor();
    await shot("dialog-empty");
    await fill(umamiUrl, KEY);
    await page.waitForTimeout(500);
    if (await page.getByTestId("umami-form-check").count()) throw new Error("a check ran on typing");
    if (!(await save.isDisabled())) throw new Error("Save is on before a test");
    await shot("dialog-filled");
  });

  await step("a wrong key: Test connection shows C13 inside the dialog and Save stays off", async () => {
    await page.getByTestId("umami-key-input").fill("wrong-key");
    await page.getByTestId("umami-form-test").click();
    await checkIs(page, "err");
    const text = await page.getByTestId("umami-form-check").innerText();
    if (text !== "Umami rejected the key (401). Create a new key and paste it.") throw new Error(text);
    if (!(await save.isDisabled())) throw new Error("Save is on after a failed test");
    await shot("dialog-401");
  });

  await step("a wrong address: Test connection says it cannot reach the address and Save stays off", async () => {
    await fill("http://127.0.0.1:9", KEY);
    await page.getByTestId("umami-form-test").click();
    await checkIs(page, "err");
    const text = await page.getByTestId("umami-form-check").innerText();
    if (!text.startsWith("Cannot reach 127.0.0.1:9")) throw new Error(text);
    if (!(await save.isDisabled())) throw new Error("Save is on after a failed test");
    await shot("dialog-unreachable");
  });

  await step("two websites under the team: the dialog asks for a pick, and Save turns on only after it", async () => {
    await fake("/__mode?m=two-sites");
    await fill(umamiUrl, KEY);
    await page.getByTestId("umami-form-test").click();
    await checkIs(page, "pick");
    if (!(await save.isDisabled())) throw new Error("Save is on before a pick");
    await shot("dialog-pick");
    await page.getByTestId("umami-site-select").click();
    await page.getByTestId("umami-site-option").filter({ hasText: "lane-site.example" }).first().click();
    if (await save.isDisabled()) throw new Error("Save is off after a pick");
    await fake("/__mode?m=normal");
  });

  await step("one website: Test connection names it, picks it, and Save turns on", async () => {
    await fake("/__mode?m=slow&ms=1500");
    await page.getByTestId("umami-form-test").click();
    await checkIs(page, "testing");
    await shot("dialog-testing");
    await checkIs(page, "ok");
    const text = await page.getByTestId("umami-form-check").innerText();
    if (text !== "✓ Key works · website lane-site.example") throw new Error(text);
    if (await save.isDisabled()) throw new Error("Save is off after a passing test");
    await shot("dialog-ok");
    await fake("/__mode?m=normal");
  });

  await step("Save stores the address, key and website, clears the old login, and the card reads Ready with the website", async () => {
    await save.click();
    await viewIs(page, "ready");
    const secrets = umamiSecrets();
    console.log(`secrets: ${secrets}`);
    if (secrets !== "UMAMI_API_KEY,UMAMI_URL,UMAMI_WEBSITE_ID") throw new Error(secrets);
    const sample = await card.getByTestId("umami-sample").innerText();
    if (sample !== `Website lane-site.example · ${new URL(umamiUrl).host}`) throw new Error(sample);
    if ((await page.content()).includes(KEY)) throw new Error("the key is on screen");
    await shot("ready");
  });

  await step("Test connection from the card shows Testing, then Ready", async () => {
    await fake("/__mode?m=slow&ms=1500");
    await card.getByTestId("umami-test").click();
    await viewIs(page, "testing", 5_000);
    await shot("testing");
    await viewIs(page, "ready");
    await fake("/__mode?m=normal");
  });

  await step("Pull funnel shows page x / 3 with Stop, then a summary of visits, signups and checkouts", async () => {
    await fake("/__mode?m=slow&ms=1500");
    await card.getByTestId("umami-pull").click();
    await viewIs(page, "pulling");
    await page.waitForFunction((sel) => /^[12] \/ 3 pages$/.test(document.querySelector(`${sel} [data-testid="source-pull-count"]`)?.textContent ?? ""), CARD, { timeout: 10_000 });
    const now = await card.getByTestId("source-pull-current").innerText();
    console.log(`pulling: ${now} · ${await card.getByTestId("source-pull-count").innerText()}`);
    if (!/^Pulling events, (last \d+ days|today)…$/.test(now)) throw new Error(now);
    await shot("pulling");
    await viewIs(page, "done", 20_000);
    await fake("/__mode?m=normal");
    await page.waitForFunction((sel) => !document.querySelector(`${sel} [data-testid="source-pull-summary"]`)?.textContent?.includes("…"), CARD, { timeout: 10_000 });
    const cells = await card.getByTestId("source-pull-summary").locator(".font-mono.text-sm").allInnerTexts();
    const { value } = await call(page, "getFunnelTotals");
    console.log(`summary cells ${cells.join(" | ")}; funnel totals ${JSON.stringify(value)}`);
    if (cells.join("|") !== [value.gift_page_visit, value.email, value.checkout].map((n) => (n === null ? "—" : fmt(n))).join("|")) throw new Error("summary does not match the funnel totals");
    const day = sql("select test_sessions_dropped || ' ' || json_extract(clean, '$.byCampaign.own01.giftVisits') || ' ' || json_extract(raw, '$.byCampaign.own01.giftVisits') from umami_days order by day desc limit 1");
    console.log(`umami_days newest: dropped, clean visits, raw visits = ${day}; OWN01 visits ${latest("visits")}, emails ${latest("emails")}`);
    if (day !== "1 4 5") throw new Error(`umami_days ${day}`);
    if (latest("visits") !== 4 || latest("emails") !== 2) throw new Error("reel_funnel");
    await shot("done");
  });
  await snap("umami-01-sources");

  await step("Open Funnel board: the gift-page step and OWN01's row show the pulled visits", async () => {
    await card.getByTestId("umami-open-funnel").click();
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

  const stored = () => `${sql("select count(*) || ' ' || max(captured_at) from reel_funnel where source = 'umami'")} | ${sql("select group_concat(day || fetched_at) from umami_days")}`;

  await step("Stop after page 1: the card reads Partial with the page count, and nothing new is stored", async () => {
    const before = stored();
    await openSources(page);
    await fake("/__mode?m=slow&ms=2500");
    await card.getByTestId("umami-pull").click();
    await page.waitForFunction((sel) => document.querySelector(`${sel} [data-testid="source-pull-count"]`)?.textContent?.startsWith("1 / 3"), CARD, { timeout: 10_000 });
    await card.getByTestId("source-pull-stop").click();
    await page.waitForFunction((sel) => document.querySelector(`${sel} [data-testid="source-pull-stop"]`)?.disabled, CARD);
    await shot("stopping");
    await viewIs(page, "stopped", 15_000);
    await fake("/__mode?m=normal");
    const line = await card.getByTestId("umami-line").innerText();
    console.log(`stopped: ${line} / ${await card.getByTestId("umami-keep").innerText()}`);
    if (!/^You stopped the pull at [12] \/ 3 pages\.$/.test(line)) throw new Error(line);
    if (stored() !== before) throw new Error("a stopped pull stored numbers");
    await shot("stopped");
  });

  await step("a 503 on events page 2 makes the pull read Partial, and nothing new is stored", async () => {
    const before = stored();
    await fake("/__fail?page=2");
    try {
      await card.getByTestId("umami-pull").click();
      await viewIs(page, "partial");
      const line = await card.getByTestId("umami-line").innerText();
      console.log(`partial: ${line}`);
      if (!line.includes("HTTP 503")) throw new Error(line);
      if (stored() !== before) throw new Error("a partial pull stored numbers");
      await shot("partial");
    } finally {
      await fake("/__fail?page=0");
    }
  });

  await step("Umami refuses the key: Test connection turns the card to Error with C13", async () => {
    await fake("/__mode?m=reject");
    await card.getByTestId("umami-test").click();
    await viewIs(page, "error");
    const line = await card.getByTestId("umami-line").innerText();
    if (line !== "Umami rejected the key (401). Create a new key and paste it.") throw new Error(line);
    await shot("error-401");
  });

  await step("the server is down: Test connection turns the card to Error, cannot reach the address", async () => {
    await fake("/__mode?m=down");
    await card.getByTestId("umami-test").click();
    await viewIs(page, "unreachable");
    const line = await card.getByTestId("umami-line").innerText();
    if (!line.startsWith(`Cannot reach ${new URL(umamiUrl).host}`)) throw new Error(line);
    await shot("unreachable");
  });

  await step("the server is back: a pull brings the card back to Ready with its summary", async () => {
    await fake("/__mode?m=normal");
    await card.getByTestId("umami-pull").click();
    await viewIs(page, "done", 20_000);
  });
  await setTheme(page, false);
  await backToApp(page);
}
