import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const APP_DIR = path.resolve(import.meta.dirname, "../../../../../data/verify/app");
const { userDataDir } = JSON.parse(readFileSync(path.join(APP_DIR, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const MCP_SH = path.join(import.meta.dirname, "../mcp.sh");
const mcp = (tool, args) => {
  const reply = execFileSync("bash", [MCP_SH, "--app", tool, JSON.stringify(args)], { encoding: "utf8" });
  if (!reply.includes('"result"') || reply.includes('"isError":true')) throw new Error(`${tool}: ${reply.slice(0, 300)}`);
};
const SCREEN = { width: 1440, height: 875 };
const POST = "plan-e2e-draft";
const CAPTION = "Comment GATE2 for the guide";

/** A 90x160 solid PNG, the shape of studio-reel's `<name>-cover.png`. */
function coverPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const [w, h] = [90, 160];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([217, 119, 87]))]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function setThemeWithoutTransition(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

async function compareBoth(page, snapAndCompare, name, locator) {
  await page.mouse.move(SCREEN.width - 5, SCREEN.height - 5);
  for (const theme of ["light", "dark"]) {
    await setThemeWithoutTransition(page, theme);
    await snapAndCompare(`${name}-${theme}`, locator);
  }
}

const graphLog = () => readFileSync(path.join(APP_DIR, "fake-graph.log"), "utf8");

export default async function gate201({ page, step, snap, snapAndCompare }) {
  const board = (id) => page.locator(`[data-testid="board-tab"][data-board-id="${id}"]`);
  await page.setViewportSize(SCREEN);

  await step("the cook hands over reel.mp4 with reel-cover.png beside it; the agent attaches it over MCP, the cover comes along", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gate2-01-"));
    writeFileSync(path.join(dir, "gate2-reel.mp4"), Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(64, 7)]));
    writeFileSync(path.join(dir, "gate2-reel-cover.png"), coverPng());
    mcp("crowsnest_attach_video", { postId: POST, path: path.join(dir, "gate2-reel.mp4") });
    const res = await call(page, "setPlanCaptionAction", POST, CAPTION);
    if (!res.ok || !res.value.ok) throw new Error(JSON.stringify(res));
    const row = sql(`select (video_asset_id is not null) || ' ' || (cover_asset_id is not null) || ' ' || coalesce(keyword, '-') from planned_posts where id = '${POST}'`);
    console.log(`db video cover keyword: ${row}`);
    if (row !== "1 1 -") throw new Error("video or cover not attached");
  });

  await step("Publish on the reel card opens the sheet with the five checks; no keyword is a yellow warning, not a block", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    const date = sql(`select planned_date from planned_posts where id = '${POST}'`);
    const chip = board("plan").locator(`[data-testid="plan-month-day"][data-date="${date}"] [data-testid="plan-chip"][data-plan-id="${POST}"]`);
    await chip.waitFor({ timeout: 15_000 });
    await chip.click();
    const detail = board("plan").locator(`[data-testid="plan-detail"][data-plan-id="${POST}"]`);
    await detail.getByTestId("plan-publish").click();
    const sheet = page.getByTestId("publish-sheet");
    await sheet.getByTestId("publish-when-now").click();
    await sheet.locator('[data-testid="publish-check"][data-check="cover"][data-status="ok"]').waitFor({ timeout: 10_000 });
    const checks = await sheet.getByTestId("publish-check").evaluateAll((els) => els.map((e) => `${e.dataset.check}:${e.dataset.status}`));
    console.log(`checks: ${checks.join(" ")}`);
    if (checks.join(" ") !== "video:ok caption:ok keyword:warn time:ok cover:ok") throw new Error("checks differ");
    if (await sheet.getByTestId("publish-send").isDisabled()) throw new Error("a keyword warning blocked the send");
  });
  await compareBoth(page, snapAndCompare, "B6-01-publish-sheet", page.getByTestId("publish-sheet"));

  await step("Send to Gate 2 stores one pending draft, journals it, and sends nothing to Graph", async () => {
    const before = graphLog();
    await page.getByTestId("publish-send").click();
    await page.getByTestId("publish-sent").waitFor({ timeout: 10_000 });
    const drafts = sql(`select status || ' ' || caller || ' ' || json_extract(input, '$.at') from gate_drafts where json_extract(input, '$.postId') = '${POST}'`);
    console.log(`gate_drafts: ${drafts}`);
    if (drafts !== "pending kai now") throw new Error("no pending draft");
    if (graphLog() !== before) throw new Error("Graph was called before approval");
    await page.keyboard.press("Escape");
  });

  await step("Today's Gate 2 count shows the draft and opens the Gate 2 board: what, to whom, the checks and the cover", async () => {
    // Fixed proposal time so the board shot does not change with the wall clock.
    sql(`update gate_drafts set created_at = '2026-10-27T03:30:00.000Z' where status = 'pending'`);
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="today"]').click();
    const count = board("today").getByTestId("today-gate-drafts");
    await count.waitFor({ timeout: 15_000 });
    console.log(`today gate 2: ${await count.innerText()} (db ${sql("select count(*) from gate_drafts where status = 'pending'")})`);
    if ((await count.innerText()) !== sql("select count(*) from gate_drafts where status = 'pending'")) throw new Error("Today's count differs from the DB");
    await board("today").getByTestId("today-open-gate2").click();
    const card = board("gate2").getByTestId("gate2-draft").first();
    await card.waitFor({ timeout: 15_000 });
    const what = `${await card.getByTestId("gate2-what").innerText()} | ${await card.getByTestId("gate2-to").innerText()}`;
    console.log(`draft: ${what}`);
    if (what !== "Publish right after approval | Instagram @e2e_fixture_creator") throw new Error("what or to whom differs");
    await page.waitForFunction(() => document.querySelector('[data-board-id="gate2"] [data-testid="gate2-cover"]')?.naturalWidth === 90, null, { timeout: 10_000 });
    console.log("cover: 90x160 image shown from the media store");
  });
  await compareBoth(page, snapAndCompare, "B6-01-gate2-board", board("gate2").getByTestId("gate2-draft").first());

  await step("Approve publishes through the fake Graph: video and cover uploaded, container with cover_url, poll, media_publish, both objects deleted", async () => {
    await board("gate2").getByTestId("gate2-approve").click();
    await board("gate2").locator('[data-testid="gate2-decided"][data-status="approved"]').waitFor({ timeout: 60_000 });
    const lines = graphLog().split("\n").filter((l) => /fake-s3|POST|status_code/.test(l));
    console.log(lines.join("\n"));
    const container = lines.find((l) => /POST \/[^ ]+\/0\/media /.test(l)) ?? "";
    if (!/video_url=[^&]*\.mp4/.test(container) || !/cover_url=[^&]*\.png/.test(container)) throw new Error("the container call has no video_url or cover_url");
    if (!lines.some((l) => l.includes("status_code"))) throw new Error("no container poll");
    if (!lines.some((l) => /POST \/[^ ]+\/0\/media_publish creation_id=17900000000000001/.test(l))) throw new Error("no media_publish");
    for (const ext of ["mp4", "png"]) {
      if (!lines.some((l) => new RegExp(`fake-s3: PUT crowsnest/\\S+\\.${ext}`).test(l))) throw new Error(`no ${ext} upload`);
      if (!lines.some((l) => new RegExp(`fake-s3: DELETE crowsnest/\\S+\\.${ext}`).test(l))) throw new Error(`${ext} not deleted`);
    }
  });

  await step("the reel is published, and the journal shows who proposed and who approved (B6-06)", async () => {
    const plan = sql(`select state || ' ' || coalesce(published_media_id, '-') || ' dry=' || dry_run from planned_posts where id = '${POST}'`);
    console.log(`planned_posts: ${plan}`);
    if (plan !== "published 17900000000000002 dry=0") throw new Error("not published");
    const draft = sql(`select id || ' ' || status || ' ' || decided_by from gate_drafts where json_extract(input, '$.postId') = '${POST}'`);
    const [id] = draft.split(" ");
    const journal = sql(`select caller || ':' || result || ':' || gate from agent_actions where draft_id = '${id}' order by id`).split("\n");
    console.log(`gate_drafts: ${draft}\njournal: ${journal.join(" ")}`);
    if (!draft.endsWith("approved kai") || journal.join(" ") !== "kai:drafted:gate2 kai:pending:gate2 kai:ok:gate2") throw new Error("journal differs");
    const trail = await board("gate2").locator(`[data-testid="gate2-decided"][data-draft-id="${id}"]`).innerText();
    console.log(`board trail: ${trail.replace(/\s+/g, " ")}`);
    if (!/proposed by kai · approved by kai/.test(trail)) throw new Error("board trail differs");
  });
  await snap("gate2-01-approved");
}
