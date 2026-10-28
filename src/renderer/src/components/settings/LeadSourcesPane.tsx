import React, { useCallback, useEffect, useState } from 'react'
import {
  AudioLines,
  BarChart3,
  Bot,
  Camera,
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
import {
  IntegrationCardDetails,
  IntegrationCardShell,
  type IntegrationCardStatusTone
} from './integration-card-shell'
import { SourceKeyDialog } from './LeadSourceKeyDialog'
import { SidecarSourceCard } from './sidecar-source-card'
import { PolarSourceCard } from './polar-source-card'

type SourceRow = EngineCallValue<'getVaultBoard'>[number]

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
        'Your own channel and the rivals you track, pulled on request, never on a timer.'
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
  if (row.message) {
    return { text: row.message, problem: true }
  }
  switch (row.state) {
    case 'not-connected':
      return {
        text:
          row.canPull || row.missingSecretLabels.length > 0
            ? translate(
                'leadStudio.sources.explain.missing',
                'Add your {{missing}} to connect. Lead Studio pulls from it only on request, never on a timer.',
                { missing: row.missingSecretLabels.join(', ') }
              )
            : translate(
                'leadStudio.sources.explain.noAdapter',
                'Lead Studio cannot pull from this source yet. Agents record its numbers for now, and you can save the key ahead.'
              ),
        problem: false
      }
    case 'ready':
      return {
        text: row.canPull
          ? translate(
              'leadStudio.sources.explain.ready',
              'Ready. Numbers are pulled only on request, never on a timer.'
            )
          : translate('leadStudio.sources.explain.readyNoPull', 'Ready.'),
        problem: false
      }
    case 'partial':
      return {
        text: translate(
          'leadStudio.sources.explain.partial',
          'The last pull did not finish, so some numbers are older.'
        ),
        problem: true
      }
    case 'error':
      return {
        text: translate(
          'leadStudio.sources.explain.error',
          'The last check or pull failed. Check the key, then check again.'
        ),
        problem: true
      }
    case 'off':
      return { text: translate('leadStudio.sources.explain.off', 'Off.'), problem: false }
    case 'pulling':
      return { text: translate('leadStudio.sources.explain.pulling', 'Pulling now.'), problem: false }
  }
}

function pullLine(row: SourceRow): string {
  const parts = [
    row.pulledAt
      ? translate('leadStudio.sources.lastPull', 'Last pull {{time}}', {
          time: formatBoardTime(row.pulledAt)
        })
      : translate('leadStudio.sources.neverPulled', 'Never pulled')
  ]
  if (row.graphCallsLeft !== null) {
    parts.push(
      translate('leadStudio.sources.callsLeft', '{{count}} calls left this hour', {
        count: row.graphCallsLeft
      })
    )
  }
  return parts.join(' · ')
}

function pillOf(
  row: SourceRow,
  checking: boolean
): { label: string; tone: IntegrationCardStatusTone } {
  if (checking) {
    return { label: translate('leadStudio.sources.checking', 'Checking'), tone: 'neutral' }
  }
  return { label: SOURCE_STATE[row.state].label(), tone: SOURCE_STATE[row.state].tone }
}

function SourceCard({
  row,
  onEdit,
  reload
}: {
  row: SourceRow
  onEdit: () => void
  reload: () => Promise<void>
}): React.ReactNode {
  const info = infoOf(row.id)
  const learnMore = info.learnMore
  const [checking, setChecking] = useState(false)
  // A bridge call that never reached the connector records nothing, so it is shown here.
  const [callError, setCallError] = useState<string | null>(null)
  const connected = row.state !== 'not-connected'
  const { text, problem } = explanation(row)
  const pill = pillOf(row, checking)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    setCallError(null)
    const res = await window.api.crowsnest.call('testConnector', row.id)
    if (!res.ok) {
      setCallError(res.error.message)
    }
    await reload()
    setChecking(false)
  }

  return (
    <div
      data-testid="source-card"
      data-connector-id={row.id}
      data-state={checking ? 'checking' : row.state}
    >
      <IntegrationCardShell
        icon={info.icon}
        name={row.label}
        description={info.gives()}
        statusLabel={pill.label}
        statusTone={pill.tone}
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
          {row.detail || callError ? (
            <p
              data-testid="source-detail"
              className="truncate font-mono text-2xs text-muted-foreground/70"
            >
              {translate('leadStudio.sources.detail', 'Details: {{detail}}', {
                detail: callError ?? row.detail
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
              disabled={checking}
              onClick={() => void recheck()}
            >
              {checking ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {translate('leadStudio.sources.recheck', 'Re-check')}
            </Button>
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
  const reload = useCallback(async () => {
    const res = await window.api.crowsnest.call('getVaultBoard')
    if (res.ok) {
      setRows(res.value)
      setLoadError(null)
    } else {
      setLoadError(res.error.message)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

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
              {groupRows.map((row) =>
                row.id === 'ig-sidecar' ? (
                  <SidecarSourceCard key={row.id} row={row} reload={reload} />
                ) : row.id === 'polar' ? (
                  <PolarSourceCard key={row.id} row={row} reload={reload} />
                ) : (
                  <SourceCard key={row.id} row={row} onEdit={() => setEditing(row)} reload={reload} />
                )
              )}
            </div>
          </section>
        )
      })}
      <SourceKeyDialog
        row={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => void reload()}
      />
    </div>
  )
}
