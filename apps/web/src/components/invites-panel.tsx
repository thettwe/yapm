import { useQuery, useZero } from '@rocicorp/zero/react'
import { mutators, newId, queries, WORKSPACE_ROLES, type WorkspaceRole } from '@yapm/schema'
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
import { Select } from '@yapm/ui/components/select'
import { CheckIcon, CopyIcon, PlusIcon } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { runMutation } from '@/lib/mutation'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface InviteRow {
  id: string
  token: string
  role: WorkspaceRole
  email?: string | undefined
  teamId?: string | undefined
  expiresAt: number
  revokedAt?: number | undefined
}

function inviteLink(token: string): string {
  return `${window.location.origin}/invite?token=${encodeURIComponent(token)}`
}

function inviteStatus(invite: InviteRow, now: number): 'revoked' | 'expired' | 'active' {
  if (invite.revokedAt != null) return 'revoked'
  if (invite.expiresAt < now) return 'expired'
  return 'active'
}

export function InvitesPanel() {
  const [invites] = useQuery(queries.invites.all())
  const now = Date.now()

  return (
    <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="invites-heading" className="font-heading text-lg font-semibold tracking-tight">
          Invitations
        </h2>
        <CreateInviteDialog />
      </div>
      {invites.length === 0 ? (
        <p className="text-muted-foreground text-sm">No invitations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="invites-list">
          {invites.map((invite) => (
            <InviteListItem
              key={invite.id}
              invite={invite as InviteRow}
              status={inviteStatus(invite as InviteRow, now)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function InviteListItem({ invite, status }: { invite: InviteRow; status: string }) {
  const zero = useZero()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink(invite.token))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link. Copy it manually from the address bar.')
    }
  }

  async function revoke() {
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(mutators.invite.revoke({ id: invite.id, revokedAt: Date.now() })),
    )
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  return (
    <li className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 truncate text-sm font-medium">
          {invite.email ?? 'Shareable link'}
          <span className="text-muted-foreground font-normal"> · {invite.role}</span>
        </span>
        <span
          className="text-muted-foreground text-xs capitalize"
          data-testid="invite-status"
          data-status={status}
        >
          {status}
        </span>
        {status === 'active' ? (
          <>
            <Button variant="outline" size="sm" onClick={copy} aria-label="Copy invite link">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
              Revoke
            </Button>
          </>
        ) : null}
      </div>
      {status === 'active' ? (
        <input
          readOnly
          data-testid="invite-link"
          aria-label="Invite link"
          className="border-input bg-muted text-muted-foreground w-full truncate rounded-md border px-2 py-1 text-xs"
          value={inviteLink(invite.token)}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {error !== undefined ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}

function CreateInviteDialog() {
  const zero = useZero()
  const [workspace] = useQuery(queries.workspace.current())
  const [teams] = useQuery(queries.teams.all())
  const roleId = useId()
  const emailId = useId()
  const teamId = useId()

  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [email, setEmail] = useState('')
  const [team, setTeam] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function reset() {
    setRole('member')
    setEmail('')
    setTeam('')
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
    const trimmedEmail = email.trim()
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(
        mutators.invite.create({
          id: newId(),
          workspaceId: workspace.id,
          token: crypto.randomUUID(),
          role,
          ...(trimmedEmail === '' ? {} : { email: trimmedEmail }),
          ...(team === '' ? {} : { teamId: team }),
          expiresAt: now + INVITE_TTL_MS,
          createdAt: now,
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
          <Button size="sm" data-testid="create-invite">
            <PlusIcon />
            New invite
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>Create an invitation</DialogTitle>
        <DialogDescription>
          Leave the email empty for a reusable shareable link. Set an email for a single-use invite
          bound to that address.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleId}>Role</Label>
            <Select
              id={roleId}
              value={role}
              onChange={(event) => setRole(event.target.value as WorkspaceRole)}
            >
              {WORKSPACE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email (optional)</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="off"
              placeholder="Leave empty for a shareable link"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={teamId}>Team (optional)</Label>
            <Select id={teamId} value={team} onChange={(event) => setTeam(event.target.value)}>
              <option value="">No team</option>
              {teams.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
          {error !== undefined ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy}>
              Create invite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
