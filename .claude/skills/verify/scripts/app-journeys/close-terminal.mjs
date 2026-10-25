export default async function closeTerminal({ page, step }) {
  await step("close terminal tabs", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      for (const tab of s.tabsByWorktree[s.activeWorktreeId] ?? []) s.closeTab(tab.id);
    });
  });
}
