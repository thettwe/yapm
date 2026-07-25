import type { ConnectionState } from '@rocicorp/zero'
import { useConnectionState } from '@rocicorp/zero/react'
import {
  type RecoveryPhase,
  recoveryPlan,
  type SyncRecoveryStatus,
  useSyncRecovery,
} from '@/zero/recovery'

export interface ConnectionSummary {
  state: ConnectionState['name']
  recovery: RecoveryPhase
  label: string
  writable: boolean
  retryOffered: boolean
  detail?: string
}

// A state the recovery machine is committed to acting on reads as recovering immediately,
// before its first timer is scheduled — otherwise the pill paints a bare "Sync error" frame
// and a screen reader announces a dead end that is already being fixed.
function isRecovering(name: ConnectionState['name'], phase: RecoveryPhase): boolean {
  return phase !== 'idle' || recoveryPlan(name).kind === 'remint'
}

export function summarizeConnection(
  state: ConnectionState,
  recovery: SyncRecoveryStatus,
): ConnectionSummary {
  const recovering = isRecovering(state.name, recovery.phase)
  const shared = {
    recovery: recovery.phase,
    retryOffered: recovering && recovery.retryOffered,
  }

  switch (state.name) {
    case 'connected':
      return { ...shared, state: state.name, label: 'Connected', writable: true }
    case 'connecting':
      return {
        ...shared,
        state: state.name,
        label: recovering ? 'Reconnecting…' : 'Connecting',
        writable: true,
        ...(state.reason === undefined ? {} : { detail: state.reason }),
      }
    case 'disconnected':
      return {
        ...shared,
        state: state.name,
        label: recovering ? 'Offline — retrying' : 'Offline',
        writable: false,
        detail: state.reason,
      }
    case 'needs-auth':
      return {
        ...shared,
        state: state.name,
        label: recovering ? 'Sign-in expired — reconnecting' : 'Session expired',
        writable: false,
      }
    case 'error':
      return {
        ...shared,
        state: state.name,
        label: recovering ? 'Sync error — retrying' : 'Sync error',
        writable: false,
        detail: state.reason,
      }
    case 'closed':
      return {
        ...shared,
        state: state.name,
        label: 'Closed',
        writable: false,
        detail: state.reason,
      }
  }
}

export function useConnectionSummary(): ConnectionSummary {
  return summarizeConnection(useConnectionState(), useSyncRecovery())
}
