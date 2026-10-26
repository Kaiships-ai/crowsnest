import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { BoardStates } from './BoardStates'
import { useBoardLoad } from './use-board-load'

const loadChannels = () => window.api.crowsnest.call('getChannelsList')

const numberFormat = new Intl.NumberFormat()

function formatCount(value: number | null): string {
  return value === null ? '-' : numberFormat.format(value)
}

export function ChannelsBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadChannels)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate('boards.channels.empty', 'No tracked channels yet.')}
    >
      {(rows) => (
        <div className="scrollbar-sleek h-full overflow-auto">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-6 border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground">
            <span>{translate('boards.channels.column', 'Channel')}</span>
            <span className="text-right">
              {translate('boards.channels.followers', 'Followers')}
            </span>
            <span className="text-right">
              {translate('boards.channels.medianViews', 'Median views')}
            </span>
            <span className="text-right">
              {translate('boards.channels.outliers30d', 'Outliers 30d')}
            </span>
            <Button
              data-testid="board-refresh"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('boards.refresh', 'Refresh')}
              onClick={retry}
            >
              <RefreshCw />
            </Button>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid="board-channels-row"
              className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-6 border-b border-border px-4 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="text-foreground">{row.handle}</span>
                {row.displayName ? (
                  <span className="ml-2 text-muted-foreground">{row.displayName}</span>
                ) : null}
              </span>
              <span className="text-right font-mono tabular-nums">
                {formatCount(row.followerCount)}
              </span>
              <span className="text-right font-mono tabular-nums">
                {formatCount(row.medianViews)}
              </span>
              <span className="text-right font-mono tabular-nums">
                {numberFormat.format(row.outliers30d)}
              </span>
              <span className="w-6" />
            </div>
          ))}
        </div>
      )}
    </BoardStates>
  )
}
