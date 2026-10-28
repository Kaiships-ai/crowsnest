import React from 'react'
import { translate } from '@/i18n/i18n'
import type { CookView } from './cook-pane-state'
import type { ClaudeKeys } from './cook-prompt-answers'
import { openCookFile, showCookTerminal } from './cook-reel'
import { gateVersion, keywordFixMessage, keywordSpot } from './cook-version-cards'
import { PublishSheet } from './PublishSheet'

/** Proto 18: Edit caption opens CAPTION.md beside the pane; Ask Claude to fix it types rule R7 into
 *  Claude (`keys` only while Claude is alive). Returns the message to show, or null. */
export function captionAction(
  action: 'editcap' | 'fixkw',
  view: CookView,
  worktreeId: string,
  keys: ClaudeKeys | null
): string | null {
  const spot = keywordSpot(view)
  if (action === 'editcap') {
    if (view.captionFile) {
      openCookFile(worktreeId, view.captionFile, `films/${view.slug}/CAPTION.md`)
    }
    return null
  }
  if (!keys || !spot) {
    return translate(
      'boards.cook.fixNoClaude',
      'Claude is not running here, so it cannot fix the caption. Edit caption instead.'
    )
  }
  // Why: Edit caption may have put CAPTION.md over Claude; Kai sees Claude take the fix.
  showCookTerminal(worktreeId)
  keys.message(keywordFixMessage(view, spot.keyword))
  return null
}

/** Proto 25: puts the picked version's mp4, cover and caption on the plan row, so the sheet's five
 *  checks see them. Nothing is sent. Returns the error to show, or null. */
export async function attachCookToPlan(planId: string): Promise<string | null> {
  const res = await window.api.crowsnest.call('attachCookToPlanAction', planId)
  return !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
}

/** The Plan board's PublishSheet, opened from the Cook pane with the version Gate 2 gets. */
export function CookGate2Sheet({
  planId,
  view,
  open,
  onOpenChange
}: {
  planId: string
  view: CookView
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactNode {
  const n = gateVersion(view)
  return (
    <PublishSheet
      // Why '': a reel with no slot has no date, so the sheet asks for a time.
      card={{ id: planId, title: view.title, date: view.plannedDate ?? '', time: view.plannedTime }}
      open={open}
      onOpenChange={onOpenChange}
      version={`v${n} · versions/v${n}/`}
      onSent={() => onOpenChange(false)}
    />
  )
}
