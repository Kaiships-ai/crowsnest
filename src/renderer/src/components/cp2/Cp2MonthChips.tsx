import React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { MissingFlag, StateDot, type PlanCard } from '../board/plan-card-parts'
import { useCp2 } from './cp2-variant'

// CP2 prototype: three month-chip shapes (B3-05). Throwaway.
const EN_STATE: Record<PlanCard['state'], string> = {
  draft: 'Draft',
  plan: 'Planned',
  missed: 'Missed',
  scheduled: 'Scheduled on IG',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed'
}
const chipClass = 'flex min-w-0 items-start gap-1 rounded px-1 text-left text-xs hover:bg-accent'

function Chip({
  card,
  onOpen,
  wrap
}: {
  card: PlanCard
  onOpen: () => void
  wrap: boolean
}): React.ReactNode {
  return (
    <button
      type="button"
      data-testid="plan-chip"
      data-plan-id={card.id}
      data-state={card.state}
      className={chipClass}
      onClick={onOpen}
    >
      <span className="flex h-4 items-center">
        <StateDot state={card.state} />
      </span>
      <span
        className={cn('min-w-0 flex-1 leading-4', wrap ? 'line-clamp-2 break-words' : 'truncate')}
      >
        {card.title}
      </span>
      <MissingFlag card={card} />
    </button>
  )
}

export function Cp2DayChips({
  cards,
  onOpen
}: {
  cards: PlanCard[]
  onOpen: () => void
}): React.ReactNode {
  const v = useCp2('chip')
  if (cards.length === 0) {
    return null
  }
  if (v === 'A') {
    return cards.map((c) => <Chip key={c.id} card={c} onOpen={onOpen} wrap />)
  }
  if (v === 'B') {
    return (
      <TooltipProvider delayDuration={300}>
        {cards.map((c) => (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 flex-col">
                <Chip card={c} onOpen={onOpen} wrap={false} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {c.title} · {EN_STATE[c.state]}
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    )
  }
  const first = cards[0]
  return (
    <button
      type="button"
      data-testid="plan-chip"
      data-plan-id={first.id}
      data-state={first.state}
      className="flex min-w-0 flex-col gap-0.5 rounded px-1 text-left hover:bg-accent"
      onClick={onOpen}
    >
      <span className="flex items-center gap-1">
        {cards.map((c) => (
          <StateDot key={c.id} state={c.state} />
        ))}
        <span className="ml-auto font-mono text-2xs text-muted-foreground">
          {translate('boards.plan.reelCount', '{{count}} reels', { count: cards.length })}
        </span>
      </span>
      <span className="truncate text-xs leading-4">{first.title}</span>
    </button>
  )
}
