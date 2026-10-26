import React from 'react'
import { ExternalLink, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
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

export function DayView({
  day,
  today,
  onAdd
}: {
  day: PlanDay
  today: string
  onAdd: (date: string) => void
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
              <p data-testid="plan-missing" className="flex items-center gap-2 text-xs">
                <Flag className="size-3 text-destructive" />
                {translate('boards.plan.missing', 'Missing: {{items}}', {
                  items: card.missing.map((item) => ITEM_LABEL[item]).join(', ')
                })}
              </p>
            ) : null}
          </article>
        )
      })}
      {day.date >= today ? <AddButton date={day.date} onAdd={onAdd} /> : null}
    </div>
  )
}
