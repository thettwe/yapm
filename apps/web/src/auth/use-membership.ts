import { useQuery } from '@rocicorp/zero/react'
import { queries, type WorkspaceRole } from '@yapm/schema'
import { useSyncSession } from '@/zero/provider'

export interface Membership {
  userId: string | null
  memberId: string | null
  role: WorkspaceRole | null
  isMember: boolean
  canWrite: boolean
  canManage: boolean
}

// The server resolves the caller's authoritative role when minting the sync token; the
// synced roster then reflects live role changes. Role prefers the roster (immediate) and
// falls back to the token role until the roster settles. `memberId` (needed to leave) comes
// only from the roster.
export function useMembership(): Membership {
  const sync = useSyncSession()
  const [members] = useQuery(queries.members.all())

  const me = sync.userID ? members.find((member) => member.userId === sync.userID) : undefined
  const role = me?.role ?? sync.role

  return {
    userId: sync.userID,
    memberId: me?.id ?? null,
    role,
    isMember: role !== null,
    canWrite: role !== null && role !== 'viewer',
    canManage: role === 'admin',
  }
}
