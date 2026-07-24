import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { mutators, newId, queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@yapm/ui/components/dialog'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { type FormEvent, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { TeamMembershipButton } from '@/components/team-membership-button'
import { runMutation } from '@/lib/mutation'

interface Membership {
  id: string
  userId: string
}

export function TeamDetail({ teamId }: { teamId: string }) {
  const { canManage, userId } = useMembership()
  const [teams, teamsResult] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())

  const team = teams.find((candidate) => candidate.id === teamId)

  if (!team) {
    return (
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm" role="status">
          {teamsResult.type === 'complete' ? 'This team no longer exists.' : 'Loading team…'}
        </p>
      </section>
    )
  }

  const nameFor = (id: string): string => {
    const user = users.find((candidate) => candidate.id === id)
    return user?.name ?? user?.email ?? id
  }

  const memberships = team.members as readonly Membership[]
  const onTeam = new Set(memberships.map((row) => row.userId))
  const eligible = users.filter((user) => !onTeam.has(user.id))

  return (
    <section aria-labelledby="team-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="team-heading" className="font-heading flex-1 text-lg font-semibold tracking-tight">
          {team.name}
          <span className="text-muted-foreground font-normal"> · {team.key}</span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link to="/teams/$teamId/issues" params={{ teamId: team.id }}>
              Issues
            </Link>
          }
        />
        <TeamMembershipButton teamId={team.id} memberships={memberships} />
        {canManage ? (
          <>
            <RenameTeamDialog teamId={team.id} currentName={team.name} />
            <ArchiveTeamButton teamId={team.id} />
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Roster</h3>
        {memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members on this team yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="team-roster">
            {memberships.map((membership) => (
              <RosterRow
                key={membership.id}
                membership={membership}
                name={nameFor(membership.userId)}
                canManage={canManage}
                isSelf={membership.userId === userId}
              />
            ))}
          </ul>
        )}
      </div>

      {canManage && eligible.length > 0 ? (
        <AddMemberControl
          teamId={team.id}
          options={eligible.map((user) => ({
            id: user.id,
            label: user.name ?? user.email ?? user.id,
          }))}
        />
      ) : null}
    </section>
  )
}

function RosterRow({
  membership,
  name,
  canManage,
  isSelf,
}: {
  membership: Membership
  name: string
  canManage: boolean
  isSelf: boolean
}) {
  const zero = useZero()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function remove() {
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(mutators.team.removeMember({ id: membership.id })),
    )
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  return (
    <li className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span className="flex-1 truncate text-sm font-medium">
        {name}
        {isSelf ? <span className="text-muted-foreground font-normal"> (you)</span> : null}
      </span>
      {canManage || isSelf ? (
        <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
          Remove
        </Button>
      ) : null}
      {error !== undefined ? (
        <span className="text-destructive w-full text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  )
}

function AddMemberControl({
  teamId,
  options,
}: {
  teamId: string
  options: { id: string; label: string }[]
}) {
  const zero = useZero()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function add() {
    if (selected === '' || busy) return
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(
        mutators.team.addMember({
          id: newId(),
          teamId,
          userId: selected,
          createdAt: Date.now(),
        }),
      ),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setSelected('')
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Add a member</h3>
      <div className="flex items-end gap-2">
        <Select
          aria-label="Member to add"
          className="flex-1"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select a member…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button onClick={add} disabled={busy || selected === ''}>
          Add
        </Button>
      </div>
      {error !== undefined ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function RenameTeamDialog({ teamId, currentName }: { teamId: string; currentName: string }) {
  const zero = useZero()
  const nameId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(mutators.team.rename({ id: teamId, name, updatedAt: Date.now() })),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setName(currentName)
        setError(undefined)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Rename
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>Rename team</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error !== undefined ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveTeamButton({ teamId }: { teamId: string }) {
  const zero = useZero()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function archive() {
    setError(undefined)
    setBusy(true)
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(mutators.team.archive({ id: teamId, archivedAt: now, updatedAt: now })),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    await navigate({ to: '/' })
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button variant="destructive" size="sm" onClick={archive} disabled={busy}>
        Archive
      </Button>
      {error !== undefined ? (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
