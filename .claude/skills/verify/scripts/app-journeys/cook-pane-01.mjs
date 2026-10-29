// Cook pane (proto v2 states 02 to 11 and the failures job.json can express) on a temp studio-reel
// copy. Claude is a fake, so nothing really cooks: the journey writes films/<slug>/job.json step by
// step with studio-reel's own core/job.mjs when the lane copy has it, else in the same format, and
// reads the pane after each write.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const dod = ["B5-01"];

const { userDataDir, cookRoot: ROOT } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const PLAN = "plan-e2e-full";
const SLUG = "plan01-full-script-e-full";
const FILM = path.join(ROOT, "films", SLUG);
const JOB = path.join(FILM, "job.json");
const JOB_MJS = path.join(ROOT, "core/job.mjs");
const STAGES = ["script", "voice", "storyboard", "chapters", "audio", "draft", "render", "verify", "review", "deliver"];
const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
const DEAD_PID = 4_000_007;

/** One job.mjs step write, then the proposed fields (started, pid) job.mjs does not write yet. */
function job(step, status, extra = {}) {
  mkdirSync(FILM, { recursive: true });
  if (existsSync(JOB_MJS)) {
    // Why realpath: job.mjs runs as a CLI only when argv[1] is its real path, and /tmp is a link on macOS.
    execFileSync("node", [realpathSync(JOB_MJS), FILM, step, status, ...(extra.pct != null ? [`--pct=${extra.pct}`] : []), ...(extra.qa ? [`--qa=${extra.qa}`] : [])], { cwd: ROOT });
  } else {
    const j = existsSync(JOB) ? JSON.parse(readFileSync(JOB, "utf8")) : { slug: SLUG, campaign: null, steps: STAGES.map((name) => ({ name, status: "pending" })), outputs: [] };
    const s = j.steps.find((x) => x.name === step);
    s.status = status;
    if (status === "running" && extra.pct != null) s.pct = extra.pct;
    else delete s.pct;
    if (extra.qa) j.qa = extra.qa;
    writeFileSync(JOB, JSON.stringify(j, null, 1));
  }
  const j = JSON.parse(readFileSync(JOB, "utf8"));
  Object.assign(j.steps.find((x) => x.name === step), extra.started ? { started: extra.started } : {}, extra.pid ? { pid: extra.pid } : {});
  writeFileSync(JOB, JSON.stringify(j, null, 1));
}
const doneThrough = (last) => {
  for (const s of STAGES.slice(0, STAGES.indexOf(last) + 1)) job(s, "done");
};

