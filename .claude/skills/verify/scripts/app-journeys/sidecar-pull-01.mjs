import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). The sidecar card's switch, its Test connection, and the
// rival pull: progress while it runs, Stop, the long-pull note, an Instagram limit, and the
// sidecar dying mid-pull. Each card state is also shot alone, dark and light, into
// data/verify/evidence/sidecar-states/ so it can sit beside the prototype frame of the same name.
export const dod = [];

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const APP = path.join(ROOT, "data/verify/app");
const STATES = path.join(ROOT, "data/verify/evidence/sidecar-states");
const port = readFileSync(path.join(APP, "fake-sidecar.port"), "utf8").trim();
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const fake = async (route, query = "") => {
  if (!(await fetch(`http://127.0.0.1:${port}/${route}${query}`, { method: "POST" })).ok) throw new Error(`fake sidecar refused /${route}`);
};
const RIVALS = Array.from({ length: 12 }, (_, i) => `@pull01_rival_${String(i + 1).padStart(2, "0")}`);
const SELECTOR = '[data-testid="source-card"][data-connector-id="ig-sidecar"]';

async function setTheme(page, dark) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, dark);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function sidecarPull01({ page, step, snap }) {
  const card = page.locator(SELECTOR);
  const view = () => card.getAttribute("data-view");
  const waitView = (want, timeout = 60_000) =>
    page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute("data-view") === want, [SELECTOR, want], { timeout });
  const count = async () => (await card.getByTestId("source-pull-count").innerText()).trim();
  const done = async () => Number((await count()).split(" / ")[0]);
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  /** The card alone in both themes, named after the prototype frame it matches. */
  const shoot = async (state) => {
    mkdirSync(STATES, { recursive: true });
    for (const dark of [true, false]) {
      await setTheme(page, dark);
      await card.screenshot({ path: path.join(STATES, `${state}-${dark ? "dark" : "light"}.png`) });
    }
    await setTheme(page, wasDark);
    console.log(`state shot: ${state}`);
  };
  const openSources = async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await card.waitFor({ timeout: 10_000 });
  };
  let total = 0;
  const added = [];

  try {
    await step(`setup: ${RIVALS.length} rivals tracked, and the fake answers /medias`, async () => {
      await fake("__medias", "?state=empty");
      for (const handle of RIVALS) {
        const res = await call(page, "addChannelAction", handle);
        if (!res.ok || !res.value.ok) throw new Error(`add ${handle}: ${JSON.stringify(res)}`);
        added.push(res.value.channelId);
      }
      total = Number(sql("select count(*) from channels where platform = 'instagram' and deleted_at is null and is_own = 0"));
      console.log(`rivals to pull: ${total}`);
    });

    await step("the switch off shows the C2 sentence; on brings the card back", async () => {
      await openSources();
      await card.getByTestId("sidecar-switch").click();
      await waitView("off", 10_000);
      const text = await card.getByTestId("sidecar-line").innerText();
      const offAt = sql("select coalesce(off_at, '') from connector_status where connector_id = 'ig-sidecar'");
      console.log(`off: ${text} | db off_at ${offAt}`);
      if (text !== "The sidecar is off. Turn it on to connect Instagram.") throw new Error(text);
      if (!offAt) throw new Error("the switch did not record off_at");
      await shoot("off");
      await card.getByTestId("sidecar-switch").click();
      await page.waitForFunction((sel) => !["off", "starting"].includes(document.querySelector(sel)?.getAttribute("data-view")), SELECTOR, { timeout: 15_000 });
    });

    await step("a sidecar with no Instagram session reads Not connected (C3)", async () => {
      await fake("__mode", "?loggedOut=1");
      await page.getByRole("button", { name: "Back to app" }).click();
      await openSources();
      await waitView("not-connected", 10_000);
      const help = await page.locator(SELECTOR).getByTestId("sidecar-session-help").innerText();
      if (!help.includes("How to get a session id")) throw new Error(`no session id help link: ${help}`);
      await shoot("not_connected");
      await fake("__mode");
    });

    await step("Test connection from the card shows Testing, then Ready with the sample (C5, C6)", async () => {
      await page.getByRole("button", { name: "Back to app" }).click();
      await openSources();
      await page.waitForFunction((sel) => !!document.querySelector(sel)?.querySelector('[data-testid="sidecar-test"]'), SELECTOR, { timeout: 10_000 });
      await fake("__mode", "?delayMs=2500");
      await card.getByTestId("sidecar-test").click();
      await waitView("testing", 5_000);
      await shoot("checking");
      await waitView("ready", 15_000);
      const sample = await card.getByTestId("sidecar-sample").innerText();
      console.log(`sample: ${sample}`);
      if (!sample.includes("@fake_sidecar · 2,500 followers · 30 posts")) throw new Error(sample);
      await shoot("ready");
    });

    await step("Pull rivals shows the current rival, x of N rising, the elapsed time and Stop", async () => {
      await fake("__mode", "?delayMs=700");
      await card.getByTestId("sidecar-pull").click();
      await waitView("pulling", 10_000);
      await page.waitForFunction((sel) => /^\d+ \/ \d+ rivals$/.test(document.querySelector(sel)?.querySelector('[data-testid="source-pull-count"]')?.innerText ?? ""), SELECTOR, { timeout: 10_000 });
      const first = await done();
      await page.waitForTimeout(3_000);
      const later = await done();
      const current = await card.getByTestId("source-pull-current").innerText();
      const elapsed = await card.getByTestId("source-pull-elapsed").innerText();
      console.log(`progress: ${first} then ${later} of ${total} | ${current} | ${elapsed}`);
      if (!(await count()).endsWith(`/ ${total} rivals`)) throw new Error(await count());
      if (later <= first) throw new Error("x of N did not rise");
      if (!/^Pulling @\S+…$/.test(current)) throw new Error(current);
      if (!/^\d+:\d\d$/.test(elapsed)) throw new Error(elapsed);
      if (!(await card.getByTestId("source-pull-stop").isEnabled())) throw new Error("no Stop");
      await snap("sidecar-pull-01-pulling");
      await shoot("pulling");
    });

    await step("leaving Sources and coming back: the card still shows progress, still rising", async () => {
      const before = await done();
      await page.getByRole("button", { name: "Back to app" }).click();
      await page.waitForTimeout(1_500);
      await openSources();
      await waitView("pulling", 5_000);
      await page.waitForTimeout(1_500);
      const after = await done();
      console.log(`return: ${before} then ${after}`);
      if (after <= before) throw new Error("progress stopped while away");
    });

    await step("the pull ends with the summary: rivals updated, new reels, failed", async () => {
      await waitView("done", 90_000);
      const cells = await card.getByTestId("source-pull-summary").innerText();
      const row = sql("select pull_state || ' ' || progress_done || '/' || progress_total from connector_status where connector_id = 'ig-sidecar'");
      console.log(`summary: ${cells.replace(/\s+/g, " ")} | db ${row}`);
      if (!cells.includes(`Pulled ${total}/${total} rivals`)) throw new Error(cells);
      if (!new RegExp(`Rivals updated\\s+${total}\\b`).test(cells) || !/Failed\s+0/.test(cells)) throw new Error(cells);
      if (row !== `ready ${total}/${total}`) throw new Error(row);
      await snap("sidecar-pull-01-done");
      await shoot("done");
    });

    await step("Stop finishes the rival in hand, then the card reads Partial with the done count", async () => {
      await fake("__mode", "?delayMs=1500");
      const startedAt = new Date().toISOString();
      await card.getByTestId("sidecar-pull").click();
      await waitView("pulling", 10_000);
      await page.waitForFunction((sel) => Number(document.querySelector(sel)?.querySelector('[data-testid="source-pull-count"]')?.innerText.split(" / ")[0]) >= 2, SELECTOR, { timeout: 30_000 });
      await card.getByTestId("source-pull-stop").click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="source-pull-current"]')?.innerText.startsWith("Stopping after"), SELECTOR, { timeout: 5_000 });
      await shoot("stopping");
      await waitView("stopped", 30_000);
      const line = await card.getByTestId("sidecar-line").innerText();
      const rest = await card.getByTestId("sidecar-rest-line").innerText();
      const updated = Number(line.match(/at (\d+)\//)[1]);
      const rows = Number(sql(`select count(*) from channels where deleted_at is null and is_own = 0 and last_successful_sync_at >= '${startedAt}'`));
      console.log(`stopped: ${line} | ${rest} | rows updated in the DB: ${rows}`);
      if (line !== `You stopped the pull at ${updated}/${total}.`) throw new Error(line);
      if (!rest.startsWith(`${updated} rivals have new numbers. The other ${total - updated} keep their numbers`)) throw new Error(rest);
      if (rows !== updated) throw new Error(`${rows} rows changed, card says ${updated}`);
      if ((await card.getByTestId("sidecar-pull-rest").innerText()) !== `Pull the rest (${total - updated})`) throw new Error("no Pull the rest");
      await snap("sidecar-pull-01-stopped");
      await shoot("stopped");
    });

    await step("a pull past 2 minutes adds the long-pull note and the pill stays Pulling", async () => {
      // Still running at 2:00 with two rivals in flight, and under the client's 30 s request timeout.
      await fake("__mode", "?delayMs=25000");
      await card.getByTestId("sidecar-pull").click();
      await waitView("pulling", 10_000);
      await card.getByTestId("source-pull-long").waitFor({ timeout: 150_000 });
      const note = await card.getByTestId("source-pull-long").innerText();
      console.log(`long: ${note}`);
      if (!note.startsWith("Taking longer than usual (2:")) throw new Error(note);
      if ((await view()) !== "pulling") throw new Error(await view());
      await snap("sidecar-pull-01-long");
      await shoot("long");
      await card.getByTestId("source-pull-stop").click();
      await waitView("stopped", 75_000);
    });

    await step("an Instagram limit ends the whole pull: Partial, the limited rival named, Pull the rest off until the retry time", async () => {
      await fake("__mode", "?limitAt=4&retryAfterSec=25&delayMs=200");
      await card.getByTestId("sidecar-pull").click();
      await waitView("limited", 30_000);
      const line = await card.getByTestId("sidecar-line").innerText();
      const rest = card.getByTestId("sidecar-pull-rest");
      const win = await card.getByTestId("sidecar-limit-window").innerText();
      const [retryAfter, items] = sql("select retry_after || char(9) || summary from connector_status where connector_id = 'ig-sidecar'").split("\t");
      const pull = JSON.parse(items).pull;
      const waitSec = Math.round((Date.parse(retryAfter) - Date.now()) / 1000);
      console.log(`limited: ${line} | ${await rest.innerText()} | ${win.replace(/\s+/g, " ")} | retry in ${waitSec}s | done ${pull.done} not pulled ${pull.items.filter((i) => i.result === "not-pulled").length}`);
      // With syncConcurrency 2 the rival beside the limited one may finish too, never more.
      if (line !== `Instagram is limiting requests. The pull stopped at ${pull.updated}/${total}.`) throw new Error(line);
      if (pull.updated < 3 || pull.done > pull.updated + 2) throw new Error(`the pull went on after the limit: done ${pull.done}, updated ${pull.updated}`);
      if (!win.includes("limited by Instagram")) throw new Error(win);
      if (!(await rest.isDisabled()) || !/· after \d\d:\d\d/.test(await rest.innerText())) throw new Error("Pull the rest is on before the retry time");
      if (waitSec < 15 || waitSec > 26) throw new Error(`retry_after is ${waitSec}s away, the sidecar said 25`);
      await snap("sidecar-pull-01-limited");
      await shoot("limited");
      await fake("__mode");
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="sidecar-pull-rest"]')?.disabled === false, SELECTOR, { timeout: 40_000 });
      await rest.click();
      await waitView("done", 60_000);
    });

    await step("the sidecar dies mid-pull: the card reads Partial with the done count within 15 seconds", async () => {
      await fake("__mode", "?dieAt=3&downMs=6000&delayMs=300");
      const killedAt = Date.now();
      await card.getByTestId("sidecar-pull").click();
      await waitView("off-mid", 20_000);
      const line = await card.getByTestId("sidecar-line").innerText();
      console.log(`sidecar died: ${line} | after ${Math.round((Date.now() - killedAt) / 1000)}s | db ${sql("select pull_state from connector_status where connector_id = 'ig-sidecar'")}`);
      if (!/^The sidecar stopped during the pull, at [23]\/\d+\.$/.test(line) || !line.endsWith(`/${total}.`)) throw new Error(line);
      await snap("sidecar-pull-01-off-mid");
      await shoot("off_mid");
      // Only press once the fake answers again: on a dead sidecar the button would spawn a real one.
      await page.waitForTimeout(7_000);
      await page.getByRole("button", { name: "Back to app" }).click();
      await openSources();
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="sidecar-pull-rest"]')?.innerText.startsWith("Pull the rest ("), SELECTOR, { timeout: 10_000 });
      await card.getByTestId("sidecar-pull-rest").click();
      await waitView("done", 60_000);
    });

    await step("an Instagram limit on Test connection reads Error with the retry time, Test off until then (C8)", async () => {
      await fake("__mode", "?limitAt=1&retryAfterSec=20");
      await card.getByTestId("sidecar-test").click();
      await waitView("limited-test", 15_000);
      const line = await card.getByTestId("sidecar-line").innerText();
      console.log(`limited test: ${line}`);
      if (!/^Instagram is limiting requests\. Try again after \d\d:\d\d( [AP]M)?\.$/.test(line)) throw new Error(line);
      if (!(await card.getByTestId("sidecar-test").isDisabled())) throw new Error("Test connection is on before the retry time");
      await shoot("limited_check");
      await fake("__mode");
      await page.waitForTimeout(21_000);
      await page.getByRole("button", { name: "Back to app" }).click();
      await openSources();
      await card.getByTestId("sidecar-test").click();
      await waitView("ready", 15_000);
    });

    await step("an expired session on Test connection reads Error with the C7 sentence", async () => {
      await fake("__session", "?state=expired");
      await card.getByTestId("sidecar-test").click();
      await waitView("error", 15_000);
      const line = await card.getByTestId("sidecar-line").innerText();
      if (line !== "The session id expired. Sign in to instagram.com and copy a new session id.") throw new Error(line);
      await shoot("expired");
      await fake("__session", "?state=ok");
      await card.getByTestId("sidecar-test").click();
      await waitView("ready", 15_000);
    });
  } finally {
    await fake("__mode").catch(() => {});
    await fake("__medias", "?state=refuse").catch(() => {});
    await fake("__session", "?state=ok").catch(() => {});
    // Leave the switch on for the journeys after this one; the fake answers, so nothing is spawned.
    if (sql("select coalesce(off_at, '') from connector_status where connector_id = 'ig-sidecar'")) await call(page, "startSidecarAction").catch(() => {});
    for (const id of added) await call(page, "removeChannelAction", id).catch(() => {});
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
