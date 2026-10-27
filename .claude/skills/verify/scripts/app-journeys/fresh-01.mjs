// Runs on fresh-lane.sh: no project open. Each sidebar row must open its board (or Sources)
// without a workspace; a first-launch user has no other way in.
export const dod = [];

const BOARD_ROWS = ["today", "funnel", "own", "rivals", "plan", "agents"];

export default async function fresh01({ page, step, snap }) {
  await step("the lane has no project open", async () => {
    const worktree = await page.evaluate(() => window.__store.getState().activeWorktreeId);
    if (worktree) throw new Error(`active worktree ${worktree}; run this on fresh-lane.sh`);
  });

  for (const id of BOARD_ROWS) {
    await step(`with no workspace, the ${id} sidebar row opens its board`, async () => {
      await page.locator(`[data-testid="ls-nav-row"][data-nav-id="${id}"]`).click();
      const opened = await page
        .waitForFunction(
          (id) => window.__store.getState().openFiles.some((f) => f.mode === "board" && f.boardId === id),
          id,
          { timeout: 5_000 },
        )
        .then(() => true, () => false);
      if (!opened) throw new Error(`clicking ${id} opened no board tab`);
    });
  }

  await step('the boards opened in the "Lead Studio" folder workspace, with no terminal seeded', async () => {
    const ws = await page.evaluate(() => {
      const s = window.__store.getState();
      const repo = s.repos.find((r) => (s.worktreesByRepo[r.id] ?? []).some((w) => w.id === s.activeWorktreeId));
      return { name: repo?.displayName ?? null, terminals: (s.tabsByWorktree[s.activeWorktreeId] ?? []).length };
    });
    console.log(`workspace: ${JSON.stringify(ws)}`);
    if (ws.name !== "Lead Studio") throw new Error(`active workspace is ${ws.name}, not "Lead Studio"`);
    if (ws.terminals !== 0) throw new Error(`${ws.terminals} terminal tab(s) seeded in the Lead Studio workspace`);
  });

  await step("with no workspace, the Sources row opens Settings > Sources", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await page.waitForFunction(() => window.__store.getState().activeView === "settings", null, { timeout: 5_000 });
  });
  await snap("fresh-01-end");
}
