import React from 'react'
import {
  IntegrationStatusPill,
  type IntegrationStatusTone
} from '@/components/integration-status-pill'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../../preload/api/crowsnest-api'

export type SourceState = EngineCallValue<'getVaultBoard'>[number]['state']

/** Orca's Integrations tones and words for a source's state. */
export const SOURCE_STATE: Record<
  SourceState,
  { tone: IntegrationStatusTone; label: () => string }
> = {
  running: { tone: 'connected', label: () => translate('boards.kit.state.connected', 'Connected') },
  stale: { tone: 'connected', label: () => translate('boards.kit.state.connected', 'Connected') },
  partial: { tone: 'attention', label: () => translate('boards.kit.state.partial', 'Partial') },
  error: { tone: 'attention', label: () => translate('boards.kit.state.error', 'Error') },
  'not-connected': {
    tone: 'attention',
    label: () => translate('boards.kit.state.notConfigured', 'Not configured')
  }
}

/** A source's state, or any other state given its own tone and words. */
export function StatePill(
  props: { state: SourceState } | { state: string; tone: IntegrationStatusTone; label: string }
): React.ReactNode {
  const { tone, label } =
    'tone' in props
      ? props
      : { tone: SOURCE_STATE[props.state].tone, label: SOURCE_STATE[props.state].label() }
  return (
    <span data-testid="state-pill" data-state={props.state}>
      <IntegrationStatusPill tone={tone}>{label}</IntegrationStatusPill>
    </span>
  )
}
