import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { parseAskFromStatus } from '../../../../shared/native-chat-ask'
import { parseNativeChatApprovalEnvelope } from '../../../../shared/native-chat-approval-envelope'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { cookPrompt, type CookPrompt } from './cook-claude-cards'

export const ESC = '\x1b'

/** The workspace's newest Claude terminal (Resume adds a newer one beside the old), and whether
 *  the last one seen is still open without Claude: Orca clears a tab's `launchAgent` once Claude
 *  has left it, so a crash leaves the tab and a closed tab leaves nothing. */
export function useCookClaudeTab(worktreeId: string): {
  tab: TerminalTab | undefined
  leftBehind: boolean
} {
  const tab = useAppStore((s) =>
    (s.tabsByWorktree[worktreeId] ?? []).findLast((t) => t.launchAgent === 'claude')
  )
  const [lastId, setLastId] = useState<string | null>(null)
  useEffect(() => {
    if (tab) {
      setLastId(tab.id)
    }
  }, [tab])
  const leftBehind = useAppStore(
    (s) =>
      !tab && lastId != null && (s.tabsByWorktree[worktreeId] ?? []).some((t) => t.id === lastId)
  )
  return { tab, leftBehind }
}

/** Orca's hook row for a one-pane Claude tab. */
export function useTabStatusEntry(tabId: string): AgentStatusEntry | null {
  return useAppStore((s) => {
    for (const [key, entry] of Object.entries(s.agentStatusByPaneKey)) {
      if (key.startsWith(`${tabId}:`)) {
        return entry
      }
    }
    return null
  })
}

/** What Claude waits on, from the same hook fields Orca's prompt cards read: the AskUserQuestion
 *  JSON in `interactivePrompt`, an approval envelope, else Claude's permission prompt
 *  (`toolName` / `toolInput` while waiting). */
export function promptFromStatus(entry: AgentStatusEntry | null): CookPrompt | null {
  if (!entry || entry.state !== 'waiting') {
    return null
  }
  const ask = parseAskFromStatus(entry.interactivePrompt, entry.toolName)
  if (ask) {
    return cookPrompt(ask)
  }
  const envelope = parseNativeChatApprovalEnvelope(entry.interactivePrompt, entry.agentType)
  if (envelope) {
    return {
      kind: 'approval',
      tool: envelope.tool,
      ...(envelope.summary ? { detail: envelope.summary } : {}),
      allow: envelope.allowSend,
      deny: envelope.denySend
    }
  }
  if (entry.toolName && entry.toolName !== 'AskUserQuestion') {
    // Claude Code's prompt: 1 Yes, 2 Yes and don't ask again here, Esc No.
    return {
      kind: 'approval',
      tool: entry.toolName,
      ...(entry.toolInput ? { detail: entry.toolInput } : {}),
      allow: '1',
      always: '2',
      deny: ESC
    }
  }
  return null
}
