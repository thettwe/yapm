import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { mutators, newId, queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@yapm/ui/components/dialog'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { PlusIcon } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { TeamMembershipButton } from '@/components/team-membership-button'
import { runMutation } from '@/lib/mutation'

export function TeamsPanel() {
  const { canManage } = useMembership()
  const [teams] = useQuery(queries.teams.all())

  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="teams-heading" className="font-heading text-lg font-semibold tracking-tight">
          Teams
        </h2>
        {canManage ? <CreateTeamDialog /> : null}
      </div>
      {teams.length === 0 ? (
        <p className="text-muted-foreground text-sm">No teams yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="teams-list">
          {teams.map((team) => (
            <li
              key={team.id}
              className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <Link
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                className="flex-1 truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {team.name}
                <span className="text-muted-foreground font-normal"> · {team.key}</span>
              </Link>
              <span className="text-muted-foreground text-sm">
                {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
              </span>
              <TeamMembershipButton teamId={team.id} memberships={team.members} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CreateTeamDialog() {
  const zero = useZero()
  const [workspace] = useQuery(queries.workspace.current())
  const nameId = useId()
  const keyId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function reset() {
    setName('')
    setKey('')
    setError(undefined)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!workspace) {
      setError('Workspace is still loading.')
      return
    }
    setError(undefined)
    setBusy(true)
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(
        mutators.team.create({
          id: newId(),
          workspaceId: workspace.id,
          name,
          key,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    reset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" data-testid="create-team">
            <PlusIcon />
            New team
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>Create a team</DialogTitle>
        <DialogDescription>
          Teams group work and their members. The key is a short uppercase identifier.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              required
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={keyId}>Key</Label>
            <Input
              id={keyId}
              value={key}
              required
              autoComplete="off"
              placeholder="ENG"
              onChange={(event) => setKey(event.target.value.toUpperCase())}
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
              Create team
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
