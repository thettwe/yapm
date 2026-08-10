import type { ConnectionState } from '@rocicorp/zero'
import { useConnectionState } from '@rocicorp/zero/react'
import {
  SYNC_CONDITION_NONE,
  type SyncCondition,
  type SyncConditionKind,
  useSyncCondition,
} from '@/zero/condition'
import {
  type RecoveryPhase,
  recoveryPlan,
  type SyncRecoveryStatus,
  useSyncRecovery,
} from '@/zero/recovery'

export interface ConnectionSummary {
  state: ConnectionState['name']
  recovery: RecoveryPhase
  // A condition is not an outage: `client-reset` is the client being replaced on purpose, and
  // `update-needed` is one only the user's own refresh can end. The indicator renders each
  // distinctly from a disconnection.
  condition: SyncConditionKind
  label: string
  writable: boolean
  retryOffered: boolean
  // Offered instead of retry when only a refresh can resolve the state; taking it is always the
  // user's act, never the library's.
  refreshOffered: boolean
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
  condition: SyncCondition = SYNC_CONDITION_NONE,
): ConnectionSummary {
  const base = baseSummary(state, recovery, condition)

  // A condition OVERLAYS the socket's own story, it does not replace it: a condition is sticky
  // (`update-needed` only clears on the user's refresh), so letting it override the state outright
  // would report "New version available" — writable, no retry — straight through a genuine outage.
  if (condition.kind === 'client-reset') {
    // The wait is deliberate, not a fault: no outage label, and no retry — a retry cannot end a
    // replacement that is already underway.
    return { ...base, label: 'Restoring local data', writable: false, retryOffered: false }
  }
  if (condition.kind === 'update-needed') {
    const socketUp = state.name === 'connected' || state.name === 'connecting'
    // `NewClientGroup`: another tab already runs newer code; this tab still syncs, so the base
    // summary stands — writes, outage labels and the retry affordance included — and only the
    // healthy "Synced" is upgraded to the nudge. The other two reasons mean this tab cannot sync
    // at all: writes are refused everywhere, but an independent outage keeps its own label and
    // retry, because ending the outage is still worth offering even though only a refresh ends
    // the condition. `data-sync-condition` keeps the rendering distinct throughout.
    if (condition.reason === 'NewClientGroup') {
      return {
        ...base,
        refreshOffered: true,
        ...(state.name === 'connected'
          ? { label: 'New version available', detail: condition.reason }
          : {}),
      }
    }
    return {
      ...base,
      writable: false,
      refreshOffered: true,
      ...(socketUp
        ? { label: 'Update required', retryOffered: false, detail: condition.reason }
        : {}),
    }
  }

  return base
}

function baseSummary(
  state: ConnectionState,
  recovery: SyncRecoveryStatus,
  condition: SyncCondition,
): ConnectionSummary {
  const recovering = isRecovering(state.name, recovery.phase)
  const shared = {
    recovery: recovery.phase,
    condition: condition.kind,
    retryOffered: recovering && recovery.retryOffered,
    refreshOffered: false,
  }

  switch (state.name) {
    // The healthy label names what the reader HAS, not what the socket is doing. Every other case
    // below keeps naming its own condition, because "Synced" would be a lie in all of them.
    case 'connected':
      return { ...shared, state: state.name, label: 'Synced', writable: true }
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
  return summarizeConnection(useConnectionState(), useSyncRecovery(), useSyncCondition())
}
