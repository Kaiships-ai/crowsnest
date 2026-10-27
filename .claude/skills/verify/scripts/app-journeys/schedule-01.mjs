import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Runs on schedule-lane.sh (fake Graph, app clock from 04:59:30). Nothing pulls on its own: the
// old 05:00 slot passes with no pull, and the Graph card's Pull button is the only way in.
export const dod = ["B1-06"];

const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const CARD = '[data-testid="source-card"][data-connector-id="instagram-graph"]';

const start = process.env.LEAD_STUDIO_CLOCK_START;
if (!start) throw new Error("run through schedule-lane.sh, which sets LEAD_STUDIO_CLOCK_START");
const fiveAm = new Date(`${start.slice(0, 10)}T05:00:00`).toISOString();

export default async function schedule01({ page, step, snap }) {
  const card = page.locator(CARD);
  await step("past 05:00 on the app clock nothing pulls on its own: no snapshot, no Graph call, no card event", async () => {
    // The app clock starts at 04:59:30; 45 s of waiting puts it 15 s past the old 05:00 slot.
    await page.waitForTimeout(45_000);
    const counts = sql(`select (select count(*) from own_account_snapshots where captured_at >= '${fiveAm}') || ' ' || (select count(*) from source_calls) || ' ' || (select count(*) from connector_status)`);
    console.log(`snapshots after 05:00, Graph calls, connector_status rows: ${counts}`);
    if (counts !== "0 0 0") throw new Error("something pulled without a click");
  });
  await step("Settings > Sources: Pull on the Graph card pulls now and the card reads Ready", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await card.waitFor({ timeout: 10_000 });
    const before = Number(sql("select count(*) from own_account_snapshots"));
    await card.getByTestId("source-pull").click();
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.dataset.state === "ready" && !document.querySelector(`${sel} [data-testid="source-pull"]`)?.disabled && document.querySelector(`${sel} [data-testid="source-pulls"]`)?.textContent?.startsWith("Last pull"),
      CARD,
      { timeout: 120_000 },
    );
    const after = Number(sql("select count(*) from own_account_snapshots"));
    console.log(`snapshots ${before} -> ${after}; card: ${(await card.getByTestId("source-pulls").innerText())}`);
    console.log(`connector_status: ${sql("select connector_id || ' ' || state || ' ' || pulled_at from connector_status")}`);
    if (after !== before + 1) throw new Error("the pull wrote no snapshot");
  });
  await step("every Graph call is counted in SQLite", async () => {
    const counted = sql("select count(*) from source_calls where source = 'instagram-graph'");
    console.log(`source_calls instagram-graph: ${counted}`);
    if (Number(counted) === 0) throw new Error("no Graph call was counted");
  });
  // profile_activity on a reel is the one refusal the app expects: v23 answers "not supported for
  // this media product type" for every reel, and fetchPostInsights reads it as a complete pull
  // with no bio link taps. Any other refusal is a metric the app should not ask.
  await step("Graph v23 refused nothing the app asked but profile_activity on a reel, and the reel's insights hold watch time and skip rate", async () => {
    const log = path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-graph.log");
    const refused = existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter((l) => l.includes("fake-graph: refused:") && !/profile_activity metric for this media product type/.test(l))
      : [];
    if (refused.length) throw new Error(`${refused.length} refused calls, first: ${refused[0]}`);
    const graph = sql("select state from connector_status where connector_id = 'instagram-graph'");
    if (graph !== "ready") throw new Error(`the Graph pull was ${graph}`);
    const reel = sql("select avg_watch_time_ms || ' ' || skip_rate from own_post_insights i join own_posts p on p.id = i.own_post_id where p.external_id = '17900000000000100' order by i.captured_at desc limit 1");
    console.log(`fake reel insights (avg watch ms, skip rate): ${reel}`);
    if (!/^\d/.test(reel) || reel.split(" ").some((v) => v === "")) throw new Error(`reel insights missing watch time or skip rate: '${reel}'`);
  });
  await snap("schedule-01");
}
