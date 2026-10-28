// Lead Studio v2 baseline: every v2 screen, light and dark, at 1440x900, under stable names.
// Run through baseline-lane.sh (stopped clock, fixed seed, no jobs). Later UI PRs diff against these.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = process.env.BASELINE_DIR ?? path.join(os.homedir(), ".claude/orchestrate/lead-studio-v2/baseline");
const CLOCK = process.env.LEAD_STUDIO_CLOCK_START;
if (!CLOCK || process.env.LEAD_STUDIO_CLOCK_FROZEN !== "1") throw new Error("run through baseline-lane.sh, which stops the clock");
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (q) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), q], { encoding: "utf8" }).trim();

async function theme(page, dark) {
  await page.evaluate((d) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", d);
  }, dark);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function baseline({ page, step }) {
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const shoot = async (name, before) => {
    for (const dark of [false, true]) {
      await theme(page, dark);
      if (before) await before();
      await page.waitForTimeout(500);
      const file = path.join(OUT, `${name}-${dark ? "dark" : "light"}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    }
    await theme(page, false);
    console.log(`shot: ${name}`);
  };
  const nav = (id) => page.locator(`[data-testid="ls-nav-row"][data-nav-id="${id}"]`).first();
  const board = (id) => page.locator(`[data-testid="board-tab"][data-board-id="${id}"]`);
  const parkMouse = () => page.mouse.move(1435, 895);

  await step("1440x900, renderer clock stopped with the app's, right sidebar closed", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date(CLOCK));
    await page.evaluate(() => window.__store.setState({ rightSidebarOpen: false }))
    console.log(`viewport: ${await page.evaluate(() => `${innerWidth}x${innerHeight}`)}, renderer now ${await page.evaluate(() => new Date().toString())}`);
  });

  await step("shell: Lead Studio rows replace Orca's nav, Workspaces below, no Tasks/Automations/Mobile/kanban/floating terminal", async () => {
    await nav("today").waitFor({ timeout: 20_000 });
    const rows = await page.getByTestId("ls-nav-row").allInnerTexts();
    if (rows.join("|") !== "Today|Funnel|My channel|Rivals|Plan|Studio\nSoon|Sources|Agents") throw new Error(`nav rows: ${rows.join("|")}`);
    for (const hidden of ["Tasks", "Automations", "Orca Mobile"]) {
      if (await page.getByRole("button", { name: hidden, exact: true }).isVisible().catch(() => false)) throw new Error(`${hidden} is visible`);
    }
    if (await page.locator("[data-workspace-board-trigger]").count()) throw new Error("workspace kanban toggle is visible");
  });

  await step("Today (B2-02): every Kpi names its state; Instagram's failed 05:00 pull is marked on views", async () => {
    await nav("today").click();
    const today = board("today");
    await today.getByTestId("today-step").first().waitFor({ timeout: 15_000 });
    const states = await today.getByTestId("today-step").evaluateAll((els) => els.map((e) => `${e.dataset.stepId}:${e.querySelector('[data-testid="kpi-value"]').dataset.state}`));
    console.log(`today steps: ${states.join(", ")}`);
    const want = "view:pull-failed,comment_keyword:not-connected,dm:value,gift_page_visit:partial,checkout:no-data,purchase:no-data";
    if (states.join(",") !== want) throw new Error(`want ${want}`);
    const dms = sql("select cast(sum(value) as integer) from reel_funnel where source = 'chatbotx' and metric = 'dms'");
    const shown = (await today.locator('[data-testid="today-step"][data-step-id="dm"] [data-num]').innerText()).replace(/\D/g, "");
    if (shown !== dms) throw new Error(`DMs shown ${shown}, lane DB ${dms}`);
    await parkMouse();
    await shoot("B2-02-today");
    await shoot("shell-sidebar");
  });

  await step("Funnel (B2-03): bars and Kpi states per step, keyword table, sources once per block", async () => {
    await nav("funnel").click();
    await board("funnel").getByTestId("funnel-step").first().waitFor({ timeout: 15_000 });
    await parkMouse();
    await shoot("B2-03-funnel");
  });

  await step("Plan month (B3-05): dot plus one-line title, tooltip with the full title and state", async () => {
    await nav("plan").click();
    const chip = page.locator('[data-testid="plan-chip"][data-plan-id="plan-month-1"]');
    await chip.waitFor({ timeout: 15_000 });
    await parkMouse();
    await shoot("B3-05-plan-month");
    await shoot("B3-05-plan-month-tooltip", async () => {
      await chip.hover();
      await page.getByTestId("plan-chip-tooltip").first().waitFor();
    });
    await parkMouse();
  });

  await step("Gate 1 (B4-01): change list with switches over Orca's side-by-side diff, edited line yellow, live count", async () => {
    await page.getByTestId("today-open-gate").click().catch(async () => {
      await nav("today").click();
      await page.getByTestId("today-open-gate").click();
    });
    const gate = board("gate");
    await gate.getByTestId("gate-change").first().waitFor({ timeout: 15_000 });
    const kinds = await gate.getByTestId("gate-change").evaluateAll((els) => els.map((e) => `${e.dataset.changeKey}:${e.dataset.kind}`));
    console.log(`changes vs live v1: ${kinds.join(", ")}`);
    if (kinds.join(",") !== "mcp5:remove,hooks:edit,sale2:add,mcp3:add") throw new Error("changes are not against the live version");
    await page.locator(".lead-diff-modified-line").first().waitFor({ timeout: 10_000 });
    if (!(await gate.getByTestId("gate-approve").innerText()).includes("4 changes")) throw new Error("approve count");
    await parkMouse();
    await shoot("B4-01-gate");
    await gate.locator('[data-change-key="hooks"]').getByTestId("gate-change-switch").click();
    if (!(await gate.getByTestId("gate-approve").innerText()).includes("3 of 4 changes")) throw new Error("count did not follow the switch");
    await parkMouse();
    await shoot("B4-01-gate-switch-off");
  });

  await step("Gate 1 approve (B4-02): the kept changes go live as v3, approved by kai and journaled; Undo restores v1", async () => {
    const gate = board("gate");
    await gate.getByTestId("gate-approve").click();
    await gate.getByTestId("gate-approved").waitFor({ timeout: 10_000 });
    const live = sql("select version || ' ' || approved_by from plan_versions where status = 'live'");
    const journal = sql("select caller || ' ' || gate || ' ' || result from agent_actions where tool = 'approvePlanChanges' order by id");
    console.log(`live: ${live}; journal: ${journal.replace(/\n/g, ", ")}`);
    if (live !== "3 kai") throw new Error(`live ${live}`);
    if (journal !== "kai gate1 pending\nkai gate1 ok") throw new Error(`journal ${journal}`);
    await parkMouse();
    await shoot("B4-02-gate-approved");
    await gate.getByTestId("gate-undo").click();
    await gate.getByTestId("gate-change").first().waitFor({ timeout: 10_000 });
    if (sql("select version from plan_versions where status = 'live'") !== "1") throw new Error("undo did not restore v1");
  });

  await step("Settings keeps only the creator panes; Sources (B1-01) looks like Orca's Integrations", async () => {
    await nav("sources").click();
    await page.getByTestId("lead-sources").waitFor({ timeout: 15_000 });
    const cards = await page.getByTestId("source-card").evaluateAll((els) => els.map((e) => `${e.dataset.connectorId}:${e.dataset.state}`));
    console.log(`sources: ${cards.join(", ")}`);
    if (!cards.includes("instagram-graph:error")) throw new Error("the failed Graph pull is not an error card");
    for (const hidden of ["Integrations", "Mobile", "Automations", "Git & Source Control"]) {
      if (await page.getByRole("button", { name: hidden, exact: true }).isVisible().catch(() => false)) throw new Error(`${hidden} pane is listed`);
    }
    await parkMouse();
    await shoot("B1-01-sources");
    await page.locator('[data-testid="source-card"][data-connector-id="polar"]').getByTestId("source-primary").click();
    await page.getByTestId("source-key-dialog").waitFor();
    await shoot("B1-01-sources-connect-dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to app" }).click();
  });

  console.log(`baseline: ${shots.length} shots in ${OUT}`);
}
