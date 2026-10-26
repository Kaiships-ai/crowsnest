// Cook (B5-01) on a temp studio-reel copy (LEAD_STUDIO_COOK_ROOT, set by app-up.sh).
// Claude is a fake that prints its arguments and echoes what is typed, so nothing really runs.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { userDataDir, cookRoot: ROOT } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
if (!ROOT || !ROOT.includes("lead-studio-cook")) throw new Error("run on an app-up.sh lane, which points Cook at a temp studio-reel copy");
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const SCRIPT = "workspace/scripts/plan01-full-script-e-full.md";
const PROMPT = `/make-reel ${SCRIPT}`;

async function setTheme(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

const terminalText = (page, tabId) =>
  page.evaluate((id) => {
    const manager = window.__paneManagers?.get(id);
    const buffer = (manager?.getActivePane?.() ?? manager?.getPanes?.()[0])?.terminal?.buffer.active;
    if (!buffer) return "";
    return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "").join("\n");
  }, tabId);

export default async function cook01({ page, step, snapAndCompare }) {
  const board = page.getByTestId("board-tab");
  const card = board.locator('[data-testid="plan-detail"][data-plan-id="plan-e2e-full"]');
  let workspace;
  let tabId;
  const home = await page.evaluate(() => window.__store.getState().activeWorktreeId);
  const goHome = () => page.evaluate((id) => window.__store.getState().setActiveWorktree(id), home);
  await page.setViewportSize({ width: 1440, height: 900 });

  await step("Claude is a fake for this lane, so Cook never runs the real CLI", async () => {
    const fake = path.join(ROOT, "..", "fake-claude.sh");
    writeFileSync(fake, '#!/bin/sh\necho "fake claude $*"\nexec cat\n');
    chmodSync(fake, 0o755);
    await page.evaluate((cmd) => window.__store.getState().updateSettings({ agentCmdOverrides: { claude: cmd } }), fake);
    console.log(`claude: ${fake}`);
  });

  await step("the day card of a reel with a script has Cook; Cook writes the script into studio-reel", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="plan"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await board.getByTestId("plan-view-week").click();
    await board.locator('[data-testid="plan-card"][data-plan-id="plan-e2e-full"]').click();
    await card.getByTestId("plan-cook").click();
    const file = path.join(ROOT, SCRIPT);
    for (let i = 0; i < 50 && !existsSync(file); i++) await page.waitForTimeout(100);
    const body = readFileSync(file, "utf8");
    console.log(`${SCRIPT}:\n${body}`);
    const content = sql("select content from scripts where id = 'plan-e2e-script'");
    if (!body.startsWith("---\nslug: plan01-full-script-e-full\n") || !body.includes(`# PLAN01 full script\n\n## Script\n${content}\n`)) throw new Error("script file differs");
  });

  await step('Cook opens a "Reel: <title>" folder workspace on studio-reel and records it on the plan', async () => {
    await page.waitForFunction(() => window.__store.getState().folderWorkspaces.some((w) => w.name === "Reel: PLAN01 full script"), null, { timeout: 15_000 });
    workspace = await page.evaluate(() => {
      const s = window.__store.getState();
      const w = s.folderWorkspaces.find((x) => x.name === "Reel: PLAN01 full script");
      return { id: w.id, folderPath: w.folderPath, active: s.activeWorktreeId, group: s.projectGroups.find((g) => g.id === w.projectGroupId)?.name };
    });
    console.log(`workspace: ${JSON.stringify(workspace)}`);
    if (workspace.folderPath !== ROOT || workspace.active !== `folder:${workspace.id}` || workspace.group !== "Studio Reel") throw new Error("workspace differs");
    const stored = sql("select cook_workspace_id from planned_posts where id = 'plan-e2e-full'");
    console.log(`db cook_workspace_id: ${stored}`);
    if (stored !== workspace.id) throw new Error("plan does not link the workspace");
  });

  await step("a Claude tab in the workspace starts the launch and gets /make-reel typed in", async () => {
    await page.waitForFunction((key) => (window.__store.getState().tabsByWorktree[key] ?? []).some((t) => t.launchAgent === "claude"), `folder:${workspace.id}`, { timeout: 15_000 });
    tabId = await page.evaluate((key) => window.__store.getState().tabsByWorktree[key].find((t) => t.launchAgent === "claude").id, `folder:${workspace.id}`);
    let text = "";
    for (let i = 0; i < 120 && !text.includes(PROMPT); i++) {
      await page.waitForTimeout(500);
      text = await terminalText(page, tabId);
    }
    console.log(`terminal:\n${text.trim()}`);
    if (!text.includes("fake claude") || !text.includes(PROMPT)) throw new Error("launch or prompt missing in the terminal");
  });
  await page.mouse.move(1435, 895);
  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    await snapAndCompare(`B5-01-cook-workspace-${theme}`);
  }
  await setTheme(page, "light");

  await step("back on the plan the card says Cooking and Open workspace returns to the reel workspace", async () => {
    await goHome();
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="plan"]').first().click();
    await board.getByTestId("plan-view-week").click();
    const week = board.locator('[data-testid="plan-card"][data-plan-id="plan-e2e-full"]');
    await week.and(page.locator('[data-state="cooking"]')).waitFor({ timeout: 10_000 });
    console.log(`week card: ${await week.getByTestId("plan-state").innerText()}`);
    if ((await week.getByTestId("plan-state").innerText()) !== "Cooking") throw new Error("not Cooking");
    await week.click();
    await card.getByTestId("plan-cook-open").click();
    await page.waitForFunction((key) => window.__store.getState().activeWorktreeId === key, `folder:${workspace.id}`, { timeout: 10_000 });
  });
  await goHome();
}
