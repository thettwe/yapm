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

test('a client reset overrides the outage story: the wait is deliberate, not a fault', () => {
  for (const state of STATES) {
    const summary = summarizeConnection(state, RECOVERY_IDLE, { kind: 'client-reset' })
    expect(summary.condition).toBe('client-reset')
    expect(summary.label).toBe('Restoring local data')
    expect(summary.writable).toBe(false)
    expect(summary.refreshOffered).toBe(false)
  }
})

test('update-needed surfaces to the user and offers a refresh, never a retry', () => {
  const required = summarizeConnection({ name: 'error', reason: 'x' }, recovery('waiting', true), {
    kind: 'update-needed',
    reason: 'VersionNotSupported',
  })
  expect(required.condition).toBe('update-needed')
  expect(required.label).toBe('Update required')
  expect(required.writable).toBe(false)
  expect(required.refreshOffered).toBe(true)
  expect(required.retryOffered).toBe(false)
  expect(required.detail).toBe('VersionNotSupported')

  // Another tab moved first; this tab still syncs, so writes stay accepted.
  const newGroup = summarizeConnection({ name: 'connected' }, RECOVERY_IDLE, {
    kind: 'update-needed',
    reason: 'NewClientGroup',
  })
  expect(newGroup.label).toBe('New version available')
  expect(newGroup.writable).toBe(true)
  expect(newGroup.refreshOffered).toBe(true)
})

test('no condition leaves every summary exactly as the socket tells it', () => {
  for (const state of STATES) {
    const bare = summarizeConnection(state, RECOVERY_IDLE)
    expect(bare.condition).toBe('none')
    expect(bare.refreshOffered).toBe(false)
  }
})
