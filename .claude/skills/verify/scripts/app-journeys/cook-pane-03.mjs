// Cook pane, proto v2 states 08, 09, 11, 17 (its version line), 19 to 24, 39 and 40: the newest playable
// file (DRAFT, then the final), versions/vN/ saved by Lead Studio when deliver turns done, feedback rounds
// typed into Claude (queued while Claude works), the "changed" chip, Compare, the render queue
// (RENDER_SLOTS=1) and the Studio board. Fixtures only: job.json written here, tiny ffmpeg testsrc mp4s,
// a fake Claude (`cat`) and a fake render-slot holder. No real render.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logCookState } from "../cook-diagnostics.mjs";

export const dod = ["B5-04"];

const { userDataDir, cookRoot: ROOT } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const PLAN = "plan-e2e-full";
const SLUG = "plan01-full-script-e-full";
const OTHER = "plan-month-2";
const OTHER_TITLE = "Hooks in one picture: run tests after every edit";
const OTHER_SLUG = "hooks-in-one-picture-run-tests-after-every-edit-onth-2";
const FILM = path.join(ROOT, "films", SLUG);
const SLOTS = path.join(ROOT, "..", "render-slots");
const STAGES = ["script", "voice", "storyboard", "chapters", "audio", "draft", "render", "verify", "review", "deliver"];
const HOOK_V1 = "Claude Code runs your script before every edit.";
const LINES = ["A hook is one line in settings.json.", "Exit 2, and the edit never happens.", "Comment HOOKS and I'll send you my five hooks."];

/** job.json with every step before `at` done, `at` in `status`, the rest pending (studio-reel's format).
 *  `stamps` adds fields (the proposed started/ended) to named steps. */
