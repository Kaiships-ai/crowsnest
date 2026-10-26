import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const fmt = (n) => new Intl.NumberFormat().format(n);
const SCREEN = { width: 1440, height: 875 };

async function setThemeWithoutTransition(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

// Diacritics only Vietnamese uses; English copy never carries them.
const VIETNAMESE = /[ăâđêôơưĂÂĐÊÔƠƯạ-ỹ]/;

async function compareBoth(page, snapAndCompare, name) {
  const target = page.getByTestId("board-tab");
  await setThemeWithoutTransition(page, "dark");
  await snapAndCompare(`${name}-dark`, target);
  await setThemeWithoutTransition(page, "light");
  await snapAndCompare(`${name}-light`, target);
  await setThemeWithoutTransition(page, "dark");
}

async function assertEnglish(board, where) {
  const text = await board.innerText();
  const hit = text.split("\n").find((line) => VIETNAMESE.test(line));
  if (hit) throw new Error(`${where} shows Vietnamese: ${hit}`);
}

const openTab = (board, id) => board.getByTestId(id).click();

export default async function own01({ page, step, snapAndCompare }) {
  const board = page.getByTestId("board-tab");
  await page.setViewportSize(SCREEN);

  await step("open My channel from the new-tab menu: Overview shows the bridge's numbers in Kpi tiles, each block naming its source once, and a failed post pull marks the per-post totals", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="own"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("own-panel-home").waitFor({ timeout: 10_000 });
    const { value } = await call(page, "getOwnBoard", 30);
    const want = { "own-stat-views": value.totals.views.value, "own-stat-followers": value.followers.value, "own-total-dm": value.after.dm.value };
    for (const [id, n] of Object.entries(want)) {
      const text = await board.getByTestId(id).innerText();
      console.log(`${id}: ${text.replaceAll("\n", " | ")}`);
      if (!text.includes(fmt(n))) throw new Error(`${id} does not show ${fmt(n)}`);
    }
    const tags = await board.getByTestId("own-panel-home").getByTestId("source-tag").allInnerTexts();
    console.log(`source tags: ${tags.join(" | ")}`);
    if (!/^Instagram · pulled /.test(tags[0]) || !/^ChatbotX · Umami · Polar · pulled /.test(tags[1]) || tags.length !== 2) throw new Error("each block must name its sources and pull time once");
    const days = await board.getByTestId("own-views-line").getAttribute("data-points");
    console.log(`views line: ${days} days`);
    if (days !== "30") throw new Error(`views line has ${days} points`);
    // The seed's own-reel-3 has a failed newest pull, so its old numbers still sit in the totals.
    const views = await board.getByTestId("own-stat-views").getByTestId("kpi-value").getAttribute("data-state");
    const followers = await board.getByTestId("own-stat-followers").getByTestId("kpi-value").getAttribute("data-state");
    console.log(`views tile: ${views}, followers tile: ${followers}`);
    if (views !== "pull-failed" || followers !== "value") throw new Error("a failed post pull must mark the per-post totals, not the account numbers");
    await assertEnglish(board, "Overview");
  });
  await compareBoth(page, snapAndCompare, "own-01-home");

  await step("Performance shows views by content type", async () => {
    await openTab(board, "own-tab-perf");
    const formats = await board.getByTestId("own-by-format").innerText();
    console.log(`by format: ${formats.replaceAll("\n", " | ")}`);
    if (!formats.includes("Reel") || !formats.includes("Carousel")) throw new Error(formats);
    if ((await board.getByTestId("own-format-row").locator('[data-testid="kit-bar"]').count()) < 2) throw new Error("no bar per content type");
    await assertEnglish(board, "Performance");
  });

  await step("Content lists the window's posts from the DB with each post's own comments, shares and saves; DM is 52 by keyword, a reel with no keyword reads not connected, never 0, and a failed newest pull is marked on its row", async () => {
    await openTab(board, "own-tab-content");
    const rows = board.getByTestId("own-post-row");
    await rows.first().waitFor();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const inDb = sql(`select count(*) from own_posts where posted_at >= '${since}'`);
    console.log(`rows: ${await rows.count()} (db ${inDb})`);
    if (String(await rows.count()) !== inDb) throw new Error("row count differs from the DB");
    const dm = (id) => board.locator(`[data-testid="own-post-row"][data-post-id="${id}"] [data-testid="own-after-dm"]`);
    if ((await dm("own-reel-1").innerText()) !== "52") throw new Error(`own-reel-1 DM ${await dm("own-reel-1").innerText()}`);
    if ((await dm("own-reel-2").getAttribute("data-status")) !== "no-keyword" || (await dm("own-reel-2").innerText()) !== "not connected") {
      throw new Error(`own-reel-2 DM ${await dm("own-reel-2").innerText()}`);
    }
    const shown = await rows.evaluateAll((list) => list.map((r) => [r.dataset.postId, ...[...r.children].slice(3, 6).map((c) => c.textContent)].join(" ")).sort());
    const want = sql(`select p.id || ' ' || i.comments || ' ' || i.shares || ' ' || i.saved from own_posts p join own_post_insights i on i.id = p.id || '-now' where p.posted_at >= '${since}' order by p.id`).split("\n");
    console.log(`comments shares saved: ${shown.join(" | ")}`);
    if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`db ${want.join(" | ")}`);
    const failed = await rows.evaluateAll((list) => list.filter((r) => r.dataset.pullError === "true").map((r) => r.dataset.postId));
    console.log(`newest pull failed: ${failed.join(" ")}`);
    if (JSON.stringify(failed) !== JSON.stringify(["own-reel-3"])) throw new Error("the failed newest pull is not marked on its row only");
    await board.getByTestId("own-sort-dm").click();
    const first = await rows.first().getAttribute("data-post-id");
    if (first !== "own-reel-1") throw new Error(`sorted by DM, first is ${first}`);
    await assertEnglish(board, "Content");
  });
  await compareBoth(page, snapAndCompare, "own-01-content");

  await step("Audience shows the follower split from the stored breakdowns", async () => {
    await openTab(board, "own-tab-aud");
    const split = await board.getByTestId("own-follower-split").innerText();
    console.log(`split: ${split.replaceAll("\n", " | ")}`);
    if (!split.includes("NON_FOLLOWER") || !split.includes("87%")) throw new Error(split);
    await assertEnglish(board, "Audience");
  });
  await compareBoth(page, snapAndCompare, "own-01-audience");

  await step("a reel opens on Overview, and After the reel walks OWN01's funnel with checkout from Umami", async () => {
    await openTab(board, "own-tab-content");
    await board.locator('[data-testid="own-post-row"][data-post-id="own-reel-1"] [data-testid="own-open-reel"]').click();
    await board.getByTestId("own-reel-panel-ov").waitFor({ timeout: 10_000 });
    const views = await board.getByTestId("own-reel-views").innerText();
    if (!views.includes(fmt(12_400))) throw new Error(views);
    await board.getByTestId("own-reel-history").locator("svg").waitFor();
    await compareBoth(page, snapAndCompare, "own-01-reel");
    await openTab(board, "own-reel-tab-after");
    const steps = await board.getByTestId("own-after-step").evaluateAll((rows) => rows.map((r) => `${r.dataset.stepId}:${r.dataset.status}:${r.querySelector('[data-testid="kpi-value"] [data-num]')?.textContent ?? "-"}`));
    console.log(`steps: ${steps.join(" ")}`);
    const want = [`view:value:${fmt(12_400)}`, "comment_keyword:not-connected:-", "dm:value:52", "gift_page_visit:value:18", "checkout:missing:-", "purchase:missing:-"];
    if (JSON.stringify(steps) !== JSON.stringify(want)) throw new Error(`want ${want.join(" ")}`);
    await assertEnglish(board, "After the reel");
  });
  await compareBoth(page, snapAndCompare, "own-01-after");

  await step("back to the board, 7 days keeps only the last week's posts", async () => {
    await board.getByTestId("own-reel-back").click();
    await board.getByTestId("own-days-7").click();
    await openTab(board, "own-tab-content");
    await board.getByTestId("own-post-row").first().waitFor();
    const ids = await board.getByTestId("own-post-row").evaluateAll((rows) => rows.map((r) => r.dataset.postId).sort());
    console.log(`7 days: ${ids.join(" ")}`);
    if (JSON.stringify(ids) !== JSON.stringify(["own-carousel-1", "own-reel-1"])) throw new Error("wrong 7-day posts");
  });
}
