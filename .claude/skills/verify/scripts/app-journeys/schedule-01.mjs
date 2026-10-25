import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
    for (const id of ["chatbotx", "polar", "umami"]) if (!list.includes(`${id}=skipped (not-connected)`)) throw new Error(`${id} was not skipped and reported`);
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
  await snap("schedule-01");
}
