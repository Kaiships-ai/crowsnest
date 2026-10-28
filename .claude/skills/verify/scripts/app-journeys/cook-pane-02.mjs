// Cook pane, proto v2 states 12 to 15, 32 to 36, 41 and 42: Claude's questions as one-click cards,
// Claude gone (crashed, tab closed, Mac restarted), the app reopened, and Stop cook. Claude is the
// lane's fake (`cat`, so the terminal echoes every key the pane sends). Orca's hook state for its
// pane is driven the way Orca's own e2e tests drive it: `setAgentStatus` on the store.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const dod = ["B5-03"];

const { userDataDir, cookRoot: ROOT } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const PLAN = "plan-e2e-full";
const SLUG = "plan01-full-script-e-full";
const FILM = path.join(ROOT, "films", SLUG);
const JOB = path.join(FILM, "job.json");
const STAGES = ["script", "voice", "storyboard", "chapters", "audio", "draft", "render", "verify", "review", "deliver"];
const DEAD_PID = 4_000_007;
const MIN = 60_000;

/** job.json with every step before `at` done, `at` in `status`, the rest pending (studio-reel's format). */
function jobAt(at, status, extra = {}) {
  mkdirSync(FILM, { recursive: true });
  const i = STAGES.indexOf(at);
  const steps = STAGES.map((name, n) => ({ name, status: n < i ? "done" : n === i ? status : "pending", ...(n === i ? extra : {}) }));
  writeFileSync(JOB, JSON.stringify({ slug: SLUG, campaign: "COOKPANE", steps, outputs: [] }, null, 1));
}

const HOOK_ASK = {
  questions: [
    {
      question: "Which hook?",
      header: "Hook",
      multiSelect: false,
      options: [
        { label: "Shorter hook (Recommended)", description: '"Claude Code runs your script before every edit." · about 2.6 s' },
        { label: "Keep my hook", description: '"Claude Code can run your own script before every single edit you make." · about 4.1 s' },
      ],
    },
  ],
};

