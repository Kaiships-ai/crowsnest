import React from 'react'
import { Flag, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'

export type PlanBoardData = EngineCallValue<'getPlanBoard'>
export type PlanDay = PlanBoardData['gridDays'][number]
export type PlanCard = PlanDay['cards'][number]
export const STATE_LABEL: Record<PlanCard['state'], string> = {
  draft: 'Nháp',
  plan: 'Plan',
  missed: 'Lỡ ngày',
  scheduled: 'Đã hẹn IG',
  publishing: 'Đang đăng',
  published: 'Đã đăng',
  failed: 'Đăng lỗi'
}
export const STATE_DOT: Record<PlanCard['state'], string> = {
  draft: 'bg-muted-foreground',
  plan: 'bg-chart-3',
  missed: 'bg-destructive',
  scheduled: 'bg-foreground',
  publishing: 'bg-foreground',
  published: 'bg-status-success',
  failed: 'bg-destructive'
}
export const ITEM_LABEL: Record<PlanCard['missing'][number], string> = {
  script: 'Script',
  caption: 'Caption',
  reference: 'Reel tham khảo',
  time: 'Giờ đăng',
  key: 'Key',
  gift: 'Quà',
  offer: 'Offer'
}
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export const dayLabel = (date: string): string => {
  const [, m, d] = date.split('-')
  return `${Number(d)}/${Number(m)}`
}
export function StateDot({ state }: { state: PlanCard['state'] }): React.ReactNode {
  return <span className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state])} />
}

export function StateBadge({ card }: { card: PlanCard }): React.ReactNode {
  return (
    <Badge variant="outline" data-testid="plan-state">
      <StateDot state={card.state} />
      {translate(`boards.plan.state.${card.state}`, STATE_LABEL[card.state])}
    </Badge>
  )
}

export function MissingFlag({ card }: { card: PlanCard }): React.ReactNode {
  return card.missing.length > 0 ? (
    <Flag
      data-testid="plan-flag"
      className="size-3 shrink-0 text-destructive"
      aria-label={translate('boards.plan.missingCount', 'Thiếu {{count}} mục', {
        count: card.missing.length
      })}
    />
  ) : null
}

export function AddButton({
  date,
  onAdd,
  compact = false
}: {
  date: string
  onAdd: (date: string) => void
  compact?: boolean
}) {
  const label = translate('boards.plan.add', 'Thêm reel')
  return (
    <Button
      data-testid="plan-add"
      data-date={date}
      variant="ghost"
      size={compact ? 'icon-xs' : 'xs'}
      aria-label={label}
      className="self-start text-muted-foreground"
      onClick={() => onAdd(date)}
    >
      <Plus />
      {compact ? null : label}
    </Button>
  )
}
