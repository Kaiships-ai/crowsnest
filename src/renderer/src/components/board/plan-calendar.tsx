import React, { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  AddButton,
  dayLabel,
  MissingFlag,
  StateBadge,
  StateDot,
  STATE_LABEL,
  WEEKDAYS,
  type PlanBoardData,
  type PlanCard,
  type PlanDay
} from './plan-card-parts'

export function MonthView({
  board,
  onWeek,
  onDay,
  onAdd
}: {
  board: PlanBoardData
  onWeek: (date: string) => void
  onDay: (date: string) => void
  onAdd: (date: string) => void
}): React.ReactNode {
  const weeks = Array.from({ length: board.gridDays.length / 7 }, (_, i) =>
    board.gridDays.slice(i * 7, i * 7 + 7)
  )
  return (
    <div data-testid="plan-month" className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1">
      <span />
      {WEEKDAYS.map((name) => (
        <span key={name} className="px-1 font-mono text-2xs text-muted-foreground">
          {name}
        </span>
      ))}
      {weeks.map((week) => (
        <React.Fragment key={week[0].date}>
          <Button
            data-testid="plan-week"
            data-week-start={week[0].date}
            variant="ghost"
            size="xs"
            className="self-start font-mono text-2xs text-muted-foreground"
            onClick={() => onWeek(week[0].date)}
          >
            {translate('boards.plan.weekOf', 'Week {{day}}', { day: dayLabel(week[0].date) })}
          </Button>
          {week.map((day) => (
            <div
              key={day.date}
              data-testid="plan-month-day"
              data-date={day.date}
              data-in-month={day.inMonth}
              className={cn(
                'flex min-h-24 flex-col gap-1 rounded-lg border border-border p-1.5',
                !day.inMonth && 'opacity-50',
                day.date === board.today && 'ring-1 ring-ring'
              )}
            >
              <span className="font-mono text-2xs text-muted-foreground">
                {Number(day.date.slice(8))}
              </span>
              {day.cards.map((card) => (
                <Tooltip key={card.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="plan-chip"
                      data-plan-id={card.id}
                      data-state={card.state}
                      className="flex min-w-0 items-center gap-1 rounded px-1 text-left text-xs hover:bg-accent"
                      onClick={() => onDay(day.date)}
                    >
                      <StateDot state={card.state} />
                      <span className="min-w-0 flex-1 truncate">{card.title}</span>
                      <MissingFlag card={card} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent data-testid="plan-chip-tooltip" side="top" sideOffset={4}>
                    {card.title} ·{' '}
                    {translate(`boards.plan.state.${card.state}`, STATE_LABEL[card.state])}
                  </TooltipContent>
                </Tooltip>
              ))}
              {day.cards.length === 0 && day.date >= board.today ? (
                <AddButton date={day.date} onAdd={onAdd} compact />
              ) : null}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

export function WeekView({
  days,
  today,
  onDay,
  onAdd,
  onMove,
  onRefuse
}: {
  days: PlanDay[]
  today: string
  onDay: (date: string) => void
  onAdd: (date: string) => void
  onMove: (planId: string, date: string) => void
  onRefuse: (card: PlanCard) => void
}): React.ReactNode {
  const [over, setOver] = useState<string | null>(null)
  return (
    <div data-testid="plan-week-view" className="grid grid-cols-7 gap-2">
      {days.map((day, i) => (
        <div
          key={day.date}
          data-testid="plan-week-day"
          data-date={day.date}
          className={cn(
            'flex min-h-64 min-w-0 flex-col gap-2 rounded-xl p-1',
            over === day.date && 'bg-accent'
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(day.date)
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(null)
            const planId = event.dataTransfer.getData('text/plain')
            if (planId) {
              onMove(planId, day.date)
            }
          }}
        >
          <span className="px-1 text-xs">
            <b className="font-medium">{WEEKDAYS[i]}</b>{' '}
            <span className="font-mono text-muted-foreground">{dayLabel(day.date)}</span>
          </span>
          {day.cards.map((card) => (
            <article
              key={card.id}
              data-testid="plan-card"
              data-plan-id={card.id}
              data-state={card.state}
              data-movable={card.lockReason === null}
              draggable
              title={card.lockReason ?? undefined}
              onDragStart={(event) => {
                if (card.lockReason) {
                  event.preventDefault()
                  onRefuse(card)
                  return
                }
                event.dataTransfer.setData('text/plain', card.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => onDay(day.date)}
              className={cn(
                'flex cursor-grab flex-col gap-2 rounded-xl border border-border bg-card p-2.5',
                card.lockReason && 'cursor-not-allowed'
              )}
            >
              <span className="flex flex-wrap items-center gap-1">
                <StateBadge card={card} />
                {card.lockReason ? (
                  <Lock className="size-3 text-muted-foreground" aria-label={card.lockReason} />
                ) : null}
                <span className="ml-auto">
                  <MissingFlag card={card} />
                </span>
              </span>
              <h4 className="text-sm leading-snug font-medium">{card.title}</h4>
              <span data-testid="plan-time" className="font-mono text-xs text-muted-foreground">
                {card.time ?? translate('boards.plan.noTime', 'no time')}
              </span>
            </article>
          ))}
          {day.cards.length === 0 && day.date >= today ? (
            <AddButton date={day.date} onAdd={onAdd} />
          ) : null}
        </div>
      ))}
    </div>
  )
}
