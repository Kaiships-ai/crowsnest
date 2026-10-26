import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  AudioLines,
  BarChart3,
  Bot,
  Camera,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  Plug
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from '../board/board-time'
import { SOURCE_STATE } from '../board/kit/StatePill'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { SourceKeyDialog } from './LeadSourceKeyDialog'

type SourceRow = EngineCallValue<'getVaultBoard'>[number]
type Check = { ok: boolean; message: string | null }

type SourceInfo = {
  group: 'instagram' | 'funnel' | 'tools'
  icon: React.ReactNode
  gives: () => string
  learnMore?: string
}

const SOURCE_INFO: Record<string, SourceInfo> = {
  'instagram-graph': {
    group: 'instagram',
    icon: <Camera className="size-5" />,
    gives: () =>
      translate('leadStudio.sources.gives.graph', 'Your reels, views, follows and link taps.'),
    learnMore: 'https://developers.facebook.com/docs/instagram-platform'
  },
  'ig-sidecar': {
    group: 'instagram',
    icon: <Camera className="size-5" />,
    gives: () =>
      translate('leadStudio.sources.gives.sidecar', "Rivals' public reels for the Rivals board.")
  },
  chatbotx: {
    group: 'funnel',
    icon: <Bot className="size-5" />,
    gives: () => translate('leadStudio.sources.gives.chatbotx', 'Keyword comments and gift DMs.')
  },
  umami: {
    group: 'funnel',
    icon: <BarChart3 className="size-5" />,
    gives: () =>
      translate('leadStudio.sources.gives.umami', 'Gift page visits and email signups per reel.'),
    learnMore: 'https://umami.is/docs/api'
  },
  polar: {
    group: 'funnel',
    icon: <CreditCard className="size-5" />,
    gives: () => translate('leadStudio.sources.gives.polar', 'Checkouts and orders per reel.'),
    learnMore: 'https://docs.polar.sh/api-reference/introduction'
  },
  groq: {
    group: 'tools',
    icon: <AudioLines className="size-5" />,
    gives: () =>
      translate('leadStudio.sources.gives.groq', 'Transcripts of reels for the agents to read.'),
    learnMore: 'https://console.groq.com/docs/quickstart'
  }
}

const FALLBACK_INFO: SourceInfo = {
  group: 'tools',
  icon: <Plug className="size-5" />,
  gives: () => ''
}

const GROUPS: { id: SourceInfo['group']; title: () => string; description: () => string }[] = [
  {
    id: 'instagram',
    title: () => translate('leadStudio.sources.group.instagram', 'Instagram'),
    description: () =>
      translate(
        'leadStudio.sources.group.instagramDescription',
        'Your own channel and the rivals you track, pulled at 05:00 every day.'
      )
  },
  {
    id: 'funnel',
    title: () => translate('leadStudio.sources.group.funnel', 'Funnel'),
    description: () =>
      translate(
        'leadStudio.sources.group.funnelDescription',
        'What happens after a view: comments, DMs, gift page visits and orders.'
      )
  },
  {
    id: 'tools',
    title: () => translate('leadStudio.sources.group.tools', 'Tools'),
    description: () =>
      translate(
        'leadStudio.sources.group.toolsDescription',
        'Services the agents use while they work.'
      )
  }
]

const infoOf = (id: string): SourceInfo => SOURCE_INFO[id] ?? FALLBACK_INFO

function explanation(row: SourceRow): { text: string; problem: boolean } {
  const missing = row.missingSecretLabels.join(', ')
  switch (row.state) {
    case 'not-connected':
      return row.canPull || row.missingSecretLabels.length > 0
        ? {
            text: translate(
              'leadStudio.sources.explain.missing',
              'Add your {{missing}} to connect. Lead Studio pulls from it at 05:00 every day.',
              { missing }
            ),
            problem: false
          }
        : {
            text: translate(
              'leadStudio.sources.explain.noAdapter',
              'Lead Studio cannot pull from this source yet. Agents record its numbers for now, and you can save the key ahead.'
            ),
            problem: false
          }
    case 'error':
      return {
        text: translate(
          'leadStudio.sources.explain.error',
          'The last pull failed, so the older numbers stay. Check the key, then pull again.'
        ),
        problem: true
      }
    case 'partial':
      return {
        text: translate(
          'leadStudio.sources.explain.partial',
          'The last pull did not finish, so the older numbers stay. Pull again later.'
        ),
        problem: true
      }
    case 'stale':
      return {
        text: row.lastPull
          ? translate(
              'leadStudio.sources.explain.stale',
              'No complete pull since 05:00 today. Pull again, or wait for the next one.'
            )
          : translate(
              'leadStudio.sources.explain.never',
              'Not pulled yet. Pull now, or wait for 05:00.'
            ),
        problem: false
      }
    case 'running':
      return {
        text: translate('leadStudio.sources.explain.running', 'Pulled today. Numbers are current.'),
        problem: false
      }
  }
}

