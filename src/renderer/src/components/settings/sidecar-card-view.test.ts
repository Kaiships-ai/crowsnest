import { describe, expect, it } from 'vitest'
import { viewOf, type Health, type SourceRow } from './sidecar-card-view'

const idle = { starting: false, testing: false, form: false }
const loggedOut: Health = { running: true, loggedIn: false, username: null }
const loggedIn: Health = { running: true, loggedIn: true, username: 'fake_sidecar' }

function row(patch: Partial<SourceRow>): SourceRow {
  // SAFETY: viewOf reads only state, retryAfter, pulledAt, checkedAt and summary.
  return {
    state: 'ready',
    retryAfter: null,
    pulledAt: null,
    checkedAt: null,
    summary: {},
    ...patch
  } as SourceRow
}

describe('viewOf', () => {
  it('reads Not connected when the sidecar has no session, over an older pull error', () => {
    expect(viewOf(row({ state: 'error' }), loggedOut, idle)).toBe('not-connected')
  })

  it('keeps a pull error while the sidecar has a session', () => {
    expect(viewOf(row({ state: 'error' }), loggedIn, idle)).toBe('error')
  })

  it('keeps Off above Not connected', () => {
    expect(viewOf(row({ state: 'off' }), loggedOut, idle)).toBe('off')
  })
})