export default async function cookPane02({ page, step, snap }) {
  const board = page.locator('[data-testid="board-tab"]:visible');
  const pane = page.locator(`[data-testid="cook-pane"][data-plan-id="${PLAN}"]`);
  const card = pane.getByTestId("cook-card");
  const home = await page.evaluate(() => window.__store.getState().activeWorktreeId);
  await page.setViewportSize({ width: 1440, height: 900 });
  const dark = process.env.COOK_PANE_THEME === "dark";
  const setTheme = () => page.evaluate((on) => document.documentElement.classList.toggle("dark", on), dark);
  await setTheme();
  let key;
  let lastTab;

  /** The workspace's newest Claude tab and its one pane key. */
  const claudeTab = () =>
    page.evaluate((k) => {
      const s = window.__store.getState();
      const tab = (s.tabsByWorktree[k] ?? []).findLast((t) => t.launchAgent === "claude");
      const leaf = tab && s.terminalLayoutsByTabId[tab.id]?.activeLeafId;
      return tab ? { tabId: tab.id, paneKey: leaf ? `${tab.id}:${leaf}` : null } : null;
    }, key);
  /** Orca's hook row for Claude's pane, as a hook event would set it. */
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
  const expectCard = async (state, shot) => {
    const shown = card.and(page.locator(`[data-state="${state}"]`));
    await shown.waitFor({ timeout: 8_000 });
    await page.waitForTimeout(1_200);
    await shown.waitFor({ timeout: 5_000 });
    const head = await card.getByTestId("cook-card-head").innerText();
    const sub = (await card.getByTestId("cook-card-sub").count()) ? await card.getByTestId("cook-card-sub").innerText() : "";
    const strip = await pane.getByTestId("cook-segment").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}=${e.dataset.state}`).join(" "));
    console.log(`card ${state} (${await card.getAttribute("data-tone")}): ${head} | ${sub}\nstrip: ${strip}`);
    await snap(shot);
    await page.waitForTimeout(Number(process.env.COOK_PANE_PAUSE_MS ?? 0));
    return { head, sub, strip, tone: await card.getAttribute("data-tone") };
  };
  /** Waits until the fake Claude's terminal shows `text` (cat echoes what the pane typed). */
  const typed = async (text) => {
    for (let i = 0; i < 40; i++) {
      // Why strip newlines: xterm wraps a long line over several buffer lines.
      if ((await terminalText()).replace(/\n/g, "").includes(text)) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`terminal never showed ${JSON.stringify(text)}:\n${(await terminalText()).slice(-400)}`);
  };
  const resume = async () => {
    const before = (await claudeTab())?.tabId;
    await card.getByTestId("cook-resume").click();
    await page.waitForFunction(([k, b]) => {
      const t = (window.__store.getState().tabsByWorktree[k] ?? []).findLast((x) => x.launchAgent === "claude");
      return t && t.id !== b;
    }, [key, before], { timeout: 10_000 });
  };

  await step("a fresh Cook of plan-e2e-full: the reel workspace with the Cook pane and a fake Claude", async () => {
    const fake = path.join(ROOT, "..", "fake-claude.sh");
    writeFileSync(fake, '#!/bin/sh\necho "fake claude $*"\nexec cat\n');
    chmodSync(fake, 0o755);
    await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
    rmSync(FILM, { recursive: true, force: true });
    await page.evaluate((id) => {
      localStorage.removeItem(`cook-seen:${id}`);
      localStorage.removeItem(`cook-stopped:${id}`);
    }, PLAN);
    // A rerun reuses the reel workspace: close the terminals an earlier run left there.
    await page.evaluate(() => {
      const s = window.__store.getState();
      const w = s.folderWorkspaces.find((x) => x.name === "Reel: PLAN01 full script");
      for (const t of (w && s.tabsByWorktree[`folder:${w.id}`]) ?? []) s.closeTab(t.id);
      for (const t of (w && s.unifiedTabsByWorktree[`folder:${w.id}`]) ?? []) s.closeUnifiedTab(t.id);
      if (w) s.setActiveWorktree(`folder:${w.id}`);
    });
    await page.waitForTimeout(500);
    sql(`update planned_posts set cook_workspace_id = null, keyword = coalesce(keyword, 'COOKPANE') where id = '${PLAN}'`);
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
    console.log(`workspace ${key}, claude ${JSON.stringify(await claudeTab())}`);
  });

  await step("12 Claude asks hook A or B: amber card, one button per option, Recommended first", async () => {
    jobAt("script", "waiting");
    await hook({ state: "waiting", toolName: "AskUserQuestion", interactivePrompt: JSON.stringify(HOOK_ASK) }, 40_000);
    const { head, sub, strip, tone } = await expectCard("ask", "cook-pane-12-ask");
    const options = await card.getByTestId("cook-option").allInnerTexts();
    console.log(`options: ${JSON.stringify(options)}`);
    if (head !== "Claude needs you: which hook?" || !/^Asked 0:4\d ago\.$/.test(sub) || tone !== "need") throw new Error(head);
    if (!options[0].includes("Shorter hook") || !options[0].includes("Recommended") || options[1].includes("Recommended")) throw new Error("Recommended is not on option 1");
    if (!/Script\s*asked 0:4\d=waiting/.test(strip)) throw new Error(strip);
  });

  await step("15 still waiting after 2 h 10 min: the same card says how long and since when", async () => {
    await hook({ state: "waiting", toolName: "AskUserQuestion", interactivePrompt: JSON.stringify(HOOK_ASK) }, 130 * MIN);
    const { head, sub } = await expectCard("waiting-long", "cook-pane-15-waiting-long");
    if (head !== "Still waiting for you: which hook?" || !/^Asked 2 h 10 min ago, at \d\d:\d\d\.$/.test(sub)) throw new Error(`${head} | ${sub}`);
  });

  await step("a click on the Recommended option types 1 into the same Claude terminal", async () => {
    await card.getByTestId("cook-option").first().click();
    await typed("1");
    const tail = (await terminalText()).trim().split("\n").at(-1);
    console.log(`terminal last line: ${JSON.stringify(tail)}`);
    if (tail.trim() !== "1") throw new Error(`terminal shows ${JSON.stringify(tail)}`);
  });

  await step("14 Claude asks to run a command: the command, then Allow, Always allow in studio-reel, Deny", async () => {
    jobAt("render", "pending");
    await hook({ state: "waiting", toolName: "Bash", toolInput: `node styles/kai-hand-draw/tools/make.mjs films/${SLUG} render` }, 12_000);
    const { head, sub, strip } = await expectCard("permission", "cook-pane-14-permission");
    const command = await card.getByTestId("cook-approval-command").innerText();
    const buttons = await card.locator('[data-testid="cook-allow"], [data-testid="cook-always"], [data-testid="cook-deny"]').allInnerTexts();
    console.log(`command: ${command}\nbuttons: ${JSON.stringify(buttons)}`);
    if (head !== "Claude asks to run a command" || !/^Claude Code needs your OK first\. Asked 0:1\d ago\.$/.test(sub)) throw new Error(sub);
    if (buttons.join("|") !== "Allow|Always allow in studio-reel|Deny…") throw new Error(buttons.join("|"));
    if (!/Final\s*asked 0:1\d=waiting/.test(strip)) throw new Error(strip);
    await card.getByTestId("cook-always").click();
    await typed("12");
    console.log("Always allow typed 2 (Claude's \"Yes, and don't ask again\")");
  });

  await step("Claude asked in plain text: the fallback card with a reply box types the answer and Enter", async () => {
    jobAt("chapters", "waiting");
    await hook({ state: "done" });
    await expectCard("waiting", "cook-pane-13-plain-text");
    await card.getByTestId("cook-reply-input").fill("Block edits to .env files");
    await card.getByTestId("cook-reply-send").click();
    await typed("Block edits to .env files");
  });

  await step("32 Claude crashed: the tab is there but Claude left it, a red card with Resume cook", async () => {
    jobAt("chapters", "running");
    // A real exit: Ctrl-D ends the fake's `cat`, the shell is back, and Orca clears the tab's launchAgent.
    const t = await claudeTab();
    // Why wait: the reply's Enter lands a moment after its text; Ctrl-D ends cat only on an empty line.
    await page.waitForTimeout(1_500);
    const pty = await page.evaluate((id) => window.__store.getState().ptyIdsByTabId[id]?.[0], t.tabId);
    await page.evaluate((id) => window.api.pty.write(id, "\x04"), pty);
    const { head, sub, tone, strip } = await expectCard("crashed", "cook-pane-32-crashed");
    if (head !== "Claude stopped unexpectedly" || tone !== "err" || sub !== "The Claude process exited, during Build (chapters). 3 of 10 steps are done and kept.") throw new Error(sub);
    if (!strip.includes("Build=failed")) throw new Error(strip);
    await card.getByTestId("cook-resume").waitFor({ timeout: 2_000 });
    lastTab = t.tabId;
  });

  await step("34 the terminal tab was closed: a grey card, Claude is not running, Resume cook", async () => {
    await page.evaluate((id) => window.__store.getState().closeTab(id), lastTab);
    const { head, sub, tone, strip } = await expectCard("stopped", "cook-pane-34-stopped");
    if (head !== "Claude is not running" || tone !== "idle" || !sub.startsWith("The terminal tab was closed, during Build (chapters). 3 of 10") || !strip.includes("Build=paused")) throw new Error(sub);
  });

  await step("Resume cook starts a fresh Claude in the same workspace with /make-reel", async () => {
    await resume();
    await typed(`/make-reel workspace/scripts/${SLUG}.md`);
    await expectCard("building", "cook-pane-34-resumed");
  });

  /** Reloads the renderer (the app reopening: Claude's terminal survives in the daemon, board
   *  tabs do not), stamps the pane's last look, then goes back the way Kai does: Plan, Open workspace. */
  const reopen = async (seen) => {
    await page.reload();
    await page.waitForFunction(() => window.__store?.getState().folderWorkspaces?.length > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await setTheme();
    const origin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(([id, v]) => localStorage.setItem(`cook-seen:${id}`, JSON.stringify(v)), [PLAN, seen(origin)]);
    // Plan opens in the repo's own workspace, as it does for Kai; Open workspace then switches.
    const repo = await page.evaluate(() => Object.values(window.__store.getState().worktreesByRepo ?? {}).flat()[0]?.id);
    await page.evaluate((k) => window.__store.getState().setActiveWorktree(k), repo);
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("plan-view-week").click();
    await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).click();
    await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook-open").click();
    await pane.waitFor({ timeout: 10_000 });
    if ((await page.evaluate(() => window.__store.getState().activeWorktreeId)) !== key) throw new Error("Open workspace did not switch to the reel workspace");
    // Screen order, not store order: a group split in on the left is appended to the store's list.
    const cookX = (await pane.boundingBox())?.x ?? -1;
    const hasClaude = await page.evaluate((k) => (window.__store.getState().tabsByWorktree[k] ?? []).some((t) => t.launchAgent === "claude"), key);
    const termX = hasClaude ? ((await page.locator(".xterm:visible").first().boundingBox())?.x ?? -1) : -1;
    const layout = { groups: await page.evaluate((k) => (window.__store.getState().groupsByWorktree[k] ?? []).length, key), cookX: Math.round(cookX), claudeX: Math.round(termX) };
    console.log(`after reopen, Open workspace: ${JSON.stringify(layout)}`);
    if (cookX < 0 || (hasClaude && !(cookX < termX))) throw new Error("the Cook pane is not back left of Claude");
    return layout;
  };

  await step("35 the app reopened while Claude kept cooking: one blue line says what it did", async () => {
    // The pane last looked 22 min before the app started, at Build; job.json now has Draft and Final done.
    jobAt("review", "running");
    const layout = await reopen((origin) => ({ at: origin - 22 * MIN, done: ["Script", "Voice", "Build"] }));
    if (layout.claudeX < 0) throw new Error("Claude's terminal did not survive the reopen");
    const banner = pane.getByTestId("cook-banner");
    await banner.waitFor({ timeout: 10_000 });
    const text = await banner.innerText();
    console.log(`banner: ${text}`);
    if (text !== "Welcome back. While Lead Studio was closed (22 min), Claude kept cooking: Draft and Final are done.") throw new Error(text);
    await expectCard("mp4-ready", "cook-pane-35-reopen-alive");
    await pane.getByTestId("cook-banner-close").click();
    await banner.waitFor({ state: "detached", timeout: 2_000 });
  });

  await step("36 the app reopened after a Mac restart and Claude did not survive: grey, Resume cook", async () => {
    jobAt("render", "running", { pid: DEAD_PID });
    const t = await claudeTab();
    await page.evaluate((id) => window.__store.getState().closeTab(id), t.tabId);
    const booted = await page.evaluate((id) => window.api.crowsnest.call("getCookView", id).then((r) => r.value.bootedAt), PLAN);
    // The pane last looked before this Mac booted: the session did not survive the restart.
    await reopen(() => ({ at: booted - MIN, done: ["Script", "Voice", "Build", "Draft"] }));
    const { head, sub, tone, strip } = await expectCard("reopen-dead", "cook-pane-36-reopen-dead");
    if (head !== "Claude stopped when your Mac restarted" || tone !== "idle" || !strip.includes("Final=paused") || !/^During Final \(render\)\. 6 of 10 steps are done and kept\. The final starts again from frame 0 \(about 3 min\)\.$/.test(sub)) throw new Error(sub);
    if (await pane.getByTestId("cook-banner").count()) throw new Error("a Welcome back line while Claude is gone");
    // From here the fake reads raw bytes and prints them with cat -v, so Stop's Esc shows as ^[.
    const raw = path.join(ROOT, "..", "fake-claude-raw.sh");
    writeFileSync(raw, '#!/bin/sh\necho "fake claude $*"\nstty -icanon\nexec cat -uv\n');
    chmodSync(raw, 0o755);
    await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), raw);
    await resume();
    jobAt("chapters", "running");
    await expectCard("building", "cook-pane-36-resumed");
  });

  await step("41 Stop cook asks first: what stays and where the slot goes; Keep cooking changes nothing", async () => {
    await pane.getByTestId("cook-menu").click();
    await page.getByTestId("cook-stop").click();
    const dialog = page.getByTestId("cook-stop-dialog");
    await dialog.waitFor({ timeout: 3_000 });
    const text = await dialog.innerText();
    console.log(`dialog: ${text.replace(/\n+/g, " | ")}`);
    if (!text.includes("Stop this cook?") || !text.includes(`stays in films/${SLUG}/ (3 of 10 steps)`) || !text.includes("goes back to Plan.")) throw new Error(text);
    await snap("cook-pane-41-stop-confirm");
    await dialog.getByTestId("cook-stop-keep").click();
    await dialog.waitFor({ state: "detached", timeout: 3_000 });
    if (!sql(`select cook_workspace_id from planned_posts where id = '${PLAN}'`)) throw new Error("Keep cooking stopped the cook");
  });

  await step("42 Stop cook: Esc then /exit to Claude, the slot back to Plan, a grey card with Resume cook", async () => {
    await pane.getByTestId("cook-menu").click();
    await page.getByTestId("cook-stop").click();
    await page.getByTestId("cook-stop-confirm").click();
    await typed("/exit");
    const text = (await terminalText()).replace(/\n/g, "");
    const sent = text.slice(text.lastIndexOf(".md") + 3);
    console.log(`bytes after /make-reel: ${JSON.stringify(sent)}`);
    // A lone ^[ (Esc, not the start of a paste marker ^[[200~) comes before /exit.
    if (!/\^\[(?!\[)[\s\S]*\/exit/.test(sent)) throw new Error("no Esc before /exit");
    const { head, sub, tone } = await expectCard("stopped-by-kai", "cook-pane-42-stopped-by-kai");
    const stored = sql(`select coalesce(cook_workspace_id, 'null') from planned_posts where id = '${PLAN}'`);
    console.log(`db cook_workspace_id: ${stored}`);
    if (!/^Cook stopped by you at \d\d:\d\d$/.test(head) || tone !== "idle" || stored !== "null" || sub !== "3 of 10 steps are done and kept. The slot is back to Plan.") throw new Error(`${head} | ${sub} | ${stored}`);
  });

  await step("Resume cook after a stop cooks again: the row links the workspace and Claude starts", async () => {
    await resume();
    for (let i = 0; i < 20 && sql(`select coalesce(cook_workspace_id, '') from planned_posts where id = '${PLAN}'`) === ""; i++) await page.waitForTimeout(250);
    const stored = sql(`select coalesce(cook_workspace_id, '') from planned_posts where id = '${PLAN}'`);
    console.log(`db cook_workspace_id: ${stored}`);
    if (!stored) throw new Error("not cooking again");
    await expectCard("building", "cook-pane-42-resumed");
  });

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
}
