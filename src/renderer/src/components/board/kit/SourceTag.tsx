import React from 'react'
import { translate } from '@/i18n/i18n'
import { formatBoardTime } from '../board-time'

/** Where a block's numbers come from and when they were pulled, named once per block. */
export function SourceTag({
  sources,
  at,
  live = false
}: {
  sources: string[]
  at?: string | null
  live?: boolean
}): React.ReactNode {
  const parts = [...sources]
  if (live) {
    parts.push(translate('boards.kit.live', 'live'))
  } else if (at) {
    parts.push(translate('boards.kit.pulledAt', 'pulled {{time}}', { time: formatBoardTime(at) }))
  }
  return (
    <span data-testid="source-tag" className="font-mono text-2xs text-muted-foreground">
      {parts.join(' · ')}
    </span>
  )
}

export function BlockHeader({
  title,
  children
}: {
  title: string
  children?: React.ReactNode
}): React.ReactNode {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  )
}
