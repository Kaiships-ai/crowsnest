// Cook pane, proto v2 states 16, 17, 18, 25 and 26: the Plan card's one cook line while Claude waits, the
// Caption box (CAPTION.md), "Keyword not on caption line 1" with Ask Claude to fix it and Edit caption, then
// Send to Gate 2: the version's mp4, its sibling cover and the caption go on the plan row, the PublishSheet
// runs its five checks, and a draft waits in Gate 2. Nothing is published: the lane's Graph is a dead port
// (app-up.sh's dead port, or gate2-lane.sh's fake Graph) and the journey never approves. Fixtures only: job.json written here, a tiny
// ffmpeg testsrc mp4, the fake Claude (`cat`), Orca's hook row driven with `setAgentStatus`.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const dod = ["B6-01"];

const { userDataDir, cookRoot: ROOT } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
// The lane's Graph is local: app-up.sh's dead port 9, or gate2-lane.sh's fake-graph.mjs. Never the real one.
if (!/^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(process.env.IG_GRAPH_HOST ?? "http://127.0.0.1:9")) throw new Error("this journey runs only with a local fake Graph");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const PLAN = "plan-e2e-full";
const SLUG = "plan01-full-script-e-full";
const KW = "COOKPANE";
const FILM = path.join(ROOT, "films", SLUG);
const STAGES = ["script", "voice", "storyboard", "chapters", "audio", "draft", "render", "verify", "review", "deliver"];
const DELIVERED = [`${SLUG}.mp4`, `${SLUG}-cover.png`, "CAPTION.md"];
const HOOK_ASK = { questions: [{ question: "Which hook?", header: "Hook", multiSelect: false, options: [{ label: "Shorter hook (Recommended)" }, { label: "Keep my hook" }] }] };
// studio-reel's CAPTION.md as make-reel writes it today: the keyword CTA last (rule R7 is not in the skill yet).
const CAPTION_LAST = `# Caption\n\nClaude Code runs your own script before every edit.\nOne line in settings.json, and it waits for your answer.\nComment ${KW} and I'll send you my five hooks.\n\n#claudecode #aitools\n\n## Pinned comment\n\nComment ${KW} below.\n`;
const CAPTION_FIXED = `# Caption\n\nComment ${KW} and I'll send you my five Claude Code hooks.\nClaude Code runs your own script before every edit. One line in settings.json, and it waits for your answer.\n#claudecode #aitools #devtools\n\n## Pinned comment\n\nComment ${KW} below.\n`;
const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE");

function job(at, status, outputs = []) {
  mkdirSync(FILM, { recursive: true });
  const i = at ? STAGES.indexOf(at) : STAGES.length;
  const steps = STAGES.map((name, n) => ({ name, status: n < i ? "done" : n === i ? status : "pending" }));
  writeFileSync(path.join(FILM, "job.json"), JSON.stringify({ slug: SLUG, campaign: KW, steps, outputs, qa: "12/12" }, null, 1));
}

