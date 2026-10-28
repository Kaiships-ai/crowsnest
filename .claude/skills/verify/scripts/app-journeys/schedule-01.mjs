import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// DoD ids whose pass criterion this journey asserts (run-all-report.mjs reads this line).
export const dod = ["B1-06"];

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();

const start = process.env.LEAD_STUDIO_CLOCK_START;
if (!start) throw new Error("run through schedule-lane.sh, which sets LEAD_STUDIO_CLOCK_START");
const today = start.slice(0, 10);
const yesterdayDate = new Date(`${today}T12:00:00`);
yesterdayDate.setDate(yesterdayDate.getDate() - 1);
const yesterday = yesterdayDate.toLocaleDateString("sv-SE");
const fiveAm = new Date(`${today}T05:00:00`).toISOString();
const sixAm = new Date(`${today}T06:00:00`).toISOString();

async function until(label, check, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const rows = (slot) => sql(`select connector_id || '=' || coalesce(outcome, 'running') || coalesce(' (' || detail || ')', '') from daily_pulls where slot = '${slot}' order by connector_id`);

export default async function schedule01({ page, step, snap }) {
  await step("on start the app pulls the slot it missed (yesterday's 05:00) once", async () => {
    await until("yesterday's Graph pull", () => sql(`select outcome from daily_pulls where slot = '${yesterday}' and connector_id = 'instagram-graph' and outcome is not null`));
    console.log(`daily_pulls ${yesterday}:\n${rows(yesterday)}`);
  });
  await step("after the clock passes 05:00 every source pulls on its own, with no command", async () => {
    await until("today's slot to finish", () => sql(`select count(*) from daily_pulls where slot = '${today}' and outcome is not null`) === "6");
    const list = rows(today);
    console.log(`daily_pulls ${today}:\n${list}`);
    const started = sql(`select min(started_at) from daily_pulls where slot = '${today}'`);
    console.log(`today's slot started at ${started}, 05:00 local is ${fiveAm}`);
    if (started < fiveAm) throw new Error("today's slot ran before 05:00");
    if (!list.includes("instagram-graph=complete")) throw new Error("the Graph pull did not complete");
    for (const skip of ["chatbotx=skipped (not-connected)", "polar=skipped (not-connected)", "umami=skipped (needs-setup)"]) {
      if (!list.includes(skip)) throw new Error(`${skip.split("=")[0]} was not skipped and reported`);
    }
  });
  await step("the 05:00 pull wrote a new account snapshot", async () => {
    const snapshot = sql(`select captured_at || ' ' || username || ' followers=' || follower_count from own_account_snapshots where captured_at >= '${fiveAm}' and captured_at < '${sixAm}' order by captured_at limit 1`);
    console.log(`own_account_snapshots after 05:00: ${snapshot}`);
    if (!snapshot.includes("fake_graph_account")) throw new Error("no snapshot from the 05:00 pull");
  });
  await step("the job log records each connector's outcome", async () => {
    const lines = sql(`select count(*) from log_events where event = 'daily_pull.connector'`);
    console.log(`log_events daily_pull.connector rows: ${lines}`);
    if (Number(lines) < 12) throw new Error("expected a log line per connector for both slots");
  });
  await step("pull again pulls one source now through the bridge, outside the slot", async () => {
    const before = Number(sql("select count(*) from own_account_snapshots"));
    const res = await call(page, "pullAgain", "instagram-graph");
    console.log(`pullAgain(instagram-graph): ${JSON.stringify(res)}`);
    if (!res.ok || res.value.outcome !== "complete") throw new Error(JSON.stringify(res));
    const after = Number(sql("select count(*) from own_account_snapshots"));
    console.log(`snapshots ${before} -> ${after}; daily_pulls rows: ${sql("select count(*) from daily_pulls")}`);
    if (after !== before + 1) throw new Error("pull again wrote no snapshot");
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
    const graph = sql("select slot || ' ' || outcome || coalesce(' (' || detail || ')', '') from daily_pulls where connector_id = 'instagram-graph' order by slot");
    console.log(`instagram-graph pulls:\n${graph}`);
    if (graph.split("\n").some((l) => !l.includes(" complete"))) throw new Error("a Graph pull was not complete");
    const reel = sql("select avg_watch_time_ms || ' ' || skip_rate from own_post_insights i join own_posts p on p.id = i.own_post_id where p.external_id = '17900000000000100' order by i.captured_at desc limit 1");
    console.log(`fake reel insights (avg watch ms, skip rate): ${reel}`);
    if (!/^\d/.test(reel) || reel.split(" ").some((v) => v === "")) throw new Error(`reel insights missing watch time or skip rate: '${reel}'`);
  });
  await snap("schedule-01");
}
