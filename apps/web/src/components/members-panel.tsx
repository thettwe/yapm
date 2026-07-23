import { useQuery, useZero } from '@rocicorp/zero/react'
import { mutators, queries, WORKSPACE_ROLES, type WorkspaceRole } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Select } from '@yapm/ui/components/select'
import { useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { runMutation } from '@/lib/mutation'

interface MemberData {
  id: string
  userId: string
  role: WorkspaceRole
  user?: { name?: string; email?: string } | undefined
}

function displayName(member: MemberData): string {
  return member.user?.name ?? member.user?.email ?? member.userId
}

export function MembersPanel() {
  const { canManage, userId, memberId } = useMembership()
  const [members] = useQuery(queries.members.all())

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <h2 id="members-heading" className="font-heading text-lg font-semibold tracking-tight">
        Members
      </h2>
      <ul className="flex flex-col gap-2" data-testid="members-list">
        {members.map((member) => (
          <MemberListItem
            key={member.id}
            member={member as MemberData}
            canManage={canManage}
            isSelf={member.userId === userId}
            selfMemberId={memberId}
          />
        ))}
      </ul>
    </section>
  )
}

function MemberListItem({
  member,
  canManage,
  isSelf,
  selfMemberId,
}: {
  member: MemberData
  canManage: boolean
  isSelf: boolean
  selfMemberId: string | null
}) {
  const zero = useZero()
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function changeRole(role: WorkspaceRole) {
    if (role === member.role) return
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(mutators.member.changeRole({ id: member.id, role, updatedAt: Date.now() })),
    )
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  async function remove() {
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(zero.mutate(mutators.member.remove({ id: member.id })))
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  return (
    <li className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 truncate text-sm font-medium">
          {displayName(member)}
          {isSelf ? <span className="text-muted-foreground font-normal"> (you)</span> : null}
        </span>

        {canManage ? (
          <div className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="text-muted-foreground">
              Role
            </span>
            <Select
              aria-label={`Role for ${displayName(member)}`}
              className="w-32"
              value={member.role}
              disabled={busy}
              onChange={(event) => void changeRole(event.target.value as WorkspaceRole)}
            >
              {WORKSPACE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm capitalize">{member.role}</span>
        )}

        {canManage && !isSelf ? (
          <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
            Remove
          </Button>
        ) : null}
        {isSelf && selfMemberId ? (
          <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
            Leave
          </Button>
        ) : null}
      </div>
      {error !== undefined ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}