export default async function cookPane04({ page, step, snap }) {
  const pane = page.locator(`[data-testid="cook-pane"][data-plan-id="${PLAN}"]`);
  const card = pane.getByTestId("cook-card");
  const caption = pane.getByTestId("cook-caption");
  const board = page.locator('[data-testid="board-tab"]:visible');
  const home = await page.evaluate(() => window.__store.getState().activeWorktreeId);
  await page.setViewportSize({ width: 1440, height: 900 });
  const dark = process.env.COOK_PANE_THEME === "dark";
  await page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  let key;
  let wsId;

  const claudeTab = () =>
    page.evaluate((k) => {
      const s = window.__store.getState();
      const tab = (s.tabsByWorktree[k] ?? []).findLast((t) => t.launchAgent === "claude");
      const leaf = tab && s.terminalLayoutsByTabId[tab.id]?.activeLeafId;
      return tab ? { tabId: tab.id, paneKey: leaf ? `${tab.id}:${leaf}` : null } : null;
    }, key);
  const hook = async (payload, startedAgo = 0) => {
    const t = await claudeTab();
    if (!t?.paneKey) throw new Error("no Claude pane");
    await page.evaluate(
      ([t, payload, k, ago]) => {
        const now = Date.now();
        window.__store.getState().setAgentStatus(t.paneKey, { agentType: "claude", prompt: "/make-reel", ...payload }, "Claude", { updatedAt: now, stateStartedAt: now - ago }, { tabId: t.tabId, worktreeId: k });
      },
      [t, payload, key, startedAgo],
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
    const acts = (await card.locator('button[data-testid^="cook-"]').allInnerTexts()).join(" | ");
    const can = (await card.locator("dd").count()) ? (await card.locator("dd").allInnerTexts()).join(" / ") : "";
    console.log(`card ${state} (${await card.getAttribute("data-tone")}): ${head} | ${sub} | [${acts}] | ${can}`);
    if (shot) await snap(shot);
    await page.waitForTimeout(Number(process.env.COOK_PANE_PAUSE_MS ?? 0));
    return { head, sub, acts, can };
  };
  const captionBox = async () => {
    const text = (await caption.innerText()).replace(/\n+/g, " / ");
    const chip = (await caption.getByTestId("cook-caption-keyword").count()) ? await caption.getByTestId("cook-caption-keyword").getAttribute("data-status") : null;
    const lit = (await caption.getByTestId("cook-caption-line1").count()) ? await caption.getByTestId("cook-caption-line1").evaluate((e) => e.className.includes("bg-status-warning")) : false;
    console.log(`caption box: ${text} · chip ${chip} · line 1 lit ${lit}`);
    return { text, chip, lit };
  };
  /** The Caption box sits below the Video and Script boxes in the narrow pane: scroll to it, shoot, scroll back. */
  const snapCaption = async (name) => {
    await caption.scrollIntoViewIfNeeded();
    await snap(name);
    await pane.evaluate((e) => e.scrollTo(0, 0));
  };
  /** The Plan board's day view of the reel, from the first workspace, and its one cook line. */
  const planLine = async () => {
    await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
    await page.locator('[data-testid="ls-nav-row"]', { hasText: "Plan" }).click();
    await board.getByTestId("board-refresh").click();
    const detail = board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`);
    if (!(await detail.count())) await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).first().click();
    const line = detail.getByTestId("plan-cook-status");
    await line.waitFor({ timeout: 8_000 });
    await page.waitForTimeout(2_500);
    return { detail, text: await line.innerText(), tone: await line.getAttribute("data-tone"), open: await detail.getByTestId("plan-cook-open").isVisible() };
  };
  const backToPane = async () => {
    await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook-open").click();
    await pane.waitFor({ timeout: 8_000 });
  };

  try {
    await step("a fresh Cook of plan-e2e-full, slot tomorrow 19:30, keyword COOKPANE", async () => {
      const fake = path.join(ROOT, "..", "fake-claude.sh");
      writeFileSync(fake, '#!/bin/sh\necho "fake claude $*"\nexec cat\n');
      chmodSync(fake, 0o755);
      await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
      rmSync(FILM, { recursive: true, force: true });
      await page.evaluate((id) => {
        for (const k of ["cook-seen", "cook-stopped", "cook-queued"]) localStorage.removeItem(`${k}:${id}`);
      }, PLAN);
      await page.evaluate(() => {
        const s = window.__store.getState();
        const w = s.folderWorkspaces.find((x) => x.name === "Reel: PLAN01 full script");
        for (const t of (w && s.tabsByWorktree[`folder:${w.id}`]) ?? []) s.closeTab(t.id);
        for (const t of (w && s.unifiedTabsByWorktree[`folder:${w.id}`]) ?? []) s.closeUnifiedTab(t.id);
      });
      await page.waitForTimeout(500);
      sql(`delete from gate_drafts where tool = 'publish_reel' and json_extract(input, '$.postId') = '${PLAN}'`);
      sql(`update planned_posts set cook_workspace_id = null, keyword = '${KW}', planned_date = '${tomorrow}', planned_time = '19:30', video_asset_id = null, cover_asset_id = null, caption = null, state = 'draft', scheduled_at = null where id = '${PLAN}'`);
      await page.getByRole("button", { name: "New tab" }).first().click();
      await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
      await page.getByRole("menu").waitFor({ state: "detached" });
      await board.getByTestId("plan-view-week").click();
      await board.getByTestId("board-refresh").click();
      await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).click();
      await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook").click();
      await pane.waitFor({ timeout: 15_000 });
      key = await page.evaluate(() => window.__store.getState().activeWorktreeId);
      wsId = sql(`select cook_workspace_id from planned_posts where id = '${PLAN}'`);
      await page.waitForFunction((k) => (window.__store.getState().tabsByWorktree[k] ?? []).some((t) => t.launchAgent === "claude"), key, { timeout: 10_000 });
      await typed("fake claude");
      console.log(`workspace ${wsId}`);
    });

    await step("the Caption box before Claude writes it: No caption yet. Claude writes it last, after the review.", async () => {
      job("chapters", "running");
      await expectCard("building");
      const { text } = await captionBox();
      if (text !== "Caption / No caption yet. Claude writes it last, after the review.") throw new Error(text);
      await snapCaption("cook-pane-d-caption-none");
    });

    await step("16 Claude asks which hook for 2 h 10 min: the Plan card reads Needs you, beside Open workspace", async () => {
      job("script", "waiting");
      await hook({ state: "waiting", toolName: "AskUserQuestion", interactivePrompt: JSON.stringify(HOOK_ASK) }, 130 * 60_000);
      await expectCard("waiting-long");
      const { text, tone, open } = await planLine();
      console.log(`plan line (${tone}): ${text} · Open workspace ${open}`);
      if (text !== "Needs you: which hook? · 2 h 10 min" || tone !== "need" || !open) throw new Error(text);
      await snap("cook-pane-d-16-plan-needs-you");
      await backToPane();
      await hook({ state: "working" });
    });

    await step("the Plan line follows the cook: Build while it builds", async () => {
      job("chapters", "running");
      await expectCard("building");
      const { text, tone } = await planLine();
      console.log(`plan line (${tone}): ${text}`);
      if (text !== "Build · Claude is building the chapters" || tone !== "run") throw new Error(text);
      await backToPane();
    });

    await step("18 deliver done, CAPTION.md has the keyword only on its CTA line: amber, line 1 lit, two buttons", async () => {
      mkdirSync(FILM, { recursive: true });
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=216x384:rate=8:duration=3", "-pix_fmt", "yuv420p", path.join(FILM, `${SLUG}.mp4`)]);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=108x192", "-frames:v", "1", path.join(FILM, `${SLUG}-cover.png`)]);
      writeFileSync(path.join(FILM, "CAPTION.md"), CAPTION_LAST);
      job(null, "done", DELIVERED);
      await hook({ state: "done" });
      const { head, sub, acts } = await expectCard("keyword-missing");
      const box = await captionBox();
      if (head !== `Keyword ${KW} is not on caption line 1` || sub !== "Gate 2 checks line 1. CAPTION.md has it only in its last line.") throw new Error(sub);
      if (acts !== "Ask Claude to fix it | Edit caption" || box.chip !== "warn" || !box.lit) throw new Error(acts);
      await snap("cook-pane-d-18-keyword-missing");
      await snapCaption("cook-pane-d-18-caption");
    });

    await step("Edit caption opens films/<slug>/CAPTION.md in the editor, beside the pane", async () => {
      await card.getByTestId("cook-editcap").click();
      await page.waitForFunction((f) => window.__store.getState().openFiles.some((o) => o.filePath === f), path.join(FILM, "CAPTION.md"), { timeout: 5_000 });
      const opened = await page.evaluate((f) => {
        const s = window.__store.getState();
        const file = s.openFiles.find((o) => o.filePath === f);
        return { relativePath: file.relativePath, mode: file.mode };
      }, path.join(FILM, "CAPTION.md"));
      console.log(`editor: ${JSON.stringify(opened)} · pane still visible ${await pane.isVisible()}`);
      if (opened.relativePath !== `films/${SLUG}/CAPTION.md` || !(await pane.isVisible())) throw new Error("the caption did not open beside the pane");
      await snap("cook-pane-d-edit-caption");
    });

    await step("Ask Claude to fix it types rule R7 into Claude; Claude's fix turns the card green: 17 Ready for Gate 2", async () => {
      await card.getByTestId("cook-fixkw").click();
      await typed(`Rule R7: the keyword ${KW} must be on line 1 of the post caption`);
      writeFileSync(path.join(FILM, "CAPTION.md"), CAPTION_FIXED);
      const { sub, acts, can } = await expectCard("ready");
      const box = await captionBox();
      if (sub !== `v1 · 0:03 · QA 12/12 · ${KW} on caption line 1` || acts !== "Send to Gate 2…") throw new Error(sub);
      if (!can.startsWith("Watch it, send feedback, or send it to Gate 2.") || box.chip !== "ok" || box.lit) throw new Error(can);
      await snap("cook-pane-d-17-ready");
      await snapCaption("cook-pane-d-17-caption");
    });

    await step("25 Send to Gate 2…: v1's mp4, its cover and the caption are on the plan row; the sheet's five checks pass", async () => {
      await card.getByTestId("cook-gate2").click();
      const sheet = page.getByTestId("publish-sheet");
      await sheet.waitFor({ timeout: 8_000 });
      await sheet.getByTestId("publish-check").nth(4).waitFor({ timeout: 8_000 });
      const row = sql(`select video_asset_id is not null, cover_asset_id is not null, caption, state from planned_posts where id = '${PLAN}'`);
      const checks = await sheet.getByTestId("publish-check").evaluateAll((els) => els.map((e) => `${e.dataset.check}=${e.dataset.status}: ${e.innerText.replace(/\n/g, " ")}`));
      const version = await sheet.getByTestId("publish-version").innerText();
      console.log(`plan row: ${row.replace(/\n/g, " ⏎ ")}\nversion chip: ${version}\nchecks:\n  ${checks.join("\n  ")}`);
      if (!row.startsWith(`1|1|Comment ${KW} and I'll send you my five Claude Code hooks.`) || !row.endsWith("|draft")) throw new Error(row);
      if (version !== "v1 · versions/v1/" || checks.length !== 5 || checks.some((c) => !c.includes("=ok"))) throw new Error(checks.join(" "));
      if ((await sql(`select count(*) from gate_drafts where json_extract(input, '$.postId') = '${PLAN}'`)) !== "0") throw new Error("a draft before Send");
      await page.mouse.move(5, 5);
      await page.waitForTimeout(800); // the sheet's slide-in
      await snap("cook-pane-d-25-sheet");
    });

    await step("26 Send to Gate 2 in the sheet: one pending draft, nothing published; the card says so, with Open Gate 2", async () => {
      await page.getByTestId("publish-send").click();
      await page.getByTestId("publish-sheet").waitFor({ state: "detached", timeout: 8_000 });
      const { head, sub, acts, can } = await expectCard("sent", "cook-pane-d-26-sent");
      const drafts = sql(`select status, json_extract(input, '$.at') from gate_drafts where tool = 'publish_reel' and json_extract(input, '$.postId') = '${PLAN}'`);
      const row = sql(`select state, scheduled_at is null, published_media_id is null from planned_posts where id = '${PLAN}'`);
      console.log(`drafts: ${drafts} · plan row state|unarmed|unpublished: ${row}`);
      if (head !== "Sent to Gate 2. Nothing is published yet." || !sub.startsWith("v1 · ") || !sub.endsWith(" · 19:30") || acts !== "Open Gate 2") throw new Error(sub);
      if (!can.startsWith("Approve it in Gate 2, or keep working here.") || drafts !== `pending|${tomorrow}T19:30` || row !== "draft|1|1") throw new Error(`${drafts} ${row}`);
      const { text, tone } = await planLine();
      console.log(`plan line (${tone}): ${text}`);
      if (text !== "Sent to Gate 2" || tone !== "ok") throw new Error(text);
      await backToPane();
      await expectCard("sent");
      await card.getByTestId("cook-opengate").click();
      const gate = page.locator('[data-testid="board-tab"]:visible');
      await gate.getByText("PLAN01 full script").first().waitFor({ timeout: 8_000 });
      console.log(`gate 2 board shows the reel, waiting for approval; never approved here`);
      await snap("cook-pane-d-26-gate2");
    });
  } finally {
    sql(`delete from gate_drafts where tool = 'publish_reel' and json_extract(input, '$.postId') = '${PLAN}' and status = 'pending'`);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
  }
}
