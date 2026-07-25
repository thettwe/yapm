import type { ConnectionState } from '@rocicorp/zero'
import { createContext, useContext } from 'react'

// Zero's own retry keeps running while `disconnected`, so a brief dip must not generate
// token traffic; only a dip that outlasts the grace gets a fresh credential.
export const DISCONNECTED_GRACE_MS = 20_000

// Offer the manual escape hatch once waiting stops feeling like a hiccup.
export const RETRY_OFFER_AFTER_MS = 15_000

export type RecoveryPhase = 'idle' | 'retrying' | 'waiting'

export type RecoveryPlan =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'remint'; reconnect: boolean; graceMs: number }

// `connect()` does not reconnect from `disconnected` or `closed` (verified against the
// installed 1.8.0 `Connection` contract), so `disconnected` gets a re-mint only — Zero's
// own 5s retry then presents the fresh credential. Calling `connect()` there would be a
// silent no-op that looks like recovery.
export function recoveryPlan(name: ConnectionState['name']): RecoveryPlan {
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
      return { kind: 'remint', reconnect: false, graceMs: DISCONNECTED_GRACE_MS }
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
