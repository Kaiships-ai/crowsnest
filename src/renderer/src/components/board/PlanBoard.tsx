import React, { useCallback, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BoardStates } from './BoardStates'
import { MonthView, WeekView } from './plan-calendar'
import { dayLabel, WEEKDAYS, type PlanBoardData } from './plan-card-parts'
import { DayView } from './PlanDayView'
import { useBoardLoad } from './use-board-load'

const VIEWS = ['month', 'week', 'day'] as const
type View = (typeof VIEWS)[number]
const isView = (value: string): value is View => VIEWS.some((view) => view === value)
type Message = { status: 'done' | 'error'; text: string; planId?: string } | null
const localDate = (date: Date): string => date.toLocaleDateString('sv-SE')
const shiftDate = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}
const shiftMonth = (date: string, months: number): string => {
  const [y, m] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1 + months, 1))
}
function AddForm({
  date,
  onClose,
  onAdded
}: {
  date: string
  onClose: () => void
  onAdded: (message: Message) => void
}): React.ReactNode {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      return
    }
    setBusy(true)
    const result = await window.api.crowsnest.call('createPlannedPostAction', {
      title,
      plannedDate: date,
      ...(time ? { plannedTime: time } : {})
    })
    setBusy(false)
    const outcome = result.ok ? result.value : { ok: false as const, error: result.error.message }
    if (!outcome.ok) {
      onAdded({ status: 'error', text: outcome.error })
      return
    }
    onAdded({
      status: 'done',
      text: translate('boards.plan.added', 'Added "{{title}}" to {{day}}.', {
        title: title.trim(),
        day: dayLabel(date)
      }),
      planId: outcome.id
    })
  }
  return (
    <form
      data-testid="plan-add-form"
      data-date={date}
      onSubmit={submit}
      className="flex items-center gap-2 rounded-xl border border-border p-2"
    >
      <span className="font-mono text-xs text-muted-foreground">{dayLabel(date)}</span>
      <Input
        data-testid="plan-add-title"
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={translate('boards.plan.titlePlaceholder', 'Reel title')}
        className="w-72"
      />
      <Input
        data-testid="plan-add-time"
        type="time"
        value={time}
        onChange={(event) => setTime(event.target.value)}
        className="w-28"
      />
      <Button data-testid="plan-add-submit" type="submit" size="sm" disabled={busy}>
        {translate('boards.plan.addSubmit', 'Add')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        {translate('boards.plan.cancel', 'Cancel')}
      </Button>
    </form>
  )
}
function PlanView({
  board,
  view,
  setView,
  focus,
  setFocus,
  message,
  setMessage,
  reload
}: {
  board: PlanBoardData
  view: View
  setView: (view: View) => void
  focus: string
  setFocus: (date: string) => void
  message: Message
  setMessage: (message: Message) => void
  reload: () => void
}): React.ReactNode {
  const [adding, setAdding] = useState<string | null>(null)
  const index = Math.max(
    0,
    board.gridDays.findIndex((d) => d.date === focus)
  )
  const week = board.gridDays.slice(index - (index % 7), index - (index % 7) + 7)
  const step = (direction: 1 | -1) =>
    setFocus(
      view === 'month'
        ? shiftMonth(focus, direction)
        : shiftDate(focus, view === 'week' ? 7 * direction : direction)
    )
  const open = (next: View) => (date: string) => {
    setFocus(date)
    setView(next)
  }
  const move = async (planId: string, date: string) => {
    const card = board.gridDays.flatMap((d) => d.cards).find((c) => c.id === planId)
    if (!card || card.date === date) {
      return
    }
    const result = await window.api.crowsnest.call('movePlanCardAction', planId, date)
    const outcome = result.ok ? result.value : { ok: false as const, error: result.error.message }
    setMessage(
      outcome.ok
        ? {
            status: 'done',
            text: translate('boards.plan.moved', 'Moved "{{title}}" to {{day}}.', {
              title: card.title,
              day: dayLabel(date)
            }),
            planId
          }
        : { status: 'error', text: outcome.error, planId }
    )
    reload()
  }
  const [y, m] = focus.split('-')
  const heading =
    view === 'month'
      ? translate('boards.plan.month', '{{month}}/{{year}}', { month: Number(m), year: y })
      : view === 'week'
        ? translate('boards.plan.week', 'Week {{from}} – {{to}}', {
            from: dayLabel(week[0].date),
            to: dayLabel(week[6].date)
          })
        : `${WEEKDAYS[index % 7]} ${dayLabel(focus)}`
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-4 overflow-auto p-4">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-2xs text-muted-foreground">
            {translate('boards.plan.title', 'Plan')}
          </span>
          <h1 data-testid="plan-heading" className="text-xl font-medium">
            {heading}
          </h1>
        </div>
        <ToggleGroup
          data-testid="plan-views"
          type="single"
          variant="segmented"
          size="xs"
          spacing={1}
          value={view}
          onValueChange={(next) => isView(next) && setView(next)}
        >
          <ToggleGroupItem value="month" data-testid="plan-view-month">
            {translate('boards.plan.viewMonth', 'Month')}
          </ToggleGroupItem>
          <ToggleGroupItem value="week" data-testid="plan-view-week">
            {translate('boards.plan.viewWeek', 'Week')}
          </ToggleGroupItem>
          <ToggleGroupItem value="day" data-testid="plan-view-day">
            {translate('boards.plan.viewDay', 'Day')}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center">
          <Button
            data-testid="plan-prev"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('boards.plan.prev', 'Previous')}
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            data-testid="plan-today"
            variant="ghost"
            size="xs"
            onClick={() => setFocus(board.today)}
          >
            {translate('boards.plan.today', 'Today')}
          </Button>
          <Button
            data-testid="plan-next"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('boards.plan.next', 'Next')}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          data-testid="board-refresh"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('boards.refresh', 'Refresh')}
          onClick={reload}
        >
          <RefreshCw />
        </Button>
      </header>
      {message ? (
        <p
          data-testid="plan-message"
          data-status={message.status}
          data-plan-id={message.planId}
          className={cn(
            'text-sm',
            message.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {message.text}
        </p>
      ) : null}
      {adding ? (
        <AddForm
          key={adding}
          date={adding}
          onClose={() => setAdding(null)}
          onAdded={(next) => {
            setMessage(next)
            if (next?.status === 'done') {
              setAdding(null)
              reload()
            }
          }}
        />
      ) : null}
      {view === 'month' ? (
        <MonthView board={board} onWeek={open('week')} onDay={open('day')} onAdd={setAdding} />
      ) : view === 'week' ? (
        <WeekView
          days={week}
          today={board.today}
          onDay={open('day')}
          onAdd={setAdding}
          onMove={move}
          onRefuse={(card) =>
            setMessage({ status: 'error', text: card.lockReason ?? '', planId: card.id })
          }
        />
      ) : (
        <DayView day={board.gridDays[index]} today={board.today} onAdd={setAdding} />
      )}
    </div>
  )
}

export function PlanBoard(): React.ReactNode {
  const [view, setView] = useState<View>('month')
  const [focus, setFocus] = useState(() => localDate(new Date()))
  const [message, setMessage] = useState<Message>(null)
  const month = focus.slice(0, 7)
  const load = useCallback(
    () =>
      window.api.crowsnest
        .call('getPlanBoard', month)
        .then((result) => (result.ok ? { ok: true as const, value: [result.value] } : result)),
    [month]
  )
  const { state, retry } = useBoardLoad(load)
  return (
    <BoardStates state={state} retry={retry} emptyMessage="">
      {([board]) => (
        <PlanView
          board={board}
          view={view}
          setView={setView}
          focus={focus}
          setFocus={setFocus}
          message={message}
          setMessage={setMessage}
          reload={retry}
        />
      )}
    </BoardStates>
  )
}
