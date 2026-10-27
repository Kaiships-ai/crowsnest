import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Runs on graph-lane.sh (fake Graph). The Graph card: the token form's Test connection (C9),
// Test connection from the card, and Pull my channel with progress, Stop, the long-pull note,
// the hour's calls running out (C11) and an expired token. Each card state is also shot alone,
// dark and light, into data/verify/evidence/graph-states/, named after its prototype frame.
export const dod = [];

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const APP = path.join(ROOT, "data/verify/app");
const STATES = path.join(ROOT, "data/verify/evidence/graph-states");
const port = readFileSync(path.join(APP, "fake-graph.port"), "utf8").trim();
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const fake = async (query = "") => {
  if (!(await fetch(`http://127.0.0.1:${port}/__mode${query}`, { method: "POST" })).ok) throw new Error("fake Graph refused /__mode");
};
const SELECTOR = '[data-testid="source-card"][data-connector-id="instagram-graph"]';
const TOKEN_REJECTED = "Instagram rejected the token (expired). Get a new token and paste it.";
const FORM_REJECTED = "Instagram rejected this token. Copy a new one and paste it again.";
/** The newest pull's measured posts, read the way My reels reads them. */
const measuredLastPull = () => Number(sql("select count(*) from own_post_insights where fetch_error is null and captured_at = (select max(captured_at) from own_post_insights)"));