function pullLine(row: SourceRow): string {
  const parts = [
    row.lastPull
      ? translate('leadStudio.sources.lastPull', 'Last pull {{time}}', {
          time: formatBoardTime(row.lastPull.at)
        })
      : translate('leadStudio.sources.neverPulled', 'Never pulled')
  ]
  if (row.canPull) {
    parts.push(
      translate('leadStudio.sources.nextPull', 'next {{time}}', {
        time: formatBoardTime(row.nextPullAt)
      })
    )
  }
  if (row.graphCallsLeft !== null) {
    parts.push(
      translate('leadStudio.sources.callsLeft', '{{count}} calls left this hour', {
        count: row.graphCallsLeft
      })
    )
  }
  return parts.join(' · ')
}

function SourceCard({
  row,
  onEdit,
  reload
}: {
  row: SourceRow
  onEdit: () => void
  reload: () => void
}): React.ReactNode {
  const info = infoOf(row.id)
  const learnMore = info.learnMore
  const [busy, setBusy] = useState<'check' | 'pull' | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const connected = row.state !== 'not-connected'
  const { text, problem } = explanation(row)

  const recheck = async (): Promise<void> => {
    setBusy('check')
    setCheck(null)
    const res = await window.api.crowsnest.call('testConnector', row.id)
    setBusy(null)
    setCheck(res.ok ? res.value : { ok: false, message: res.error.message })
  }
  const pull = async (): Promise<void> => {
    setBusy('pull')
    const res = await window.api.crowsnest.call('pullAgain', row.id)
    setBusy(null)
    if (!res.ok) {
      setCheck({ ok: false, message: res.error.message })
    }
    reload()
  }

  return (
    <div data-testid="source-card" data-connector-id={row.id} data-state={row.state}>
      <IntegrationCardShell
        icon={info.icon}
        name={row.label}
        description={info.gives()}
        statusLabel={SOURCE_STATE[row.state].label()}
        statusTone={SOURCE_STATE[row.state].tone}
        actions={
          <Button
            data-testid="source-primary"
            variant={connected ? 'outline' : 'default'}
            size="sm"
            onClick={onEdit}
          >
            {connected
              ? translate('leadStudio.sources.editKey', 'Edit key')
              : translate('leadStudio.sources.connect', 'Connect')}
          </Button>
        }
      >
        <IntegrationCardDetails>
          <p
            data-testid="source-explanation"
            className={problem ? 'text-xs text-foreground' : 'text-xs text-muted-foreground'}
          >
            {text}
          </p>
          {connected ? (
            <p data-testid="source-pulls" className="font-mono text-2xs text-muted-foreground">
              {pullLine(row)}
            </p>
          ) : null}
          {problem && row.lastPull?.detail ? (
            <p className="truncate font-mono text-2xs text-muted-foreground/70">
              {translate('leadStudio.sources.detail', 'Details: {{detail}}', {
                detail: row.lastPull.detail
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {learnMore ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.api.shell.openUrl(learnMore)}
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                {translate('leadStudio.sources.learnMore', 'Learn more')}
              </Button>
            ) : null}
            <Button
              data-testid="source-recheck"
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void recheck()}
            >
              {busy === 'check' ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {translate('leadStudio.sources.recheck', 'Re-check')}
            </Button>
            {connected && row.canPull ? (
              <Button
                data-testid="source-pull"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void pull()}
              >
                {busy === 'pull' ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {translate('leadStudio.sources.pullAgain', 'Pull again')}
              </Button>
            ) : null}
            {check?.ok ? (
              <span className="flex items-center gap-1 text-xs text-status-success">
                <CheckCircle2 className="size-3.5" />
                {translate('leadStudio.sources.verified', 'Verified')}
              </span>
            ) : null}
            {check && !check.ok ? (
              <span className="flex min-w-0 items-center gap-1 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                <span className="truncate">
                  {check.message ?? translate('leadStudio.sources.checkFailed', 'Check failed')}
                </span>
              </span>
            ) : null}
          </div>
        </IntegrationCardDetails>
      </IntegrationCardShell>
    </div>
  )
}

/** Settings > Sources: Lead Studio's connectors, laid out like Orca's Integrations pane. */
export function LeadSourcesPane(): React.JSX.Element {
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SourceRow | null>(null)
  const reload = useCallback(() => {
    void window.api.crowsnest.call('getVaultBoard').then((res) => {
      if (res.ok) {
        setRows(res.value)
        setLoadError(null)
      } else {
        setLoadError(res.error.message)
      }
    })
  }, [])
  useEffect(reload, [reload])

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>
  }
  if (!rows) {
    return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
  }
  return (
    <div data-testid="lead-sources" className="space-y-5">
      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => infoOf(row.id).group === group.id)
        if (groupRows.length === 0) {
          return null
        }
        return (
          <section key={group.id} data-testid="source-group" className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">{group.title()}</h3>
              <p className="text-xs text-muted-foreground">{group.description()}</p>
            </div>
            <div className="space-y-3">
              {groupRows.map((row) => (
                <SourceCard key={row.id} row={row} onEdit={() => setEditing(row)} reload={reload} />
              ))}
            </div>
          </section>
        )
      })}
      <SourceKeyDialog
        row={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={reload}
      />
    </div>
  )
}
