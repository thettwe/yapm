import type { UpdateNeededReason } from '@rocicorp/zero'
import { createContext, useContext } from 'react'

// The two conditions Zero would otherwise resolve by taking the page out from under the user
// (`location.reload()` is the client library's default for both), surfaced as product state
// instead. Distinct from an ordinary outage on purpose: `SyncRecovery` owns reconnects, this
// owns the conditions a reconnect cannot fix.
//
// `client-reset`: the server no longer knows this client (state garbage-collected or rejected);
// the client is being replaced in place and will resync. Transient — cleared when the
// replacement connects.
//
// `update-needed`: the running code can no longer (or, for `NewClientGroup`, should no longer)
// sync. Only the user resolves this, by refreshing when they choose to — never the library,
// and never while they might have a write in flight.
export type SyncConditionKind = 'none' | 'client-reset' | 'update-needed'

export type SyncCondition =
  | { kind: 'none' }
  | { kind: 'client-reset' }
  | { kind: 'update-needed'; reason: UpdateNeededReason['type'] }

export const SYNC_CONDITION_NONE: SyncCondition = { kind: 'none' }

export const SyncConditionContext = createContext<SyncCondition>(SYNC_CONDITION_NONE)

export function useSyncCondition(): SyncCondition {
  return useContext(SyncConditionContext)
}
