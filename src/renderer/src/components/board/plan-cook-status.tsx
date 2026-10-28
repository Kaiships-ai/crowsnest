import React, { useEffect, useState } from 'react'
import { useTabAgent } from '@/lib/use-tab-agent'
import { useAppStore } from '@/store'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { cookCard, cookSegments, type CookTone, type CookView } from './cook-pane-state'
import { waited, type CookClaude } from './cook-claude-cards'
import { promptFromStatus, useCookClaudeTab, useTabStatusEntry } from './use-cook-claude'

const POLL_MS = 2000

const DOT: Record<CookTone, string> = {
  run: 'size-2 rounded-full bg-chart-2',
  need: 'size-2 rotate-45 rounded-[2px] bg-status-warning',
  err: 'size-2 rounded-full bg-destructive',
  ok: 'size-2 rounded-full bg-status-success',
  idle: 'size-2 rounded-full bg-muted-foreground'
}

/** The Plan card's one cook line (proto 16, proposal 6): the Cook pane's card for the same job.json
 *  and Claude, in a few words. */
export function cookStatusLine(
  view: CookView,
  claude: CookClaude,
  now: number
): { tone: CookTone; text: string } {
  const card = cookCard(view, claude, now)
  const asked = claude.askedAt != null ? waited(Math.max(0, (now - claude.askedAt) / 1000)) : null
  if (card.prompt?.kind === 'question') {
    const q = card.prompt.question.charAt(0).toLowerCase() + card.prompt.question.slice(1)
    return { tone: 'need', text: `Needs you: ${q}${asked ? ` · ${asked}` : ''}` }
  }
  if (card.tone === 'need') {
    return {
      tone: 'need',
      text: `Needs you: ${card.head}${card.prompt && asked ? ` · ${asked}` : ''}`
    }
  }
  if (card.tone === 'idle') {
    return { tone: 'idle', text: 'Paused' }
  }
  if (card.tone === 'ok') {
    return { tone: 'ok', text: card.state === 'sent' ? 'Sent to Gate 2' : 'Ready' }
  }
  if (card.tone === 'err') {
    return { tone: 'err', text: card.head }
  }
  const at = cookSegments(view).find((seg) => seg.state !== 'done' && seg.state !== 'pending')
  return { tone: 'run', text: at ? `${at.group} · ${card.head}` : card.head }
}

/** The cook's view, polled, and when it was read (the line's clock). */
function useCookViewPoll(planId: string): { view: CookView; now: number } | null {
  const [read, setRead] = useState<{ view: CookView; now: number } | null>(null)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const result = await window.api.crowsnest.call('getCookView', planId).catch(() => null)
      if (stopped) {
        return
      }
      if (result?.ok && result.value.ok) {
        setRead({ view: result.value, now: Date.now() })
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [planId])
  return read
}

function Line({ tone, text }: { tone: CookTone; text: string }): React.ReactNode {
  return (
    <span
      data-testid="plan-cook-status"
      data-tone={tone}
      className="flex min-w-0 items-center gap-1.5 text-xs"
    >
      <span className={`flex-none ${DOT[tone]}`} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}

function WithClaude({
  view,
  now,
  tab
}: {
  view: CookView
  now: number
  tab: TerminalTab
}): React.ReactNode {
  const alive = useTabAgent(tab) != null
  const entry = useTabStatusEntry(tab.id)
  const claude: CookClaude = {
    liveness: alive ? 'alive' : 'exited',
    prompt: alive ? promptFromStatus(entry) : null,
    askedAt: entry?.stateStartedAt ?? null,
    stoppedAt: null,
    restarted: false
  }
  return <Line {...cookStatusLine(view, claude, now)} />
}

/** Beside Open workspace on a cooking Plan card. */
export function PlanCookStatus({
  planId,
  workspaceId
}: {
  planId: string
  workspaceId: string
}): React.ReactNode {
  const read = useCookViewPoll(planId)
  const { tab, leftBehind } = useCookClaudeTab(folderWorkspaceKey(workspaceId))
  const tabsReady = useAppStore((s) => s.workspaceSessionReady && s.terminalStartupRestorationReady)
  if (!read) {
    return null
  }
  if (tab) {
    return <WithClaude view={read.view} now={read.now} tab={tab} />
  }
  const claude: CookClaude = {
    liveness: leftBehind ? 'exited' : tabsReady ? 'closed' : 'unknown',
    prompt: null,
    askedAt: null,
    stoppedAt: null,
    restarted: false
  }
  return <Line {...cookStatusLine(read.view, claude, read.now)} />
}
