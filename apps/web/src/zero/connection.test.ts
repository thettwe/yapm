import type { ConnectionState } from '@rocicorp/zero'
import { expect, test } from 'vitest'
import { summarizeConnection } from './connection'
import { RECOVERY_IDLE, type RecoveryPhase, type SyncRecoveryStatus } from './recovery'

function recovery(phase: RecoveryPhase, retryOffered = false): SyncRecoveryStatus {
  return { ...RECOVERY_IDLE, phase, retryOffered }
}

const STATES: ConnectionState[] = [
  { name: 'connected' },
  { name: 'connecting' },
  { name: 'disconnected', reason: 'socket closed' },
  { name: 'needs-auth', reason: { type: 'query', status: 401 } },
  { name: 'error', reason: 'InvalidConnectionRequest' },
  { name: 'closed', reason: 'closed by app' },
]

test('a live connection is writable and says so', () => {
  expect(summarizeConnection({ name: 'connected' }, RECOVERY_IDLE)).toMatchObject({
    state: 'connected',
    recovery: 'idle',
    label: 'Synced',
    writable: true,
    retryOffered: false,
  })
})

// The label names what the reader HAS, not what the socket is doing — every mock draws band 3's
// right end as `● Synced`. The `data-connection` attribute the e2e suite reads is the STATE name,
// which is why fifteen specs did not have to move for this.
test('only the healthy state says Synced; every other state names its own condition', () => {
  expect(summarizeConnection({ name: 'connected' }, RECOVERY_IDLE).label).toBe('Synced')
  for (const state of STATES.filter((s) => s.name !== 'connected')) {
    for (const phase of ['idle', 'retrying', 'waiting'] as const) {
      expect(summarizeConnection(state, recovery(phase)).label, state.name).not.toContain('Synced')
    }
  }
})

test('the first connect reads as connecting; a recovery attempt reads as reconnecting', () => {
  expect(summarizeConnection({ name: 'connecting' }, RECOVERY_IDLE).label).toBe('Connecting')
  expect(summarizeConnection({ name: 'connecting' }, recovery('retrying')).label).toBe(
    'Reconnecting…',
  )
  expect(summarizeConnection({ name: 'connecting' }, recovery('waiting')).label).toBe(
    'Reconnecting…',
  )
})

test('writes stay queued while connecting and are refused once the socket is gone', () => {
  expect(summarizeConnection({ name: 'connecting' }, RECOVERY_IDLE).writable).toBe(true)
  for (const state of STATES.filter((s) => s.name !== 'connected' && s.name !== 'connecting')) {
    expect(summarizeConnection(state, RECOVERY_IDLE).writable).toBe(false)
  }
})

test('a broken state reads as recovering before the first retry timer is even scheduled', () => {
  expect(summarizeConnection({ name: 'error', reason: 'boom' }, RECOVERY_IDLE).label).toBe(
    'Sync error — retrying',
  )
  expect(
    summarizeConnection(
      { name: 'needs-auth', reason: { type: 'query', status: 401 } },
      RECOVERY_IDLE,
    ).label,
  ).toBe('Sign-in expired — reconnecting')
  expect(summarizeConnection({ name: 'disconnected', reason: 'idle' }, RECOVERY_IDLE).label).toBe(
    'Offline — retrying',
  )
})

test('a closed client is not presented as recovering', () => {
  const summary = summarizeConnection({ name: 'closed', reason: 'bye' }, RECOVERY_IDLE)
  expect(summary.label).toBe('Closed')
  expect(summary.retryOffered).toBe(false)
})

test('the recovery phase is carried through for the test hook and the pill', () => {
  for (const phase of ['idle', 'retrying', 'waiting'] as const) {
    expect(summarizeConnection({ name: 'error', reason: 'x' }, recovery(phase)).recovery).toBe(
      phase,
    )
  }
})

test('the manual retry is offered only while recovering', () => {
  expect(
    summarizeConnection({ name: 'error', reason: 'x' }, recovery('waiting', true)).retryOffered,
  ).toBe(true)
  expect(summarizeConnection({ name: 'connected' }, recovery('idle', true)).retryOffered).toBe(
    false,
  )
})

test('the failure reason is carried as detail for assistive tech', () => {
  expect(summarizeConnection({ name: 'error', reason: 'boom' }, RECOVERY_IDLE).detail).toBe('boom')
  expect(
    summarizeConnection({ name: 'disconnected', reason: 'socket closed' }, RECOVERY_IDLE).detail,
  ).toBe('socket closed')
  expect(summarizeConnection({ name: 'connecting' }, RECOVERY_IDLE).detail).toBeUndefined()
})

test('every Zero state times every recovery phase produces a usable summary', () => {
  for (const state of STATES) {
    for (const phase of ['idle', 'retrying', 'waiting'] as const) {
      const summary = summarizeConnection(state, recovery(phase))
      expect(summary.state).toBe(state.name)
      expect(summary.label.length).toBeGreaterThan(0)
      expect(typeof summary.writable).toBe('boolean')
      expect(['idle', 'retrying', 'waiting']).toContain(summary.recovery)
    }
  }
})
