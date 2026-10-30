// What a failed cook journey prints beside its error: the Claude terminal's tail, the feedback box and its
// queue, Claude's hook row and foreground process, and the tab groups a file would open in.
export async function logCookState(page, worktreeId, planId) {
  const state = await page.evaluate(
    async ([key, plan]) => {
      const s = window.__store.getState();
      const claude = (s.tabsByWorktree[key] ?? []).findLast((t) => t.launchAgent === "claude");
      const ptyId = claude ? (s.ptyIdsByTabId[claude.id]?.[0] ?? null) : null;
      const manager = claude && window.__paneManagers?.get(claude.id);
      const buffer = (manager?.getActivePane?.() ?? manager?.getPanes?.()[0])?.terminal?.buffer.active;
      const lines = buffer ? Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? "").filter((l) => l.trim()) : [];
      return {
        worktreeId: key,
        terminalTail: lines.slice(-12),
        feedback: document.querySelector('[data-testid="cook-feedback"]')?.innerText ?? null,
        queued: localStorage.getItem(`cook-queued:${plan}`),
        claudeTab: claude ? { id: claude.id, title: claude.title, ptyId } : null,
        foreground: ptyId ? await window.api.pty.getForegroundProcess(ptyId).catch((e) => `error: ${e}`) : null,
        hookRows: Object.entries(s.agentStatusByPaneKey).filter(([k]) => claude && k.startsWith(`${claude.id}:`)).map(([k, e]) => ({ paneKey: k, state: e.state })),
        unifiedTabs: (s.unifiedTabsByWorktree[key] ?? []).map((t) => ({ id: t.id, entityId: t.entityId, contentType: t.contentType, groupId: t.groupId })),
        groups: (s.groupsByWorktree[key] ?? []).map((g) => ({ id: g.id, tabOrder: g.tabOrder, activeTabId: g.activeTabId })),
        activeGroupId: s.activeGroupIdByWorktree[key] ?? null,
        openFiles: s.openFiles.filter((f) => f.worktreeId === key).map((f) => f.relativePath),
      };
    },
    [worktreeId, planId],
  );
  console.log(`diagnostics: ${JSON.stringify(state, null, 2)}`);
}
