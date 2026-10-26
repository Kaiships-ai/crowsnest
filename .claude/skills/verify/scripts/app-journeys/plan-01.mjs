import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const SCREEN = { width: 1440, height: 875 };
const today = new Date().toLocaleDateString("sv-SE");

async function setThemeWithoutTransition(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

async function snapBoth(page, snap, name) {
  await setThemeWithoutTransition(page, "dark");
  await snap(`${name}-dark`);
  await setThemeWithoutTransition(page, "light");
  await snap(`${name}-light`);
  await setThemeWithoutTransition(page, "dark");
}

async function openFromNewTabMenu(page) {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
  await page.getByRole("menu").waitFor({ state: "detached" });
}

export default async function plan01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");
  const date = sql("select planned_date from planned_posts where id = 'plan-e2e-draft'");
  const weekStart = (() => {
    const [y, m, d] = date.split("-").map(Number);
    const at = new Date(y, m - 1, d);
    return new Date(y, m - 1, d - ((at.getDay() + 6) % 7)).toLocaleDateString("sv-SE");
  })();
  let target;
  await page.setViewportSize(SCREEN);

  await step("open Kế hoạch from the new-tab menu: the month shows each seeded reel on its day with its state, flagged when it misses an item", async () => {
    await openFromNewTabMenu(page);
    const cell = board.locator(`[data-testid="plan-month-day"][data-date="${date}"]`);
    await cell.getByTestId("plan-chip").first().waitFor({ timeout: 10_000 });
    const chips = await cell.getByTestId("plan-chip").evaluateAll((els) => els.map((e) => `${e.dataset.planId}:${e.dataset.state}:${e.querySelector('[data-testid="plan-flag"]') ? "flag" : "-"}`));
    const db = sql(`select id from planned_posts where planned_date = '${date}' order by planned_time, created_at`).split("\n");
    console.log(`${date}: ${chips.join(" ")} (db ${db.join(" ")})`);
    if (chips.sort().join() !== ["plan-e2e-armed:scheduled:flag", "plan-e2e-draft:draft:flag", "plan-e2e-full:plan:flag"].join()) throw new Error("month chips differ");
  });
  await snapBoth(page, snap, "plan-01-month");

  await step("clicking a week opens its 7 columns, each card with its post time", async () => {
    await board.locator(`[data-testid="plan-week"][data-week-start="${weekStart}"]`).click();
    const columns = await board.getByTestId("plan-week-day").evaluateAll((els) => els.map((e) => e.dataset.date));
    console.log(`week: ${columns.join(" ")}`);
    if (columns.length !== 7 || columns[0] !== weekStart) throw new Error("not the clicked week");
    const times = await board.locator(`[data-testid="plan-week-day"][data-date="${date}"] [data-testid="plan-card"]`).evaluateAll((els) => els.map((e) => `${e.dataset.planId}=${e.querySelector('[data-testid="plan-time"]').textContent}`));
    console.log(`times: ${times.join(" ")}`);
    if (!times.includes("plan-e2e-full=09:00") || !times.includes("plan-e2e-armed=19:30")) throw new Error("post times missing");
    target = columns.find((d) => d >= today && d !== date);
  });
  await snapBoth(page, snap, "plan-01-week");

  await step("a reel scheduled with Instagram cannot be dragged and says why; its day stays", async () => {
    const armed = board.locator('[data-testid="plan-card"][data-plan-id="plan-e2e-armed"]');
    if ((await armed.getAttribute("data-movable")) !== "false") throw new Error("armed card is movable");
    await armed.dragTo(board.locator(`[data-testid="plan-week-day"][data-date="${target}"]`));
    const message = board.getByTestId("plan-message");
    await message.waitFor();
    console.log(`refused: ${await message.innerText()}`);
    if ((await message.getAttribute("data-status")) !== "error" || !/Instagram/.test(await message.innerText())) throw new Error("no refusal");
    const stored = sql("select planned_date || ' ' || scheduled_at from planned_posts where id = 'plan-e2e-armed'");
    console.log(`db: ${stored}`);
    if (!stored.startsWith(`${date} `)) throw new Error("armed reel moved");
  });

  await step("dragging a draft to another day moves it in the DB, and the week shows it there", async () => {
    await board.locator('[data-testid="plan-card"][data-plan-id="plan-e2e-draft"]').dragTo(board.locator(`[data-testid="plan-week-day"][data-date="${target}"]`));
    await board.locator(`[data-testid="plan-week-day"][data-date="${target}"] [data-plan-id="plan-e2e-draft"]`).waitFor({ timeout: 10_000 });
    console.log(`moved: ${await board.getByTestId("plan-message").innerText()}`);
    const stored = sql("select planned_date || ' ' || state from planned_posts where id = 'plan-e2e-draft'");
    console.log(`db: ${stored}`);
    if (stored !== `${target} draft`) throw new Error(`db ${stored}`);
  });
  await snapBoth(page, snap, "plan-01-moved");

  await step("the month and the day follow the move", async () => {
    await board.getByTestId("plan-view-month").click();
    const chip = board.locator(`[data-testid="plan-month-day"][data-date="${target}"] [data-testid="plan-chip"][data-plan-id="plan-e2e-draft"]`);
    await chip.waitFor({ timeout: 10_000 });
    if ((await board.locator(`[data-testid="plan-month-day"][data-date="${date}"] [data-plan-id="plan-e2e-draft"]`).count()) !== 0) throw new Error("still on the old day");
    await chip.click();
    const detail = board.locator('[data-testid="plan-day-view"] [data-testid="plan-detail"][data-plan-id="plan-e2e-draft"]');
    await detail.waitFor();
    console.log(`day ${await board.getByTestId("plan-day-view").getAttribute("data-date")}: ${await detail.getByTestId("plan-missing").innerText()}`);
  });

  await step("a card opens in full: every item, chưa có for key, quà, offer, and the reference reel opens in a browser tab", async () => {
    await board.getByTestId("plan-view-week").click();
    await board.locator(`[data-testid="plan-card"][data-plan-id="plan-e2e-full"]`).click();
    const detail = board.locator('[data-testid="plan-detail"][data-plan-id="plan-e2e-full"]');
    await detail.waitFor();
    const fields = await detail.getByTestId("plan-field").evaluateAll((els) => els.map((e) => `${e.dataset.item}:${e.dataset.missing === "true" ? e.lastElementChild.textContent : "ok"}`));
    console.log(`fields: ${fields.join(" ")}`);
    if (fields.join() !== "script:ok,caption:ok,reference:ok,time:ok,key:chưa có,gift:chưa có,offer:chưa có") throw new Error("fields differ");
    const open = detail.getByTestId("plan-reference-open");
    const url = await open.getAttribute("data-url");
    if (url !== sql("select url from videos where id = 'e2e-rival-video-0'")) throw new Error(`reference ${url}`);
    await open.click();
    await page.waitForFunction((want) => JSON.stringify(window.__store.getState().browserTabsByWorktree).includes(want), url, { timeout: 10_000 });
    console.log(`browser tab: ${url}`);
  });
  await openFromNewTabMenu(page);
  await board.getByTestId("plan-view-week").click();
  await board.locator('[data-testid="plan-card"][data-plan-id="plan-e2e-full"]').click();
  await board.locator('[data-testid="plan-detail"][data-plan-id="plan-e2e-full"]').waitFor();
  await snapBoth(page, snap, "plan-01-day");

  await step("an empty day takes a reel added by hand, written as a dated plan", async () => {
    await board.getByTestId("plan-view-week").click();
    const add = board.getByTestId("plan-add").first();
    const day = await add.getAttribute("data-date");
    const title = `PLAN01 thêm tay ${Date.now()}`;
    await add.click();
    await board.getByTestId("plan-add-title").fill(title);
    await board.getByTestId("plan-add-time").fill("08:15");
    await board.getByTestId("plan-add-submit").click();
    await board.locator(`[data-testid="plan-week-day"][data-date="${day}"] [data-testid="plan-card"]`).filter({ hasText: title }).waitFor({ timeout: 10_000 });
    const stored = sql(`select planned_date || ' ' || planned_time || ' ' || state || ' ' || ifnull(scheduled_at, '-') from planned_posts where title = '${title}'`);
    console.log(`added on ${day}: db ${stored}`);
    if (stored !== `${day} 08:15 scheduled -`) throw new Error(`db ${stored}`);
  });
  await snap("plan-01-added");
}