async function setTheme(page, dark) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, dark);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function graphPull01({ page, step, snap }) {
  const card = page.locator(SELECTOR);
  const waitView = (want, timeout = 60_000) =>
    page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute("data-view") === want, [SELECTOR, want], { timeout });
  const text = async (id) => (await card.getByTestId(id).innerText()).trim();
  const done = async () => Number((await text("source-pull-count")).split(" / ")[0]);
  const waitDone = (n, timeout = 60_000) =>
    page.waitForFunction(
      ([sel, n]) => Number(document.querySelector(sel)?.querySelector('[data-testid="source-pull-count"]')?.innerText.split(" / ")[0] ?? -1) >= n,
      [SELECTOR, n],
      { timeout },
    );
  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
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
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 2_000 }).catch(() => {});
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await card.waitFor({ timeout: 10_000 });
  };
  const disabled = (id) => card.getByTestId(id).isDisabled();

  try {
    await step("a fresh install with no token reads Not connected with Enter token", async () => {
      sql("delete from secrets where name like 'IG_GRAPH_%'; delete from sealed_secrets where name like 'IG_GRAPH_%';");
      await openSources();
      await waitView("not-connected", 10_000);
      const line = await text("graph-line");
      if (line !== "Needs an access token from Business Login for Instagram.") throw new Error(line);
      await shoot("not_connected");
    });

    await step("the token form tests nothing on paste; Save stays off until a passing test (C9)", async () => {
      await card.getByTestId("graph-enter").click();
      await waitView("form", 5_000);
      if (!(await disabled("graph-form-test")) || !(await disabled("graph-form-save"))) throw new Error("an empty form can test or save");
      await shoot("dialog_empty");
      await card.getByTestId("graph-token-input").fill("IGAAexpired-old-token");
      if ((await card.getByTestId("graph-form-check").count()) !== 0) throw new Error("pasting tested the token");
      if (!(await disabled("graph-form-save"))) throw new Error("Save is on before a test");
      await shoot("dialog_pasted");
    });

    await step("a rejected token shows its error inside the form and Save stays off", async () => {
      await card.getByTestId("graph-form-test").click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="graph-form-check"]')?.getAttribute("data-check") === "err", SELECTOR, { timeout: 10_000 });
      const err = await text("graph-form-check");
      if (err !== FORM_REJECTED) throw new Error(err);
      if (!(await disabled("graph-form-save"))) throw new Error("Save is on after a failed test");
      await shoot("dialog_err");
    });

    await step("a good token: Test connection shows Testing, then the handle and id from /me, and Save turns on", async () => {
      await card.getByTestId("graph-token-input").fill("IGAAfake-pr4-token");
      await fake("?delayMs=2000");
      await card.getByTestId("graph-form-test").click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="graph-form-check"]')?.getAttribute("data-check") === "testing", SELECTOR, { timeout: 5_000 });
      await shoot("dialog_testing");
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="graph-form-check"]')?.getAttribute("data-check") === "ok", SELECTOR, { timeout: 10_000 });
      const ok = await text("graph-form-check");
      if (ok !== "✓ Token works · @fake_graph_account · id 17841400000000000") throw new Error(ok);
      if (await disabled("graph-form-save")) throw new Error("Save stayed off after a pass");
      await shoot("dialog_ok");
      await fake();
    });

    await step("Save stores the token and the user id from /me; the card reads Ready with the handle", async () => {
      await card.getByTestId("graph-form-save").click();
      await waitView("ready", 10_000);
      const sample = await text("graph-sample");
      const saved = sql("select group_concat(name) from (select name from sealed_secrets where name like 'IG_GRAPH_%' order by name)");
      console.log(`sample: ${sample} | sealed: ${saved}`);
      if (sample !== "@fake_graph_account") throw new Error(sample);
      if (saved !== "IG_GRAPH_TOKEN,IG_GRAPH_USER_ID") throw new Error(saved);
      if (!/calls left this hour/.test(await text("graph-last-pull"))) throw new Error(await text("graph-last-pull"));
    });

    await step("Test connection from the card shows Testing, then Ready", async () => {
      await fake("?delayMs=2000");
      await card.getByTestId("graph-test").click();
      await waitView("testing", 5_000);
      if ((await text("graph-line")) !== "Testing the token with Instagram (/me)…") throw new Error(await text("graph-line"));
      await shoot("checking");
      await waitView("ready", 15_000);
      await fake();
      await shoot("ready");
    });

    await step("Pull my channel shows the post being pulled, x of N rising, calls left this hour and Stop", async () => {
      await fake("?posts=20&delayMs=150");
      await card.getByTestId("graph-pull").click();
      await waitView("pulling", 10_000);
      await waitDone(3, 20_000);
      const first = await done();
      await page.waitForTimeout(1_000);
      const later = await done();
      const current = await text("source-pull-current");
      const count = await text("source-pull-count");
      const left = await text("source-pull-tally-rest");
      console.log(`progress: ${first} then ${later} | ${current} | ${count} | ${left}`);
      if (later <= first) throw new Error("x of N did not rise");
      if (!/^Pulling post “fake reel \d\d: 3 Claude Code…”$/.test(current)) throw new Error(current);
      if (!count.endsWith("/ 20 posts")) throw new Error(count);
      if (!/^\d+ calls left this hour$/.test(left)) throw new Error(left);
      if (!(await card.getByTestId("source-pull-stop").isEnabled())) throw new Error("no Stop");
      await snap("graph-pull-01-pulling");
      await shoot("pulling");
    });

    await step("the pull ends with the summary: posts measured equal the rows written, followers, calls left", async () => {
      await waitView("done", 60_000);
      const summary = await text("source-pull-summary");
      const measured = measuredLastPull();
      console.log(`summary: ${summary.replace(/\s+/g, " ")} | db measured ${measured}`);
      if (!summary.includes("Pulled 20/20 posts")) throw new Error(summary);
      if (!new RegExp(`Posts measured\\s+${measured}\\b`).test(summary) || measured !== 20) throw new Error(`summary vs db ${measured}`);
      if (!/Followers\s+1,234/.test(summary)) throw new Error(summary);
      if (!/Calls left this hour\s+\d+\/200/.test(summary)) throw new Error(summary);
      await shoot("done");
    });

    await step("a pull on an expired token reads Error and tells you to get a new token", async () => {
      await fake("?expired=1");
      await card.getByTestId("graph-pull").click();
      await waitView("error", 15_000);
      const line = await text("graph-line");
      if (line !== TOKEN_REJECTED) throw new Error(line);
      if ((await text("graph-enter")) !== "Change token" || (await card.getByTestId("graph-test").count()) !== 1) throw new Error("Error lacks Change token or Test connection");
      await shoot("error");
    });

    await step("the token works again: Test connection passes, the pull's Error stays, and Pull my channel clears it", async () => {
      await fake("?posts=3");
      await card.getByTestId("graph-test").click();
      await page.waitForFunction((sel) => !!document.querySelector(sel)?.querySelector('[data-testid="graph-pull"]'), SELECTOR, { timeout: 15_000 });
      if ((await card.getAttribute("data-view")) !== "error") throw new Error("a passing check hid the pull's error");
      await card.getByTestId("graph-pull").click();
      await waitView("done", 30_000);
      if (!(await text("source-pull-summary")).includes("Pulled 3/3 posts")) throw new Error(await text("source-pull-summary"));
    });

    await step("Stop finishes the post in hand, then the card reads Partial with the done count", async () => {
      await fake("?posts=20&delayMs=400");
      await card.getByTestId("graph-pull").click();
      await waitView("pulling", 10_000);
      await waitDone(4, 30_000);
      await card.getByTestId("source-pull-stop").click();
      if ((await text("source-pull-current")) !== "Stopping after this post…") throw new Error(await text("source-pull-current"));
      await shoot("stopping");
      await waitView("stopped", 20_000);
      const line = await text("graph-line");
      const n = Number(sql("select progress_done from connector_status where connector_id = 'instagram-graph'"));
      const measured = measuredLastPull();
      console.log(`stopped: ${line} | ${await text("graph-rest-line")} | db done ${n}, measured ${measured}`);
      if (line !== `You stopped the pull at ${measured}/20 posts.`) throw new Error(line);
      if (n !== measured || measured >= 20) throw new Error(`done ${n}, measured ${measured}`);
      if ((await text("graph-pull-rest")) !== `Pull the rest (${20 - measured})`) throw new Error(await text("graph-pull-rest"));
      await shoot("stopped");
    });

    await step("a pull past 2 minutes adds the long-pull note and the pill stays Pulling", async () => {
      await fake("?posts=50&delayMs=6000");
      await card.getByTestId("graph-pull-rest").click();
      await waitView("pulling", 15_000);
      await card.getByTestId("source-pull-long").waitFor({ timeout: 150_000 });
      const note = await text("source-pull-long");
      console.log(`long: ${note}`);
      if (!/^Taking longer than usual \(2:\d\d\)\. Graph is answering slowly\. You can leave Settings; the pull keeps going\.$/.test(note)) throw new Error(note);
      await shoot("long");
      await card.getByTestId("source-pull-stop").click();
      await waitView("stopped", 30_000);
      await fake();
    });

    await step("the hour's calls run out at post 31: Partial, Pull the rest off until the oldest call plus an hour (C11)", async () => {
      await fake("?posts=50&budget=62");
      await card.getByTestId("graph-pull-rest").click();
      await waitView("limited", 60_000);
      const line = await text("graph-line");
      const rest = await text("graph-rest-line");
      const button = await text("graph-pull-rest");
      const row = sql("select retry_after from connector_status where connector_id = 'instagram-graph'");
      const oldest = Number(sql("select min(called_at) from source_calls where source = 'instagram-graph'"));
      console.log(`limited: ${line} | ${rest} | ${button} | retry_after ${row}, oldest call ${new Date(oldest).toISOString()}`);
      // Pull the rest leaves out the posts the long pull measured, so N is 50 less those.
      const n = Number(sql("select progress_total from connector_status where connector_id = 'instagram-graph'"));
      if (line !== `Pulled 30/${n} posts. The 200 calls for this hour are used up.`) throw new Error(line);
      if (!new RegExp(`^The other ${n - 30} posts keep their older numbers\\. Pull the rest after \\d\\d:\\d\\d( [AP]M)?\\.$`).test(rest)) throw new Error(rest);
      if (Date.parse(row) !== oldest + 3_600_000) throw new Error(`retry_after ${row} is not the oldest call plus an hour`);
      if (!button.startsWith(`Pull the rest (${n - 30}) · after `) || !(await disabled("graph-pull-rest"))) throw new Error(button);
      await shoot("partial");
      await fake();
    });

  } finally {
    await fake().catch(() => {});
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
