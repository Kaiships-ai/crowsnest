import React, { useState } from 'react'
import { ChefHat, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cookReel, openCookWorkspace } from './cook-reel'
import { StatePill } from './kit/StatePill'
import { openPostInBrowser } from './open-post'
import { AddButton, ITEM_LABEL, StateBadge, type PlanCard, type PlanDay } from './plan-card-parts'

function Field({
  item,
  missing,
  children
}: {
  item: PlanCard['missing'][number]
  missing: boolean
  children?: React.ReactNode
}): React.ReactNode {
  return (
    <div
      data-testid="plan-field"
      data-item={item}
      data-missing={missing}
      className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border py-2 text-sm"
    >
      <span className="font-mono text-2xs text-muted-foreground">
        {translate(`boards.plan.item.${item}`, ITEM_LABEL[item])}
      </span>
      {missing ? (
        <span className="text-muted-foreground">{translate('boards.plan.notYet', 'not yet')}</span>
      ) : (
        <span className="min-w-0">{children}</span>
      )}
    </div>
  )
}

const COOKABLE = new Set<PlanCard['state']>(['draft', 'plan', 'missed'])

function CookButton({
  card,
  onCooked
}: {
  card: PlanCard
  onCooked: (error: string | null) => void
}): React.ReactNode {
  const [busy, setBusy] = useState(false)
  if (card.cookWorkspaceId) {
    const workspaceId = card.cookWorkspaceId
    return (
      <Button
        data-testid="plan-cook-open"
        variant="outline"
        size="xs"
        onClick={() => openCookWorkspace(workspaceId)}
      >
        {translate('boards.plan.cookOpen', 'Open workspace')}
      </Button>
    )
  }
  if (!card.script || !COOKABLE.has(card.state)) {
    return null
  }
  return (
    <Button
      data-testid="plan-cook"
      size="xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const outcome = await cookReel(card)
        setBusy(false)
        onCooked(outcome.ok ? null : outcome.error)
      }}
    >
      <ChefHat />
      {translate('boards.plan.cook', 'Cook')}
    </Button>
  )
}

export function DayView({
  day,
  today,
  onAdd,
  onCooked
}: {
  day: PlanDay
  today: string
  onAdd: (date: string) => void
  onCooked: (card: PlanCard, error: string | null) => void
}): React.ReactNode {
  return (
    <div data-testid="plan-day-view" data-date={day.date} className="flex flex-col gap-4">
      {day.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('boards.plan.emptyDay', 'No reel on this day.')}
        </p>
      ) : null}
      {day.cards.map((card) => {
        const missing = new Set(card.missing)
        return (
          <article
            key={card.id}
            data-testid="plan-detail"
            data-plan-id={card.id}
            data-state={card.state}
            className="flex flex-col gap-2 rounded-2xl border border-border p-4"
          >
            <header className="flex items-center gap-2">
              <h3 className="text-base font-medium">{card.title}</h3>
              <StateBadge card={card} />
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {card.time ?? ''}
              </span>
              <CookButton card={card} onCooked={(error) => onCooked(card, error)} />
            </header>
            {card.lockReason ? (
              <p data-testid="plan-lock-reason" className="text-xs text-muted-foreground">
                {card.lockReason}
              </p>
            ) : null}
            <div>
              <Field item="script" missing={!card.script}>
                <b className="font-medium">{card.script?.title}</b>
                <p className="line-clamp-4 whitespace-pre-line text-muted-foreground">
                  {card.script?.content}
                </p>
              </Field>
              <Field item="caption" missing={!card.caption}>
                <p className="line-clamp-4 whitespace-pre-line">{card.caption}</p>
              </Field>
              <Field item="reference" missing={!card.reference}>
                {card.reference ? (
                  <Button
                    data-testid="plan-reference-open"
                    data-url={card.reference.url}
                    variant="ghost"
                    size="xs"
                    onClick={() => card.reference && openPostInBrowser(card.reference.url)}
                  >
                    <ExternalLink />
                    {card.reference.handle}
                  </Button>
                ) : null}
              </Field>
              <Field item="time" missing={!card.time}>
                <span className="font-mono">{card.time}</span>
              </Field>
              <Field item="key" missing={missing.has('key')} />
              <Field item="gift" missing={missing.has('gift')} />
              <Field item="offer" missing={missing.has('offer')} />
            </div>
            {card.missing.length > 0 ? (
              <div data-testid="plan-missing" className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-2xs text-muted-foreground">
                  {translate('boards.plan.missingLabel', 'Missing')}
                </span>
                {card.missing.map((item) => (
                  <StatePill
                    key={item}
                    state={`missing-${item}`}
                    tone="attention"
                    label={translate(`boards.plan.item.${item}`, ITEM_LABEL[item])}
                  />
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
      {day.date >= today ? <AddButton date={day.date} onAdd={onAdd} /> : null}
    </div>
  )
}
