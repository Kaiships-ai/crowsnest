import React from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'

export type PublishCheck = Extract<
  EngineCallValue<'getPublishChecks'>,
  { ok: true }
>['checks'][number]

const CHECK_LABEL: Record<PublishCheck['id'], () => string> = {
  video: () => translate('gate2.check.video', 'Video'),
  caption: () => translate('gate2.check.caption', 'Caption'),
  keyword: () => translate('gate2.check.keyword', 'Keyword'),
  time: () => translate('gate2.check.time', 'Time'),
  cover: () => translate('gate2.check.cover', 'Cover')
}

const ICON = { ok: Check, warn: AlertTriangle, missing: X }
const TONE = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  missing: 'text-destructive'
}

/** The five checks before a reel goes out (wireframe B6-01): a warning is yellow and does not block. */
export function PublishChecks({ checks }: { checks: PublishCheck[] }): React.ReactNode {
  return (
    <ul data-testid="publish-checks" className="flex flex-col">
      {checks.map((check) => {
        const Icon = ICON[check.status]
        return (
          <li
            key={check.id}
            data-testid="publish-check"
            data-check={check.id}
            data-status={check.status}
            className="grid grid-cols-[1rem_5rem_1fr] items-center gap-2 border-b border-border py-1.5 text-sm last:border-b-0"
          >
            <Icon className={cn('size-4', TONE[check.status])} />
            <span className="font-mono text-2xs text-muted-foreground">
              {CHECK_LABEL[check.id]()}
            </span>
            <span className={cn('min-w-0 truncate', check.status === 'warn' && TONE.warn)}>
              {check.detail}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export const coverSrc = (assetId: string): string => `cn-media://asset/${assetId}`
