import React, { useEffect, useState } from 'react'
import { Loader2, MoreHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useTabAgent } from '@/lib/use-tab-agent'
import { useAppStore } from '@/store'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useNativeChatInteractiveSend } from '../native-chat/use-native-chat-interactive-send'
import { sendNativeChatMessage } from '../native-chat/native-chat-runtime-send'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { cookReel, launchCookClaude, showCookTerminal } from './cook-reel'
import { cookCard, cookSegments, type CookAction, type CookView } from './cook-pane-state'
import { reopenBanner, waited, type CookClaude, type CookPrompt } from './cook-claude-cards'
import { CaptionBox, metaLine, ScriptBox, slotLabel, StatusCard, Strip } from './cook-pane-parts'
import { attachCookToPlan, captionAction, CookGate2Sheet } from './cook-gate2'
import { ApprovalButtons, QuestionOptions, ReplyBox, type ClaudeKeys } from './cook-prompt-answers'
import {
  ESC,
  promptFromStatus,
  useCookClaudeTab,
  useClaudeForeground,
  useTabStatusEntry
} from './use-cook-claude'
import { useCookView, type Reopen } from './use-cook-view'
import { compareCard } from './cook-version-cards'
import { CompareBox, VideoBox } from './cook-video'
import { FeedbackBox } from './cook-feedback'

const STALL: Partial<Record<string, 'failed' | 'paused'>> = {
  crashed: 'failed',
  stopped: 'paused',
  'reopen-dead': 'paused',
  'stopped-by-kai': 'paused'
}

/** The Cook pane (proto v2): left half of the "Reel: <title>" workspace, Claude on the right. */
export function CookPane({
  planId,
  worktreeId
}: {
  planId: string
  worktreeId: string
}): React.ReactNode {
  const { view, now, error, ...cook } = useCookView(planId)
  const { tab, leftBehind } = useCookClaudeTab(worktreeId)
  // Why: right after app start the reel workspace's tabs are not restored yet; no tab then is
  // not "Claude is not running", so the running card stays.
  const tabsReady = useAppStore((s) => s.workspaceSessionReady && s.terminalStartupRestorationReady)
  if (!view) {
    return (
      <div
        data-testid="cook-pane"
        data-plan-id={planId}
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
      >
        {error ?? <Loader2 className="size-4 animate-spin" />}
      </div>
    )
  }
  const props = { planId, worktreeId, view, now, ...cook }
  return tab ? (
    <CookPaneWithClaude {...props} tab={tab} />
  ) : (
    <CookPaneBody
      {...props}
      liveness={leftBehind ? 'exited' : tabsReady ? 'closed' : 'unknown'}
      claudeState={null}
      entryPrompt={null}
      askedAt={null}
      keys={null}
    />
  )
}

/** Reads Claude's tab: Orca's exit evidence, its hook row, and its pty for answers. */
function CookPaneWithClaude({
  tab,
  ...props
}: Omit<BodyProps, 'liveness' | 'claudeState' | 'entryPrompt' | 'askedAt' | 'keys'> & {
  tab: TerminalTab
}): React.ReactNode {
  const entry = useTabStatusEntry(tab.id)
  const ptyId = useAppStore((s) => s.ptyIdsByTabId[tab.id]?.[0] ?? null)
  const foreground = useClaudeForeground(ptyId)
  const agent = useTabAgent(tab)
  const send = useNativeChatInteractiveSend(entry?.paneKey ?? tab.id, ptyId, 'claude')
  const keys: ClaudeKeys | null = ptyId
    ? {
        answer: (prompt, choice) =>
          send.sendAnswer(
            prompt.ask,
            typeof choice === 'number' ? [{ indices: [choice] }] : [{ indices: [], other: choice }]
          ),
        raw: send.sendRaw,
        message: (text) => sendNativeChatMessage(ptyId, text)
      }
    : null
  return (
    <CookPaneBody
      {...props}
      liveness={
        agent == null || foreground === 'shell'
          ? 'exited'
          : foreground === 'unknown'
            ? 'unknown'
            : 'alive'
      }
      claudeState={entry?.state ?? null}
      entryPrompt={promptFromStatus(entry)}
      askedAt={entry?.stateStartedAt ?? null}
      keys={keys}
    />
  )
}

