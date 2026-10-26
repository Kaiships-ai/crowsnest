import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const SCREEN = { width: 1440, height: 875 };
const MCP_SH = path.join(import.meta.dirname, "../mcp.sh");
// Diacritics only Vietnamese uses; English copy never carries them.
const VIETNAMESE = /[ăâđêôơưĂÂĐÊÔƠƯạ-ỹ]/;

function saveAnalysis(videoId, tag) {
  const args = { videoId, tag, hookType: "question", structureSegments: [], formatTags: ["talking-head"], styleTags: [], whyItWorked: `rivals-01 filed this under ${tag}.` };
  const reply = execFileSync("bash", [MCP_SH, "--app", "crowsnest_save_analysis", JSON.stringify(args)], { encoding: "utf8" });
  if (!reply.includes('"ok":true') && !reply.includes('\\"ok\\":true')) throw new Error(`save_analysis ${videoId}: ${reply.slice(0, 200)}`);
}
const RIVAL = "@e2e_fixture_rival";

async function setThemeWithoutTransition(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

async function openFromNewTabMenu(page) {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.locator('[data-testid="new-tab-board"][data-board-id="rivals"]').click();
  await page.getByRole("menu").waitFor({ state: "detached" });
}

export default async function rivals01({ page, step, snap, snapAndCompare }) {
  const board = page.getByTestId("board-tab");
  const row = (handle) => board.locator(`[data-testid="rivals-channel-row"][data-handle="${handle}"]`);
  await page.setViewportSize(SCREEN);

  await step("open Rivals from the new-tab menu: the rival shows, the own channel does not, and each block names its source once", async () => {
    await openFromNewTabMenu(page);
    await row(RIVAL).waitFor({ timeout: 10_000 });
    const handles = await board.getByTestId("rivals-channel-row").evaluateAll((rows) => rows.map((r) => r.dataset.handle));
    console.log(`channels: ${handles.join(" ")}`);
    if (handles.includes("@e2e_fixture_creator")) throw new Error("the own channel is listed as a rival");
    const tags = await board.getByTestId("source-tag").allInnerTexts();
    console.log(`source tags: ${tags.join(" | ")}`);
    if (JSON.stringify(tags.map((t) => t.split(" · ")[0])) !== JSON.stringify(["Analysis", "Radar", "Radar"])) throw new Error("a block without its source");
  });

  await step("the outliers table holds the rival's posts at 2x or more in 30 days, best first", async () => {
    const outliers = await board.locator(`[data-testid="rivals-outlier"][data-handle="${RIVAL}"]`).evaluateAll((rows) => rows.map((r) => r.dataset.videoId));
    const inDb = sql(`select id from videos where channel_id = (select id from channels where handle = '${RIVAL}') and outlier_score >= 2 order by outlier_score desc`).split("\n");
    console.log(`outliers: ${outliers.join(" ")} (db ${inDb.join(" ")})`);
    if (JSON.stringify(outliers) !== JSON.stringify(inDb)) throw new Error("outliers differ from the DB");
  });

  await step("an agent tags analyses as it saves them: Take, Learn and Avoid hold what the DB says, an untagged one sits under Not sorted", async () => {
    saveAnalysis("e2e-rival-video-1", "avoid");
    saveAnalysis("e2e-rival-video-2", "learn");
    await board.getByTestId("board-refresh").click();
    await board.locator('[data-testid="rivals-group"][data-group="avoid"] [data-testid="rivals-evidence-card"]').waitFor({ timeout: 10_000 });
    const shown = await board.getByTestId("rivals-group").evaluateAll((groups) =>
      groups.flatMap((g) => [...g.querySelectorAll('[data-testid="rivals-evidence-card"]')].map((c) => `${c.dataset.videoId}:${g.dataset.group}`)).sort(),
    );
    const inDb = sql("select video_id || ':' || coalesce(tag, 'unsorted') from video_analyses where video_id like 'e2e-rival-video-%' order by 1").split("\n");
    console.log(`groups: ${shown.join(" ")} (db ${inDb.join(" ")})`);
    if (JSON.stringify(shown) !== JSON.stringify(inDb)) throw new Error("groups differ from the DB");
    if (!inDb.includes("e2e-rival-video-3:unsorted")) throw new Error("the seed lost its untagged analysis");
    const text = await board.innerText();
    const hit = text.split("\n").find((line) => VIETNAMESE.test(line));
    if (hit) throw new Error(`Rivals shows Vietnamese: ${hit}`);
  });
  for (const theme of ["dark", "light"]) {
    await setThemeWithoutTransition(page, theme);
    await snapAndCompare(`rivals-01-${theme}`, board);
  }
  await setThemeWithoutTransition(page, "dark");

  await step("an evidence card opens the original post in a browser tab", async () => {
    const card = board.locator('[data-testid="rivals-evidence-card"][data-video-id="e2e-rival-video-0"]');
    console.log(`card: ${(await card.innerText()).replaceAll("\n", " | ")}`);
    const open = card.getByTestId("rivals-evidence-open");
    const url = await open.getAttribute("data-url");
    if (url !== sql("select url from videos where id = 'e2e-rival-video-0'")) throw new Error(`card url ${url}`);
    await open.click();
    await page.waitForFunction((want) => JSON.stringify(window.__store.getState().browserTabsByWorktree).includes(want), url, { timeout: 10_000 });
    console.log(`browser tab: ${url}`);
  });
  await step("opening Rivals again comes back to the same board tab", async () => {
    await openFromNewTabMenu(page);
    await row(RIVAL).waitFor({ timeout: 10_000 });
    if ((await page.getByTestId("board-tab").count()) !== 1) throw new Error("a second board view");
  });

  await step("a handle that is not a handle is refused with its reason and writes nothing", async () => {
    const before = sql("select count(*) from channels");
    await board.getByTestId("rivals-add-input").fill("has spaces");
    await board.getByTestId("rivals-add-submit").click();
    const message = board.getByTestId("rivals-add-message");
    await message.waitFor();
    console.log(`refused: ${await message.innerText()}`);
    if ((await message.getAttribute("data-status")) !== "error") throw new Error("not an error");
    if (sql("select count(*) from channels") !== before) throw new Error("a channel was written");
  });

  await step("Add rival adds a channel after the profile check, and the new row shows", async () => {
    const handle = `@e2e_new_rival_${Date.now()}`;
    await board.getByTestId("rivals-add-input").fill(handle);
    await board.getByTestId("rivals-add-submit").click();
    await row(handle).waitFor({ timeout: 10_000 });
    const message = await board.getByTestId("rivals-add-message").innerText();
    const stored = sql(`select external_id || ' ' || follower_count from channels where handle = '${handle}' and deleted_at is null`);
    console.log(`added: ${message} | db ${stored}`);
    if (stored !== `fake-${handle.slice(1)} 2500`) throw new Error(`db row ${stored}`);
  });
  await snap("rivals-01-added");

  sql("alter table video_analyses rename to video_analyses_off");
  try {
    await step("a failed read shows the error state", async () => {
      await board.getByTestId("board-refresh").click();
      const error = board.getByTestId("board-state-error");
      await error.waitFor({ timeout: 10_000 });
      console.log(`error: ${await error.innerText()}`);
    });
  } finally {
    sql("alter table video_analyses_off rename to video_analyses");
  }
  await step("Retry brings the board back", async () => {
    await board.getByTestId("board-retry").click();
    await row(RIVAL).waitFor({ timeout: 10_000 });
  });
}
