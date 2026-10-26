import React, { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { PublishChecks, type PublishCheck } from './publish-checks'
import type { PlanCard } from './plan-card-parts'

const PUBLISHABLE = new Set<PlanCard['state']>(['draft', 'plan', 'missed', 'cooking', 'failed'])

type Sent = { status: 'idle' } | { status: 'sent' } | { status: 'error'; message: string }

function SheetBody({ card }: { card: PlanCard }): React.ReactNode {
  const [mode, setMode] = useState<'now' | 'at'>('at')
  const [time, setTime] = useState(`${card.date}T${card.time ?? '19:30'}`)
  const [checks, setChecks] = useState<PublishCheck[] | null>(null)
  const [sent, setSent] = useState<Sent>({ status: 'idle' })
  const [busy, setBusy] = useState(false)
  const at = mode === 'now' ? 'now' : time

  useEffect(() => {
    let cancelled = false
    void window.api.crowsnest.call('getPublishChecks', card.id, at).then((res) => {
      if (cancelled) {
        return
      }
      if (res.ok && res.value.ok) {
        setChecks(res.value.checks)
      } else {
        setSent({ status: 'error', message: res.ok ? res.value.error : res.error.message })
      }
    })
    return () => {
      cancelled = true
    }
  }, [card.id, at])

  const blocked = !checks || checks.some((c) => c.status === 'missing')
  const send = async (): Promise<void> => {
    setBusy(true)
    const res = await window.api.crowsnest.call('draftPublish', card.id, at)
    setBusy(false)
    if (res.ok && res.value.ok) {
      setSent({ status: 'sent' })
    } else {
      setSent({ status: 'error', message: res.ok ? res.value.error : res.error.message })
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(value) => value && setMode(value === 'now' ? 'now' : 'at')}
        className="self-start"
      >
        <ToggleGroupItem data-testid="publish-when-at" value="at">
          {translate('gate2.sheet.at', 'At a time')}
        </ToggleGroupItem>
        <ToggleGroupItem data-testid="publish-when-now" value="now">
          {translate('gate2.sheet.now', 'Right after approval')}
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === 'at' ? (
        <Input
          data-testid="publish-time"
          type="datetime-local"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="w-56 font-mono"
        />
      ) : null}
      {checks ? <PublishChecks checks={checks} /> : null}
      {sent.status === 'sent' ? (
        <div data-testid="publish-sent" className="flex items-center gap-2 text-sm">
          <span>{translate('gate2.sheet.sent', 'Sent to Gate 2. Nothing is published yet.')}</span>
          <Button
            data-testid="publish-open-gate2"
            variant="outline"
            size="xs"
            onClick={() => openBoardInActiveWorkspace('gate2')}
          >
            {translate('gate2.sheet.open', 'Open Gate 2')}
          </Button>
        </div>
      ) : (
        <Button
          data-testid="publish-send"
          className="self-start"
          disabled={busy || blocked}
          onClick={() => void send()}
        >
          <Send />
          {translate('gate2.sheet.send', 'Send to Gate 2')}
        </Button>
      )}
      {sent.status === 'error' ? (
        <p data-testid="publish-error" className="text-xs text-destructive">
          {sent.message}
        </p>
      ) : null}
    </div>
  )
}

/** "Publish" on a reel card with a video: the sheet runs the five checks and sends a draft to Gate 2. */
export function PublishButton({ card }: { card: PlanCard }): React.ReactNode {
  const [open, setOpen] = useState(false)
  if (!card.hasVideo || !PUBLISHABLE.has(card.state)) {
    return null
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button data-testid="plan-publish" variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Send />
        {translate('gate2.sheet.publish', 'Publish')}
      </Button>
      <SheetContent data-testid="publish-sheet" className="w-96 sm:max-w-96">
        <SheetHeader>
          <SheetTitle>
            {translate('gate2.sheet.title', 'Publish "{{title}}"', { title: card.title })}
          </SheetTitle>
          <SheetDescription>
            {translate(
              'gate2.sheet.description',
              'Lead Studio checks the reel, then it waits in Gate 2 for your approval.'
            )}
          </SheetDescription>
        </SheetHeader>
        {open ? <SheetBody card={card} /> : null}
      </SheetContent>
    </Sheet>
  )
}