type BodyProps = {
  planId: string
  worktreeId: string
  view: CookView
  now: number
  reopen: Reopen | null
  forgetRestart: () => void
  stoppedAt: number | null
  markStopped: (at: number | null) => void
  liveness: CookClaude['liveness']
  /** Orca's hook state for Claude: working, waiting, blocked or done. */
  claudeState: string | null
  entryPrompt: CookPrompt | null
  askedAt: number | null
  keys: ClaudeKeys | null
}

function CookPaneBody({
  planId,
  worktreeId,
  view,
  now,
  reopen,
  forgetRestart,
  stoppedAt,
  markStopped,
  liveness,
  claudeState,
  entryPrompt,
  askedAt,
  keys
}: BodyProps): React.ReactNode {
  const [shown, setShown] = useState<number | null>(null)
  const [comparing, setComparing] = useState<[number, number] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [bannerShut, setBannerShut] = useState(false)
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    if (liveness === 'alive') {
      forgetRestart()
    }
  }, [liveness, forgetRestart])
  const claude: CookClaude = {
    liveness,
    prompt: entryPrompt,
    askedAt,
    stoppedAt,
    restarted: reopen?.restarted ?? false
  }
  const stepCard = cookCard(view, claude, now)
  const card = comparing && stepCard.compare ? compareCard(view, comparing) : stepCard
  const asked =
    card.prompt && askedAt != null ? waited(Math.max(0, (now - askedAt) / 1000)) : undefined
  const steps = view.steps ?? []
  const done = steps.filter((s) => s.status === 'done').length
  const running = view.cooking && card.tone !== 'ok'
  const showBanner =
    reopen != null && !bannerShut && view.cooking && liveness === 'alive' && !reopen.restarted

  const cookAgain = async (): Promise<void> => {
    setBusy(true)
    const outcome = await cookReel({ id: planId }, () =>
      setMessage(
        translate('boards.plan.cookNoAgent', 'Could not start Claude in the reel workspace.')
      )
    )
    setBusy(false)
    setMessage(outcome.ok ? null : outcome.error)
    if (outcome.ok) {
      markStopped(null)
    }
  }
  const onAction = async (action: CookAction): Promise<void> => {
    if (action === 'gate2') {
      setBusy(true)
      const error = await attachCookToPlan(planId)
      setBusy(false)
      setMessage(error)
      setSheet(!error)
      return
    }
    if (action === 'opengate') {
      openBoardInActiveWorkspace('gate2')
      return
    }
    if (action === 'editcap' || action === 'fixkw') {
      setMessage(captionAction(action, view, worktreeId, liveness === 'alive' ? keys : null))
      return
    }
    if (action === 'terminal') {
      showCookTerminal(worktreeId)
      return
    }
    if (action === 'compare' || action === 'donecompare') {
      setComparing(action === 'compare' ? (card.compare ?? null) : null)
      return
    }
    // Why: after Stop cook the plan row is back to Plan, so Resume cooks again to re-link it.
    if (action === 'retry' || !view.cooking) {
      await cookAgain()
      return
    }
    if (view.root) {
      launchCookClaude({
        worktreeId,
        planId,
        root: view.root,
        scriptPath: `workspace/scripts/${view.slug}.md`
      })
    }
  }
  // Proto 42: Esc interrupts Claude, /exit ends it, and the plan row goes back to Plan.
  const stopCook = async (): Promise<void> => {
    setConfirmStop(false)
    if (keys && liveness === 'alive') {
      keys.raw(ESC)
      await new Promise((resolve) => setTimeout(resolve, 400))
      keys.message('/exit')
    }
    if (view.workspaceId) {
      await window.api.crowsnest.call('clearPlanCookingAction', planId, view.workspaceId)
    }
    markStopped(Date.now())
  }
  const slot = slotLabel(view)
  return (
    <div
      data-testid="cook-pane"
      data-plan-id={planId}
      data-state={card.state}
      data-claude={liveness}
      aria-busy={busy}
      className="scrollbar-sleek @container h-full overflow-y-auto"
    >
      {showBanner ? (
        <div
          data-testid="cook-banner"
          role="status"
          className="flex items-start gap-2 border-b border-border bg-chart-2/10 px-4 py-2 text-[13px]"
        >
          <span className="min-w-0 flex-1">{reopenBanner(reopen.closedSec, reopen.newlyDone)}</span>
          <button
            type="button"
            data-testid="cook-banner-close"
            aria-label={translate('boards.cook.dismiss', 'Dismiss')}
            onClick={() => setBannerShut(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3.5 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-semibold">{view.title}</h2>
            <div className="font-mono text-2xs break-all text-muted-foreground">
              {metaLine(view)}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="cook-menu"
                size="icon-sm"
                variant="ghost"
                aria-label={translate('boards.cook.moreActions', 'More actions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => showCookTerminal(worktreeId)}>
                {translate('boards.cook.terminal', 'Show terminal')}
              </DropdownMenuItem>
              {running ? (
                <DropdownMenuItem
                  data-testid="cook-stop"
                  variant="destructive"
                  onSelect={() => setConfirmStop(true)}
                >
                  {translate('boards.cook.stop', 'Stop cook…')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <StatusCard card={card} onAction={(action) => void onAction(action)}>
          {card.prompt?.kind === 'question' ? (
            <QuestionOptions key={askedAt} prompt={card.prompt} keys={keys} />
          ) : card.prompt?.kind === 'approval' ? (
            <ApprovalButtons key={askedAt} prompt={card.prompt} keys={keys} />
          ) : card.reply ? (
            <ReplyBox keys={liveness === 'alive' ? keys : null} />
          ) : null}
        </StatusCard>
        {message ? (
          <p data-testid="cook-message" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <Strip segments={cookSegments(view, { asked, stall: STALL[card.state] })} />
        {comparing && stepCard.compare ? (
          <CompareBox
            view={view}
            pair={comparing}
            onUse={(n) => void window.api.crowsnest.call('pickCookVersionAction', planId, n)}
          />
        ) : (
          <div className="grid gap-3 @min-[520px]:grid-cols-[188px_minmax(0,1fr)]">
            <VideoBox view={view} shown={shown} onShow={setShown} />
            <div className="flex min-w-0 flex-col gap-3">
              <ScriptBox view={view} />
              <CaptionBox view={view} />
            </div>
          </div>
        )}
        {!comparing && (view.video || view.versions.length > 0) ? (
          <FeedbackBox
            planId={planId}
            view={view}
            claudeIdle={liveness === 'alive' && claudeState === 'done'}
            type={keys ? keys.message : null}
          />
        ) : null}
      </div>
      <CookGate2Sheet planId={planId} view={view} open={sheet} onOpenChange={setSheet} />
      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent data-testid="cook-stop-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{translate('boards.cook.stopTitle', 'Stop this cook?')}</DialogTitle>
            <DialogDescription>
              {slot
                ? translate(
                    'boards.cook.stopBody',
                    'Claude stops now. What is made so far stays in films/{{slug}}/ ({{done}} of {{total}} steps). The {{slot}} slot goes back to Plan.',
                    { slug: view.slug, done, total: steps.length || 10, slot }
                  )
                : translate(
                    'boards.cook.stopBodyNoSlot',
                    'Claude stops now. What is made so far stays in films/{{slug}}/ ({{done}} of {{total}} steps). The slot goes back to Plan.',
                    { slug: view.slug, done, total: steps.length || 10 }
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="cook-stop-keep"
              variant="outline"
              onClick={() => setConfirmStop(false)}
            >
              {translate('boards.cook.keepCooking', 'Keep cooking')}
            </Button>
            <Button
              data-testid="cook-stop-confirm"
              variant="destructive"
              onClick={() => void stopCook()}
            >
              {translate('boards.cook.stopConfirm', 'Stop cook')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
