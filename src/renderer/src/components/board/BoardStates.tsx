import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { BoardLoadState } from './use-board-load'

export function BoardStates<Row>({
  state,
  retry,
  emptyMessage,
  children
}: {
  state: BoardLoadState<Row>
  retry: () => void
  emptyMessage: string
  children: (rows: Row[]) => React.ReactNode
}): React.ReactNode {
  if (state.status === 'loading') {
    return (
      <div
        data-testid="board-state-loading"
        className="flex h-full items-center justify-center text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div
        data-testid="board-state-error"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <p className="max-w-md text-sm text-destructive">{state.message}</p>
        <Button data-testid="board-retry" variant="outline" size="sm" onClick={retry}>
          {translate('boards.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  if (state.rows.length === 0) {
    return (
      <div
        data-testid="board-state-empty"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        {emptyMessage}
      </div>
    )
  }
  return children(state.rows)
}
