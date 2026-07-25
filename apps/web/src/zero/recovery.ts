import type { ConnectionState } from '@rocicorp/zero'
import { createContext, useContext } from 'react'

// Zero's own retry keeps running while `disconnected`, so a brief dip must not generate
// token traffic; only a dip that outlasts the grace gets a fresh credential.
export const DISCONNECTED_GRACE_MS = 20_000

// Offer the manual escape hatch once waiting stops feeling like a hiccup.
export const RETRY_OFFER_AFTER_MS = 15_000

// Zero reports `connected` the moment the socket opens, which is *before* zero-cache runs
// the `/query` round trip that validates the credential. A connection that then fails
// validation therefore passes through `connected` on its way back to `needs-auth`, so
// treating arrival at `connected` as recovery clears the attempt counter on every failed
// cycle and pins the backoff at its first step — measured at ~75 re-mints in 45s against a
// live stack. Only a connection that holds this long counts as recovered. The failed cycle
// measures ~600ms end to end, so this sits well clear of it.
export const CONNECTION_SETTLED_MS = 3_000

export type RecoveryPhase = 'idle' | 'retrying' | 'waiting'

export type RecoveryPlan =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'remint'; reconnect: boolean; graceMs: number }

// Conditions outside Zero's own state that change what a state means.
export interface RecoveryConditions {
  // Zero disconnects a backgrounded tab on purpose — `hiddenTabDisconnectDelay` defaults to
  // 5 minutes (1.8.0 `zero-client/src/client/zero.ts`), after which its run loop parks on
  // `waitForVisible()` and stops redialling. That `disconnected` is not a fault, and
  // re-minting against it turns every backgrounded tab into a permanent token poll.
  hidden: boolean
}

const VISIBLE: RecoveryConditions = { hidden: false }

// `connect()` does not reconnect from `disconnected` or `closed` (verified against the
// installed 1.8.0 `Connection` contract), so `disconnected` gets a re-mint only — Zero's
// own 5s retry then presents the fresh credential. Calling `connect()` there would be a
// silent no-op that looks like recovery.
export function recoveryPlan(
  name: ConnectionState['name'],
  { hidden }: RecoveryConditions = VISIBLE,
): RecoveryPlan {
  switch (name) {
    case 'connected':
      return { kind: 'reset' }
    case 'connecting':
    case 'closed':
      return { kind: 'none' }
    case 'needs-auth':
    case 'error':
      return { kind: 'remint', reconnect: true, graceMs: 0 }
    case 'disconnected':
      // Nothing to recover while hidden: Zero will not redial until the tab is visible, and
      // the wake path re-checks the credential's age then anyway.
      return hidden
        ? { kind: 'none' }
        : { kind: 'remint', reconnect: false, graceMs: DISCONNECTED_GRACE_MS }
  }
}

export interface SyncRecoveryStatus {
  phase: RecoveryPhase
  attempt: number
  delayMs: number
  retryOffered: boolean
}

export interface SyncRecoveryValue extends SyncRecoveryStatus {
  retryNow: () => void
}

export const RECOVERY_IDLE: SyncRecoveryStatus = {
  phase: 'idle',
  attempt: 0,
  delayMs: 0,
  retryOffered: false,
}

export const SyncRecoveryContext = createContext<SyncRecoveryValue>({
  ...RECOVERY_IDLE,
  retryNow: () => {},
})

export function useSyncRecovery(): SyncRecoveryValue {
  return useContext(SyncRecoveryContext)
}