export default async function cookPane01({ page, step, snap }) {
  const board = page.locator('[data-testid="board-tab"]:visible');
  const pane = page.locator(`[data-testid="cook-pane"][data-plan-id="${PLAN}"]`);
  const card = pane.getByTestId("cook-card");
  const home = await page.evaluate(() => window.__store.getState().activeWorktreeId);
  let key;
  const readLayout = () => {
    const s = window.__store.getState();
    const k = s.activeWorktreeId;
    const groups = s.groupsByWorktree[k] ?? [];
    const tabs = s.unifiedTabsByWorktree[k] ?? [];
    const claude = (s.tabsByWorktree[k] ?? []).filter((t) => t.launchAgent === "claude").at(-1);
    const where = (pred) => groups.findIndex((g) => g.tabOrder.some((id) => pred(tabs.find((t) => t.id === id))));
    return { key: k, groups: groups.length, layout: s.layoutByWorktree[k]?.type, direction: s.layoutByWorktree[k]?.direction, cook: where((t) => t?.entityId?.startsWith("board::cook::")), claude: claude ? where((t) => t?.entityId === claude.id) : -1, cookTabs: tabs.filter((t) => t.entityId?.startsWith("board::cook::")).length };
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  // COOK_PANE_THEME=dark shoots the states in dark, as the proto v2 shots are.
  const dark = process.env.COOK_PANE_THEME === "dark";
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);

  const expectCard = async (state, shot) => {
    const shown = card.and(page.locator(`[data-state="${state}"]`));
    await shown.waitFor({ timeout: 5_000 });
    // Why: the pane polls once a second and may first show a step in between the journey's writes.
    await page.waitForTimeout(1_200);
    await shown.waitFor({ timeout: 5_000 });
    const head = await card.getByTestId("cook-card-head").innerText();
    const sub = (await card.getByTestId("cook-card-sub").count()) ? await card.getByTestId("cook-card-sub").innerText() : "";
    const strip = await pane.getByTestId("cook-segment").evaluateAll((els) => els.map((e) => `${e.textContent.replace(/\d+:\d\d/, "").trim()}=${e.dataset.state}`).join(" "));
    console.log(`card ${state} (${await card.getAttribute("data-tone")}): ${head} | ${sub}\nstrip: ${strip}`);
    await snap(shot);
    // A proof video holds each state long enough to read (COOK_PANE_PAUSE_MS).
    await page.waitForTimeout(Number(process.env.COOK_PANE_PAUSE_MS ?? 0));
    return { head, sub, strip };
  };

  await step("Claude is a fake for this lane, and the lane has no film yet", async () => {
    const fake = path.join(ROOT, "..", "fake-claude.sh");
    writeFileSync(fake, '#!/bin/sh\necho "fake claude $*"\nexec cat\n');
    chmodSync(fake, 0o755);
    await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
    rmSync(FILM, { recursive: true, force: true });
    // The seeded reel has no keyword; Cook writes it as campaign: and job.mjs copies it into job.json.
    sql(`update planned_posts set cook_workspace_id = null, keyword = coalesce(keyword, 'COOKPANE') where id = '${PLAN}'`);
    console.log(`claude: ${fake}\njob.mjs: ${existsSync(JOB_MJS) ? "studio-reel core/job.mjs" : "inline writer, same format"}`);
  });

  await step("Cook on the Plan card opens the reel workspace split: the Cook pane left, Claude right", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("plan-view-week").click();
    // A rerun reset the row under a board that is already open.
    await board.getByTestId("board-refresh").click();
    await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).click();
    await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook").click();
    await page.waitForFunction(() => window.__store.getState().folderWorkspaces.some((w) => w.name === "Reel: PLAN01 full script"), null, { timeout: 15_000 });
    await pane.waitFor({ timeout: 10_000 });
    // Why wait: the Claude tab lands a moment after the pane on a rerun that reuses the workspace.
    await page.waitForFunction(`(${readLayout})().claude === 1`, null, { timeout: 10_000 }).catch(() => {});
    const layout = await page.evaluate(readLayout);
    console.log(`layout: ${JSON.stringify(layout)}`);
    key = layout.key;
    if (layout.groups !== 2 || layout.layout !== "split" || layout.cook !== 0 || layout.claude !== 1 || layout.cookTabs !== 1) throw new Error(`workspace is not split Cook | Claude: ${JSON.stringify(layout)}`);
    const front = readFileSync(path.join(ROOT, `workspace/scripts/${SLUG}.md`), "utf8").split("---")[1];
    console.log(`front matter:${front}`);
    if (!/\ncampaign: \S+\n/.test(front)) throw new Error("no campaign: in the script front matter");
  });

  await step("02 agent starting: no job.json yet, the card says Claude is starting", async () => {
    const { head } = await expectCard("starting", "cook-pane-02-starting");
    if (head !== "Starting Claude in this workspace") throw new Error(head);
    if ((await pane.getByTestId("cook-script").getAttribute("data-source")) !== "plan") throw new Error("script box is not the plan's script");
  });

  await step("04 writing script: step 1 of 6 with the time so far", async () => {
    job("script", "running", { started: ago(40) });
    const { sub, strip } = await expectCard("script", "cook-pane-04-script");
    if (!/^Step 1 of 6 · word for word · 0:4\d so far$/.test(sub) || !strip.startsWith("Script=current")) throw new Error(sub);
    const campaign = JSON.parse(readFileSync(JOB, "utf8")).campaign;
    console.log(`job.json campaign: ${campaign}`);
    if (existsSync(JOB_MJS) && !campaign) throw new Error("job.mjs found no campaign");
  });

  await step("05 script ready: voice running, the script box reads vo/script.json", async () => {
    mkdirSync(path.join(FILM, "vo"), { recursive: true });
    writeFileSync(path.join(FILM, "vo/script.json"), JSON.stringify({ lines: [{ id: "l01", text: "Claude Code runs your script before every edit." }, { id: "l02", text: "A hook is one line in settings.json." }, { id: "l03", text: "Comment HOOKS and I'll send you my five hooks." }] }));
    job("script", "done");
    job("voice", "running", { started: ago(20), pid: process.pid });
    const { strip } = await expectCard("script-ready", "cook-pane-05-script-ready");
    if (!strip.startsWith("✓ Script=done Voice=current")) throw new Error(strip);
    await pane.locator('[data-testid="cook-script"][data-source="vo"]').waitFor({ timeout: 3_000 });
  });

  await step("06 building chapters: step 3 of 6, 6:40 so far", async () => {
    job("voice", "done");
    job("storyboard", "done");
    job("chapters", "running", { started: ago(400) });
    const { sub } = await expectCard("building", "cook-pane-06-building");
    if (!/^Step 3 of 6 · 6:4\d so far$/.test(sub)) throw new Error(sub);
  });

  await step("07 rendering the draft: the real pct from job.json", async () => {
    job("chapters", "done");
    job("audio", "done");
    job("draft", "running", { pct: 60, started: ago(15), pid: process.pid });
    const { sub } = await expectCard("draft", "cook-pane-07-draft");
    if (!sub.startsWith("Step 4 of 6 · 270×480 at 8 fps · 60%")) throw new Error(sub);
    const width = await pane.locator('[data-testid="cook-segment"][data-state="current"] b').evaluate((e) => e.style.width);
    if (width !== "60%") throw new Error(`draft bar ${width}`);
  });

  await step("09 rendering the final: elapsed against the usual 3:00, never a %", async () => {
    job("draft", "done");
    job("render", "running", { started: ago(90), pid: process.pid });
    const { sub } = await expectCard("rendering", "cook-pane-09-rendering");
    if (!/^Step 5 of 6 · 1:3\d so far, usually about 3:00$/.test(sub) || sub.includes("%")) throw new Error(sub);
    const bar = await pane.locator('[data-testid="cook-segment"][data-state="current"] b').evaluate((e) => [e.style.width, e.dataset.indeterminate]);
    if (bar[0] !== "100%" || bar[1] !== "true") throw new Error(`final bar ${bar} is not indeterminate`);
  });

  await step("10 long render: past 2x usual the card stays neutral with one amber line", async () => {
    job("render", "running", { started: ago(460), pid: process.pid });
    const { sub } = await expectCard("long-render", "cook-pane-10-long-render");
    if ((await card.getAttribute("data-tone")) !== "run" || !/^Step 5 of 6 · 7:4\d so far, usually about 3:00$/.test(sub)) throw new Error(sub);
    console.log(`note: ${await card.getByTestId("cook-card-note").innerText()}`);
  });

  await step("the render's pid is gone: a red card with Resume cook", async () => {
    job("render", "running", { started: ago(470), pid: DEAD_PID });
    const { sub } = await expectCard("pid-gone", "cook-pane-pid-gone");
    if (!sub.endsWith("The final starts again from frame 0 (about 3 min).")) throw new Error(sub);
    if ((await card.getAttribute("data-tone")) !== "err") throw new Error("not red");
    await card.getByTestId("cook-resume").waitFor({ timeout: 2_000 });
  });

  await step("a failed step: a red card with Resume cook", async () => {
    job("render", "failed");
    const { strip } = await expectCard("step-failed", "cook-pane-step-failed");
    if (!strip.includes("Final=failed")) throw new Error(strip);
  });

  await step("Resume cook starts another Claude beside the pane with /make-reel", async () => {
    const before = await page.evaluate((k) => (window.__store.getState().tabsByWorktree[k] ?? []).filter((t) => t.launchAgent === "claude").length, key);
    await card.getByTestId("cook-resume").click();
    await page.waitForFunction(([k, n]) => (window.__store.getState().tabsByWorktree[k] ?? []).filter((t) => t.launchAgent === "claude").length > n, [key, before], { timeout: 10_000 });
    await page.waitForFunction(`(${readLayout})().claude === 1`, null, { timeout: 10_000 }).catch(() => {});
    const layout = await page.evaluate(readLayout);
    console.log(`claude tabs: ${before} -> ${before + 1}, layout: ${JSON.stringify(layout)}`);
    if (layout.groups !== 2 || layout.cook !== 0 || layout.claude !== 1 || layout.cookTabs !== 1) throw new Error("Resume broke the split");
  });

  await step("11 final mp4 ready: Claude is reviewing it, QA from job.json", async () => {
    job("render", "done");
    job("verify", "done", { qa: "12/12" });
    job("review", "running");
    const { head, sub } = await expectCard("mp4-ready", "cook-pane-11-mp4-ready");
    if (head !== "Final video ready. Claude is reviewing it" || !sub.includes("QA 12/12")) throw new Error(sub);
  });

  await step("03 Claude did not start: the Cook was rolled back, a red card with Retry cook", async () => {
    rmSync(FILM, { recursive: true, force: true });
    sql(`update planned_posts set cook_workspace_id = null where id = '${PLAN}'`);
    const { head } = await expectCard("start-failed", "cook-pane-03-start-failed");
    if (head !== "Claude did not start") throw new Error(head);
  });

  await step("Retry cook cooks again: the plan row links the workspace and the card says starting", async () => {
    await card.getByTestId("cook-retry").click();
    await expectCard("starting", "cook-pane-02-retried");
    const stored = sql(`select cook_workspace_id from planned_posts where id = '${PLAN}'`);
    console.log(`db cook_workspace_id: ${stored}`);
    if (!stored) throw new Error("not cooking again");
    await page.waitForFunction(`(${readLayout})().claude === 1`, null, { timeout: 10_000 }).catch(() => {});
    const layout = await page.evaluate(readLayout);
    console.log(`layout after retry: ${JSON.stringify(layout)}`);
    if (layout.groups !== 2 || layout.cook !== 0 || layout.claude !== 1 || layout.cookTabs !== 1) throw new Error("retry broke the split");
  });

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
}
