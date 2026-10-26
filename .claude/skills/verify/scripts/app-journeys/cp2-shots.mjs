// CP2 prototype: screenshot every variant, light and dark, 1440x900. Throwaway.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (q) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), q], { encoding: "utf8" }).trim();

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const CARDS = [
  [6, "published", "Cursor deleted my repo: 3 git commands to get it back"],
  [8, "published", "5 MCP servers worth installing as a beginner"],
  [13, "published", "Hooks in one picture: run tests after every edit"],
  [15, "failed", "Week 42 in numbers: 591k views, 4 orders"],
  [15, "published", "Claude Code vs Cursor: which one to pick"],
  [20, "published", "What a skill is, and your first one in 5 minutes"],
  [22, "draft", "3 MCP mistakes and how to fix them"],
  [27, "draft", "Sales reel: from 0 to 2 orders in a week"],
  [28, "scheduled", "Overnight agents: worth it or not"],
  [28, "draft", "Week 44 notes"],
  [29, "draft", "Long prompt or short prompt: a real test"],
  [30, "draft", "Week 44 in numbers"],
];

async function theme(page, dark) {
  await page.evaluate((d) => {
    const r = document.documentElement;
    r.classList.add("theme-transition-disabled");
    r.classList.toggle("dark", d);
  }, dark);
  await page.waitForTimeout(350);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function cp2({ page, step, snap }) {
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const both = async (name) => {
    await page.mouse.move(1430, 450);
    await theme(page, false);
    await snap(`${name}-light`);
    await theme(page, true);
    await snap(`${name}-dark`);
    await theme(page, false);
  };
  const pick = async (key, opt) => {
    if (!(await page.getByTestId(`cp2-${key}-${opt}`).isVisible().catch(() => false))) await page.getByTestId("cp2-toggle").click();
    await page.getByTestId(`cp2-${key}-${opt}`).click();
    await page.getByTestId("cp2-toggle").click();
    await page.waitForTimeout(400);
  };
  const board = async (id) => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator(`[data-testid="new-tab-board"][data-board-id="${id}"]`).click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.locator(`[data-testid="board-tab"][data-board-id="${id}"]`).waitFor();
  };

  await step("close the right sidebar (Lead Studio default)", async () => {
    await page.getByRole("button", { name: "Toggle right sidebar" }).first().click();
    await page.waitForTimeout(400);
  });

  await step("seed month cards with long titles", async () => {
    const stamp = new Date().toISOString();
    const values = CARDS.map(([d, s, t], i) => `('cp2-${i}','${s}','${t}','${ym}-${String(d).padStart(2, "0")}','${stamp}','${stamp}')`).join(",");
    sql(`delete from planned_posts where id like 'cp2-%'; insert into planned_posts (id,state,title,planned_date,created_at,updated_at) values ${values};`);
  });

  await step("sidebar A B C", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="today"]').first().waitFor({ timeout: 1000 }).catch(() => {});
    for (const v of ["A", "B", "C"]) {
      await pick("sidebar", v);
      const row = page.locator('[data-testid="ls-nav-row"][data-nav-id="today"]').first();
      await row.click();
      await page.locator('[data-testid="board-tab"][data-board-id="today"]').waitFor();
      await page.waitForTimeout(800);
      await both(`sidebar-${v}`);
    }
    await page.getByTestId("ls-mode-workspaces").click();
    await both("sidebar-C-workspace");
    await page.getByTestId("ls-mode-boards").click();
    await pick("sidebar", "B");
  });

  await step("gate A (red+green, yellow) B C", async () => {
    await board("cp2gate");
    await pick("gate", "A");
    await pick("mod", "red+green");
    await page.waitForTimeout(1500);
    await both("gate-A");
    await pick("mod", "yellow");
    await page.waitForTimeout(1500);
    await both("gate-A-yellow");
    await pick("mod", "red+green");
    await pick("gate", "B");
    await both("gate-B");
    await pick("gate", "C");
    await page.waitForTimeout(1500);
    await both("gate-C");
    await page.getByTestId("cp2-change-row").nth(1).locator('[role="switch"]').click();
    await page.waitForTimeout(1200);
    await both("gate-C-one-off");
  });

  await step("data states A B C", async () => {
    await board("cp2data");
    for (const v of ["A", "B", "C"]) {
      await pick("data", v);
      await both(`data-${v}`);
    }
  });

  await step("month chip A B C", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="plan"]').first().click();
    await page.getByTestId("plan-month").waitFor();
    for (const v of ["A", "B", "C"]) {
      await pick("chip", v);
      await page.locator('[data-testid="board-refresh"]').first().click().catch(() => {});
      await page.waitForTimeout(800);
      if (v === "B") {
        await theme(page, false);
        await page.locator('[data-testid="plan-chip"][data-plan-id="cp2-8"]').hover();
        await page.waitForTimeout(700);
        await snap(`chip-B-light`);
        await theme(page, true);
        await page.locator('[data-testid="plan-chip"][data-plan-id="cp2-8"]').hover();
        await page.waitForTimeout(700);
        await snap(`chip-B-dark`);
        await theme(page, false);
      } else await both(`chip-${v}`);
    }
  });

  await step("vault pane A B + key dialog", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="vault"]').first().click();
    await page.getByTestId("cp2-sources").waitFor();
    for (const v of ["A", "B"]) {
      await pick("vault", v);
      await page.waitForTimeout(600);
      await both(`vault-${v}`);
    }
    await page.getByTestId("cp2-edit-key").first().click();
    await page.getByTestId("cp2-key-dialog").waitFor();
    await both("vault-dialog");
    await page.keyboard.press("Escape");
  });
}
