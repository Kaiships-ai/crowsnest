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

export function StatePill({ state }: { state: SourceState }): React.ReactNode {
  return (
    <span data-testid="state-pill" data-state={state}>
      <IntegrationStatusPill tone={SOURCE_STATE[state].tone}>
        {SOURCE_STATE[state].label()}
      </IntegrationStatusPill>
    </span>
  )
}
