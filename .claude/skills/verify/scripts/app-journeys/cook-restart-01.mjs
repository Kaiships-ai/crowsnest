// The reel workspace survives a main-process restart. Cook makes "Reel: <title>" in the Studio Reel
// project group, which has no parent folder; the profile loader dropped such workspaces, so every
// restart lost it (and the hydration purge then closed its tabs). Dev mode only: the journey restarts
// main the way a main edit does, by touching src/main/index.ts, and reconnects over CDP.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const dod = ["B5-01"];

const REPO = path.resolve(import.meta.dirname, "../../../../..");
const STATE = path.join(REPO, "data/verify/app/state.json");
const LOG = path.join(REPO, "data/verify/app/host.log");
const { userDataDir, cdpPort, cookRoot: ROOT } = JSON.parse(readFileSync(STATE, "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
if (!readFileSync(LOG, "utf8").includes("dev mode")) throw new Error("run on an APP_DEV=1 lane: the journey restarts main through electron-vite's watch");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(REPO, "package.json"))("@playwright/test");
const PLAN = "plan-e2e-full";
const NAME = "Reel: PLAN01 full script";
const mainStarts = () => readFileSync(LOG, "utf8").split("[crowsnest] db ").length - 1;

const readReel = (name) => {
  const s = window.__store.getState();
  const w = s.folderWorkspaces.find((x) => x.name === name);
  const key = w && `folder:${w.id}`;
  return { id: w?.id ?? null, claude: (key && (s.tabsByWorktree[key] ?? []).filter((t) => t.launchAgent === "claude").length) || 0 };
};

export default async function cookRestart01({ page, step, snap }) {
  const board = page.locator('[data-testid="board-tab"]:visible');
  let before;
  let after;

  await step("Claude is a fake for this lane, and the plan is ready to Cook", async () => {
    const fake = path.join(ROOT, "..", "fake-claude.sh");
    writeFileSync(fake, '#!/bin/sh\necho "fake claude $*"\nexec cat\n');
    chmodSync(fake, 0o755);
    await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
    sql(`update planned_posts set cook_workspace_id = null where id = '${PLAN}'`);
    // Why: a restart before this run may have left no workspace selected, and so no tab bar.
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.setActiveWorktree(Object.keys(s.tabsByWorktree).find((k) => !k.startsWith("folder:")));
    });
  });

  await step("Cook opens the reel workspace with Claude in it", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("plan-view-week").click();
    await board.getByTestId("board-refresh").click();
    await board.locator(`[data-testid="plan-card"][data-plan-id="${PLAN}"]`).click();
    await board.locator(`[data-testid="plan-detail"][data-plan-id="${PLAN}"]`).getByTestId("plan-cook").click();
    await page.waitForFunction(`(${readReel})(${JSON.stringify(NAME)}).claude > 0`, null, { timeout: 15_000 });
    before = await page.evaluate(readReel, NAME);
    console.log(`before restart: ${JSON.stringify(before)}`);
    await snap("cook-restart-01-before");
  });

  await step("main restarts: the reel workspace and its Claude tab are still there", async () => {
    const starts = mainStarts();
    const now = new Date();
    utimesSync(path.join(REPO, "src/main/index.ts"), now, now);
    for (let i = 0; mainStarts() <= starts; i++) {
      if (i === 120) throw new Error("main did not restart within 60 s");
      await new Promise((r) => setTimeout(r, 500));
    }
    let browser;
    let fresh;
    for (let i = 0; !fresh && i < 120; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => null);
      fresh = browser?.contexts().flatMap((c) => c.pages()).find((p) => /\/renderer\/index\.html$|^http:\/\/localhost:\d+\/$/.test(p.url()));
      if (!fresh) await new Promise((r) => setTimeout(r, 500));
    }
    if (!fresh) throw new Error("no main window over CDP after the restart");
    try {
      await fresh.waitForFunction(() => window.__store?.getState().workspaceSessionReady === true, null, { timeout: 30_000 });
      // Why wait: the hydration purge runs after the first all-host worktree refresh.
      await fresh.waitForFunction(() => window.__store.getState().hasHydratedWorktreePurge === true, null, { timeout: 30_000 }).catch(() => {});
      after = await fresh.evaluate(readReel, NAME);
      console.log(`after restart: ${JSON.stringify(after)}`);
      // The run's evidence dir (app-drive.sh's run id); ctx.snap still holds the page from before the restart.
      const dir = path.join(REPO, "data/verify/evidence", process.argv[3] ?? "cook-restart-01");
      mkdirSync(dir, { recursive: true });
      await fresh.screenshot({ path: path.join(dir, "cook-restart-01-after.png") });
      if (after.id !== before.id) throw new Error(`reel workspace lost: ${JSON.stringify(after)}`);
      if (after.claude < 1) throw new Error("reel workspace is back but its Claude tab was purged");
      if (sql(`select cook_workspace_id from planned_posts where id = '${PLAN}'`) !== before.id) throw new Error("plan no longer points at the reel workspace");
      // Leave the app as later journeys expect it: on the repo's workspace.
      await fresh.evaluate(() => {
        const s = window.__store.getState();
        s.setActiveWorktree(Object.keys(s.tabsByWorktree).find((k) => !k.startsWith("folder:")));
      });
    } finally {
      await browser?.close().catch(() => {});
    }
  });
}