function job(film, at, status, { extra = {}, outputs = [], top = {}, stamps = {} } = {}) {
  mkdirSync(film, { recursive: true });
  const i = at ? STAGES.indexOf(at) : STAGES.length;
  const steps = STAGES.map((name, n) => ({ name, status: n < i ? "done" : n === i ? status : "pending", ...(n === i ? extra : {}), ...stamps[name] }));
  writeFileSync(path.join(film, "job.json"), JSON.stringify({ slug: path.basename(film), campaign: "COOKPANE", steps, outputs, qa: "12/12", ...top }, null, 1));
}
/** A tiny testsrc mp4 (moov at the end, as ffmpeg writes it by default). */
function mp4(rel, sec, size) {
  const file = path.join(FILM, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=8:duration=${sec}`, "-pix_fmt", "yuv420p", file]);
}
/** The reel's own files a version keeps: vo/script.json, vo/vo.json (hook timing), src/, audio/cues.json, CAPTION.md. */
function reelFiles(hook, hookSec, caption) {
  mkdirSync(path.join(FILM, "vo"), { recursive: true });
  mkdirSync(path.join(FILM, "src/ch"), { recursive: true });
  mkdirSync(path.join(FILM, "audio"), { recursive: true });
  const lines = [hook, ...LINES];
  writeFileSync(path.join(FILM, "vo/script.json"), JSON.stringify({ lines: lines.map((text, i) => ({ id: `l0${i + 1}`, text })) }));
  writeFileSync(path.join(FILM, "vo/vo.json"), JSON.stringify({ lines: lines.map((text, i) => ({ text, s: i * 3, e: i * 3 + (i ? 2.5 : hookSec) })) }));
  writeFileSync(path.join(FILM, "src/ch/c1_hook.js"), `export const hook = ${JSON.stringify(hook)};\n`);
  writeFileSync(path.join(FILM, "audio/cues.json"), "[]\n");
  writeFileSync(path.join(FILM, "CAPTION.md"), caption);
}
const DELIVERED = ["out/verify/draft.mp4", `${SLUG}.mp4`, `${SLUG}-cover.png`, "CAPTION.md"];

export default async function cookPane03({ page, step, snap }) {
  const pane = page.locator(`[data-testid="cook-pane"][data-plan-id="${PLAN}"]`);
  const card = pane.getByTestId("cook-card");
  const video = pane.getByTestId("cook-video");
  const feedback = pane.getByTestId("cook-feedback");
  const home = await page.evaluate(() => window.__store.getState().activeWorktreeId);
  await page.setViewportSize({ width: 1440, height: 900 });
  const dark = process.env.COOK_PANE_THEME === "dark";
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  // A live pid for running render steps, and a fake video.mjs holding the render slot: its argv names its film.
  const alive = spawn("sleep", ["900"], { stdio: "ignore", detached: true });
  let holder;
  let key;
  let kw;

  const claudeTab = () =>
    page.evaluate((k) => {
      const s = window.__store.getState();
      const tab = (s.tabsByWorktree[k] ?? []).findLast((t) => t.launchAgent === "claude");
      const leaf = tab && s.terminalLayoutsByTabId[tab.id]?.activeLeafId;
      return tab ? { tabId: tab.id, paneKey: leaf ? `${tab.id}:${leaf}` : null } : null;
    }, key);
  const hook = async (state) => {
    const t = await claudeTab();
    if (!t?.paneKey) throw new Error("no Claude pane");
    await page.evaluate(
      ([t, state, k]) => {
        const now = Date.now();
        window.__store.getState().setAgentStatus(t.paneKey, { agentType: "claude", prompt: "/make-reel", state }, "Claude", { updatedAt: now, stateStartedAt: now }, { tabId: t.tabId, worktreeId: k });
      },
      [t, state, key],
    );
  };
  const terminalText = async () => {
    const t = await claudeTab();
    return page.evaluate((id) => {
      const manager = window.__paneManagers?.get(id);
      const buffer = (manager?.getActivePane?.() ?? manager?.getPanes?.()[0])?.terminal?.buffer.active;
      if (!buffer) return "";
      return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "").join("\n");
    }, t?.tabId);
  };
  const typed = async (text) => {
    for (let i = 0; i < 40; i++) {
      if ((await terminalText()).replace(/\n/g, "").includes(text)) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`terminal never showed ${JSON.stringify(text)}:\n${(await terminalText()).slice(-400)}`);
  };
  const expectCard = async (state, shot) => {
    const shown = card.and(page.locator(`[data-state="${state}"]`));
    await shown.waitFor({ timeout: 8_000 });
    await page.waitForTimeout(1_200);
    await shown.waitFor({ timeout: 5_000 });
    const head = await card.getByTestId("cook-card-head").innerText();
    const sub = (await card.getByTestId("cook-card-sub").count()) ? await card.getByTestId("cook-card-sub").innerText() : "";
    const can = (await card.locator("dd").count()) ? (await card.locator("dd").allInnerTexts()).join(" / ") : "";
    console.log(`card ${state} (${await card.getAttribute("data-tone")}): ${head} | ${sub} | ${can}`);
    if (shot) await snap(shot);
    await page.waitForTimeout(Number(process.env.COOK_PANE_PAUSE_MS ?? 0));
    return { head, sub, can };
  };
  /** The Video box: what it plays and how it labels it; waits until the player has the file's metadata. */
  const player = async (kind) => {
    await video.and(page.locator(`[data-kind="${kind}"]`)).waitFor({ timeout: 8_000 });
    const el = video.getByTestId("cook-video-player");
    await el.waitFor({ timeout: 8_000 });
    await page.waitForFunction((e) => e.readyState >= 1 && e.duration > 0, await el.elementHandle(), { timeout: 8_000 });
    await page.waitForTimeout(300);
    const label = await video.getByTestId("cook-video-label").innerText();
    const duration = await el.evaluate((e) => Math.round(e.duration * 10) / 10);
    const draft = (await video.getByText("DRAFT", { exact: true }).count()) > 0;
    const versions = (await video.locator('[data-testid^="cook-version-v"]').allInnerTexts()).join(" ");
    console.log(`video ${kind}: "${label}" · plays ${duration} s · DRAFT badge ${draft} · versions [${versions}]`);
    return { label, duration, draft, versions };
  };
  const index = () => JSON.parse(readFileSync(path.join(FILM, "versions/index.json"), "utf8"));

  try {
    await step("a fresh Cook of plan-e2e-full; Claude starts with RENDER_SLOTS=1 in its settings", async () => {
      const fake = path.join(ROOT, "..", "fake-claude.sh");
      // Why the title: a real Claude sets one. On a shell that keeps its default title (CI), the done hook on a
      // tab titled "Terminal 1" reads as Claude having left, and Orca clears the tab's launchAgent.
      writeFileSync(fake, '#!/bin/sh\nprintf "\\033]0;Claude Code\\007"\necho "fake claude $*"\nexec cat\n');
      chmodSync(fake, 0o755);
      await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
      rmSync(FILM, { recursive: true, force: true });
      rmSync(SLOTS, { recursive: true, force: true });
      await page.evaluate((id) => {
        for (const k of ["cook-seen", "cook-stopped", "cook-queued"]) localStorage.removeItem(`${k}:${id}`);
      }, PLAN);
      await page.evaluate(() => {
        const s = window.__store.getState();
        const w = s.folderWorkspaces.find((x) => x.name === "Reel: PLAN01 full script");
        for (const t of (w && s.tabsByWorktree[`folder:${w.id}`]) ?? []) s.closeTab(t.id);
        for (const t of (w && s.unifiedTabsByWorktree[`folder:${w.id}`]) ?? []) s.closeUnifiedTab(t.id);
        if (w) s.setActiveWorktree(`folder:${w.id}`);
      });
      await page.waitForTimeout(500);
      sql(`update planned_posts set cook_workspace_id = null, keyword = coalesce(keyword, 'COOKPANE') where id = '${PLAN}'`);
      sql(`update planned_posts set cook_workspace_id = null where id = '${OTHER}'`);
      kw = sql(`select keyword from planned_posts where id = '${PLAN}'`);
      const board = page.locator('[data-testid="board-tab"]:visible');
      await page.getByRole("button", { name: "New tab" }).first().click();
      await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
      await page.getByRole("menu").waitFor({ state: "detached" });
      await board.getByTestId("plan-view-week").click();
      await board.getByTestId("board-refresh").click();
      await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).click();
      await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook").click();
      await pane.waitFor({ timeout: 15_000 });
      key = await page.evaluate(() => window.__store.getState().activeWorktreeId);
      await page.waitForFunction((k) => (window.__store.getState().tabsByWorktree[k] ?? []).some((t) => t.launchAgent === "claude"), key, { timeout: 10_000 });
      await typed("fake claude");
      const args = (await terminalText()).replace(/\n/g, "").match(/fake claude (.*?\}\})/)?.[1] ?? "";
      console.log(`claude args: ${args}`);
      if (!args.includes('--settings {"env":{"RENDER_SLOTS":"1"}}')) throw new Error(`no RENDER_SLOTS=1: ${args}`);
    });

    await step("the Video box before any mp4: No video yet. It comes after Build.", async () => {
      job(FILM, "chapters", "running");
      await expectCard("building");
      const empty = await video.getByTestId("cook-video-empty").innerText();
      console.log(`video box: ${empty}`);
      if (empty !== "No video yet. It comes after Build.") throw new Error(empty);
      await snap("cook-pane-c-02-no-video");
    });

    await step("08 draft done, the final just started: the DRAFT plays; feedback can go in now", async () => {
      mp4("out/verify/draft.mp4", 2, "270x480");
      job(FILM, "render", "running", { extra: { pid: alive.pid }, outputs: ["out/verify/draft.mp4"] });
      const { head, can } = await expectCard("draft-ready");
      const v = await player("draft");
      if (head !== "Draft ready to watch. Final render running" || !can.startsWith("Watch the draft. Feedback can go in now")) throw new Error(head);
      if (!v.draft || v.label !== "Draft · low quality · 0:02" || v.duration !== 2) throw new Error(v.label);
      if (!(await feedback.isVisible())) throw new Error("no feedback box with a draft");
      await snap("cook-pane-c-08-draft-ready");
    });

    await step("09 the final renders for 1:30: the draft stays playable, 'Watch the draft meanwhile.'", async () => {
      job(FILM, "render", "running", { extra: { pid: alive.pid, started: new Date(Date.now() - 90_000).toISOString() }, outputs: ["out/verify/draft.mp4"] });
      const { can } = await expectCard("rendering");
      await player("draft");
      if (!can.startsWith("Watch the draft meanwhile.")) throw new Error(can);
      await snap("cook-pane-c-09-rendering");
    });

    await step("40 and 39: another reel holds the render slot; this one waits in line, and Studio shows both", async () => {
      sql(`update planned_posts set cook_workspace_id = 'folder:e2e-other' where id = '${OTHER}'`);
      job(path.join(ROOT, "films", OTHER_SLUG), "render", "running", { extra: { pid: alive.pid, started: new Date(Date.now() - 60_000).toISOString() } });
      holder = spawn("sh", ["-c", "sleep 900; :", "video.mjs", `films/${OTHER_SLUG}/`], { stdio: "ignore", detached: true });
      mkdirSync(path.join(SLOTS, "slot0"), { recursive: true });
      writeFileSync(path.join(SLOTS, "slot0/pid"), String(holder.pid));
      const { head, sub } = await expectCard("queued-render", "cook-pane-c-40-in-line");
      const strip = await pane.getByTestId("cook-segment").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}=${e.dataset.state}`).join(" "));
      console.log(`strip: ${strip}`);
      if (head !== "In line for the render" || sub !== `"${OTHER_TITLE}" is rendering. Yours starts after it, in about 2 min.`) throw new Error(sub);
      if (!/Finalin line=current/.test(strip)) throw new Error(strip);
      // From the first workspace, so the Studio board does not open over Claude's terminal.
      await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
      await page.locator('[data-testid="ls-nav-row"]', { hasText: "Studio" }).click();
      const studio = page.locator('[data-testid="studio-board"]:visible');
      await studio.getByTestId("studio-row").nth(1).waitFor({ timeout: 8_000 });
      await page.waitForTimeout(2_500);
      const rows = await studio.getByTestId("studio-row").evaluateAll((els) => els.map((e) => `${e.querySelector("h4").textContent} → ${e.querySelector('[data-testid="studio-status"]').textContent}`));
      console.log(`studio rows:\n  ${rows.join("\n  ")}`);
      if (!rows.some((r) => r.startsWith("PLAN01 full script → Final · In line for the render"))) throw new Error("our row is not in line");
      if (!rows.some((r) => r.startsWith(`${OTHER_TITLE} → Final · Rendering the final video`))) throw new Error("the other row is not rendering");
      await snap("cook-pane-c-39-studio");
      await studio.locator(`[data-testid="studio-row"][data-plan-id="${PLAN}"]`).getByTestId("studio-open").click();
      await pane.waitFor({ timeout: 8_000 });
      process.kill(-holder.pid); // the group: sh and its sleep
      rmSync(SLOTS, { recursive: true, force: true });
      sql(`update planned_posts set cook_workspace_id = null where id = '${OTHER}'`);
      await expectCard("rendering");
    });

    await step("20 feedback while Claude is busy: queued, sent by itself later", async () => {
      await hook("working");
      await feedback.getByTestId("cook-feedback-input").fill("bigger captions");
      const button = await feedback.getByTestId("cook-feedback-send").innerText();
      await feedback.getByTestId("cook-feedback-send").click();
      const queued = await feedback.getByTestId("cook-queued").innerText();
      console.log(`button: ${button} · ${queued.replace(/\n/g, " ")}`);
      if (button !== "Queue" || !queued.startsWith('Queued: "bigger captions". Claude gets it when the final render is done.')) throw new Error(queued);
      await snap("cook-pane-c-20-queued");
    });

    await step("11 the final is done: v1 plays at 1080×1920 while Claude reviews", async () => {
      mp4(`${SLUG}.mp4`, 3, "216x384");
      job(FILM, "review", "running", { outputs: ["out/verify/draft.mp4", `${SLUG}.mp4`, `${SLUG}-cover.png`] });
      const { can } = await expectCard("mp4-ready");
      const v = await player("final");
      if (can !== "Watch the final. Claude may fix small things and render again. / Claude writes the caption and hands the reel to you.") throw new Error(can);
      if (v.draft || v.label !== "v1 · 0:03 · 216×384") throw new Error(v.label);
      await snap("cook-pane-c-11-final");
    });

    await step("17 deliver done: Lead Studio copies v1 to versions/v1/ (outputs, src/, vo/script.json, audio/cues.json)", async () => {
      reelFiles(HOOK_V1, 2.6, `Comment ${kw} and I'll send you my five hooks.\n`);
      writeFileSync(path.join(FILM, `${SLUG}-cover.png`), "png");
      job(FILM, null, "done", { outputs: DELIVERED });
      const { sub } = await expectCard("ready", "cook-pane-c-17-v1");
      const kept = ["versions/v1/" + `${SLUG}.mp4`, "versions/v1/src/ch/c1_hook.js", "versions/v1/vo/script.json", "versions/v1/audio/cues.json", "versions/v1/CAPTION.md"].filter((f) => existsSync(path.join(FILM, f)));
      console.log(`sub: ${sub} · kept: ${kept.join(", ")} · index: ${JSON.stringify(index().versions.map((v) => [v.n, v.durationSec, v.hookSec]))}`);
      if (sub !== `v1 · 0:03 · QA 12/12 · ${kw} on caption line 1` || kept.length !== 5) throw new Error(sub);
      const v = await player("final");
      if (v.versions !== "v1 ✓") throw new Error(v.versions);
    });

    await step("19 Claude is idle: the queued note goes in as round 1, v1 kept, v2 in the making", async () => {
      await hook("done");
      await typed('Feedback round 1 from Lead Studio. v1 is kept in versions/v1/. Note: "bigger captions". Re-run only what this changes, draft first, then the final. End with job.mjs … deliver done --change="…".');
      const { head, sub, can } = await expectCard("v2-making");
      await hook("working");
      job(FILM, "chapters", "running", { outputs: DELIVERED });
      await expectCard("v2-making");
      const v = await player("version");
      const round = await feedback.getByTestId("cook-round").first().innerText();
      console.log(`round: ${round.replace(/\n/g, " ")} · queue gone: ${(await feedback.getByTestId("cook-queued").count()) === 0}`);
      if (head !== "Making v2 from your note" || sub !== '"bigger captions"' || !can.startsWith("Watch v1 meanwhile. It stays here.")) throw new Error(head);
      if (v.label !== "v1 · 0:03 · 216×384" || v.versions !== "v1 ✓ v2 …") throw new Error(`${v.label} | ${v.versions}`);
      if (!round.includes("making v2")) throw new Error(round);
      await snap("cook-pane-c-19-v2-making");
    });

    await step("21 the v2 draft is done, the final v2 renders: the v2 draft plays; v1 is one click away", async () => {
      mp4("out/verify/draft.mp4", 4, "270x480");
      job(FILM, "render", "running", { extra: { pid: alive.pid, started: new Date(Date.now() - 30_000).toISOString() }, outputs: ["out/verify/draft.mp4"] });
      const { head } = await expectCard("v2-draft");
      const v = await player("draft");
      if (head !== "v2 draft ready. Final v2 rendering" || v.label !== "v2 draft · low quality" || !v.draft) throw new Error(`${head} | ${v.label}`);
      await snap("cook-pane-c-21-v2-draft");
      await video.getByTestId("cook-version-v1").click();
      const back = await player("version");
      if (back.label !== "v1 · 0:03 · 216×384") throw new Error(back.label);
      await video.getByTestId("cook-version-v2").click();
      await player("draft");
    });

    await step("the final v2 is rendered but deliver is still done from v1: no v2 until deliver runs again", async () => {
      mp4(`${SLUG}.mp4`, 4, "216x384");
      const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
      // job.mjs reruns render only; deliver keeps v1's done, which ended before v1 was saved.
      job(FILM, null, "done", { outputs: DELIVERED, stamps: { render: { ended: ago(0) }, deliver: { ended: ago(600) } } });
      const { head } = await expectCard("v2-making");
      await page.waitForTimeout(2_000);
      const saved = index().versions.map((v) => v.n);
      console.log(`stale deliver: card "${head}" · versions ${JSON.stringify(saved)} · v2 dir ${existsSync(path.join(FILM, "versions/v2"))}`);
      if (head !== "Making v2 from your note" || saved.length !== 1 || existsSync(path.join(FILM, "versions/v2"))) throw new Error(`v2 saved before deliver: ${saved}`);
    });

    await step("22 v2 delivered with no `change` in job.json: the chip falls back to hook, length and script lines", async () => {
      mp4(`${SLUG}.mp4`, 4, "216x384");
      reelFiles("Claude runs your script before every edit.", 2.1, `Comment ${kw} and I'll send you my five hooks.\n`);
      job(FILM, null, "done", { outputs: DELIVERED });
      const { head, sub } = await expectCard("v2-ready", "cook-pane-c-22-v2-ready");
      const v = await player("final");
      const chip = await video.getByTestId("cook-video-change").innerText();
      const round = await feedback.getByTestId("cook-round").first().innerText();
      console.log(`chip: ${chip} · round: ${round.replace(/\n/g, " ")}`);
      if (head !== "v2 ready" || sub !== "Changed: hook 2.6 s → 2.1 s · length 0:03 → 0:04 · 1 script line · 0:04 · QA 12/12") throw new Error(sub);
      if (v.versions !== "v1 v2 ✓" || v.label !== "v2 · 0:04 · 216×384") throw new Error(v.versions);
      if (!round.includes("→ hook 2.6 s → 2.1 s")) throw new Error(round);
    });

    await step("23 Compare v1 · v2: two players, length, hook, QA, the changed line; Use v1 picks it for Gate 2", async () => {
      await card.getByTestId("cook-compare").click();
      const { head, sub } = await expectCard("compare");
      const box = pane.getByTestId("cook-compare");
      const facts = await box.locator("dl").allInnerTexts();
      const diff = await box.getByTestId("cook-compare-diff").innerText();
      console.log(`facts: ${facts.map((f) => f.replace(/\n/g, " ")).join(" | ")}\ndiff: ${diff.replace(/\n/g, " / ")}`);
      if (head !== "Comparing v1 and v2" || sub !== "Gate 2 gets the one you pick. Now: v2.") throw new Error(sub);
      if (!diff.startsWith("Script · 1 line changed · caption the same")) throw new Error(diff);
      await snap("cook-pane-c-23-compare");
      await box.getByTestId("cook-use-v1").click();
      await card.getByTestId("cook-card-sub").and(page.getByText("Gate 2 gets the one you pick. Now: v1.")).waitFor({ timeout: 5_000 });
      if (index().use !== 1) throw new Error(`index use ${index().use}`);
      await snap("cook-pane-c-23-use-v1");
      await box.getByTestId("cook-use-v2").click();
      await card.getByTestId("cook-card-sub").and(page.getByText("Gate 2 gets the one you pick. Now: v2.")).waitFor({ timeout: 5_000 });
      await card.getByTestId("cook-donecompare").click();
      await expectCard("v2-ready");
      console.log(`index use after Using v2: ${index().use}`);
    });

    await step("24 a second round, sent at once (Claude idle), with `change` from job.json: v3 and the rounds list", async () => {
      await hook("done");
      await feedback.getByTestId("cook-feedback-input").fill("slower CTA");
      if ((await feedback.getByTestId("cook-feedback-send").innerText()) !== "Send") throw new Error("Claude is idle but the button queues");
      await feedback.getByTestId("cook-feedback-send").click();
      await typed('Feedback round 2 from Lead Studio. v2 is kept in versions/v2/. Note: "slower CTA".');
      await hook("working");
      mp4(`${SLUG}.mp4`, 5, "216x384");
      job(FILM, null, "done", { outputs: DELIVERED, top: { change: "CTA 1.2 s → 1.6 s" }, stamps: { deliver: { ended: new Date().toISOString() } } });
      const { head, sub, can } = await expectCard("rounds", "cook-pane-c-24-rounds");
      const rounds = await feedback.getByTestId("cook-round").allInnerTexts();
      console.log(`rounds: ${rounds.map((r) => r.replace(/\n/g, " ")).join(" | ")}`);
      if (head !== "v3 ready" || sub !== "2 feedback rounds · changed: CTA 1.2 s → 1.6 s" || !can.includes("Gate 2 gets v3 unless you pick another.")) throw new Error(sub);
      if (rounds.length !== 2 || !rounds[1].includes("→ CTA 1.2 s → 1.6 s")) throw new Error(rounds.join("|"));
      const v = await player("final");
      if (v.versions !== "v1 v2 v3 ✓") throw new Error(v.versions);
    });
  } catch (error) {
    await logCookState(page, key, PLAN).catch((e) => console.log(`diagnostics failed: ${e.message}`));
    throw error;
  } finally {
    alive.kill();
    try {
      if (holder) process.kill(-holder.pid);
    } catch {}
    rmSync(SLOTS, { recursive: true, force: true });
    sql(`update planned_posts set cook_workspace_id = null where id = '${OTHER}'`);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
  }
}
