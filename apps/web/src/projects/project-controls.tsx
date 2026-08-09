import { useZero } from '@rocicorp/zero/react'
import { mutators, newId, PROJECT_STATUSES, type ProjectStatus } from '@yapm/schema'
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
import { type FormEvent, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { runMutation } from '@/lib/mutation'
import { PROJECT_STATUS_LABEL, type ProjectRowData } from '@/projects/model'

// Two letters from a name, for an avatar fallback.
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export interface UserOption {
  readonly id: string
  readonly name?: string | null
  readonly email?: string | null
}

// The seam both project surfaces are drawn against: a project belongs to the WORKSPACE while the
// deck above it belongs to a team, so one project can hold issues from several teams. Dashed
// because it is wider than the solid deck it sits under.
export function ScopeChip({ workspaceName }: { workspaceName: string | null }) {
  if (workspaceName === null) return null
  return (
    <span
      data-testid="project-scope"
      className="inline-flex h-[23px] items-center gap-1.5 rounded-pill border border-border-strong border-dashed pr-2.5 pl-[7px] text-[11.5px] text-text-2"
    >
      <span
        aria-hidden="true"
        className="flex size-3.5 items-center justify-center rounded-[4px] bg-accent font-bold text-[8px] text-on-accent"
      >
        {workspaceName.slice(0, 1).toUpperCase()}
      </span>
      {workspaceName} workspace
    </span>
  )
}

interface ProjectFormValues {
  name: string
  leadId: string
  status: ProjectStatus
  target: string
}

function useProjectForm(initial: ProjectFormValues) {
  const [name, setName] = useState(initial.name)
  const [leadId, setLeadId] = useState(initial.leadId)
  const [status, setStatus] = useState<ProjectStatus>(initial.status)
  const [target, setTarget] = useState(initial.target)
  return { name, setName, leadId, setLeadId, status, setStatus, target, setTarget }
}

function ProjectFields({
  form,
  users,
  ids,
}: {
  form: ReturnType<typeof useProjectForm>
  users: readonly UserOption[]
  ids: { name: string; lead: string; status: string; target: string }
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>Project name</Label>
        <Input
          id={ids.name}
          aria-label="Project name"
          autoComplete="off"
          placeholder="Project name…"
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.lead}>Lead</Label>
        <Select
          id={ids.lead}
          aria-label="Lead"
          value={form.leadId}
          onChange={(event) => form.setLeadId(event.target.value)}
        >
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name ?? user.email ?? user.id}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.status}>Status</Label>
        <Select
          id={ids.status}
          aria-label="Status"
          value={form.status}
          onChange={(event) => form.setStatus(event.target.value as ProjectStatus)}
        >
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.target}>Target date</Label>
        <Input
          id={ids.target}
          type="date"
          aria-label="Target date"
          value={form.target}
          onChange={(event) => form.setTarget(event.target.value)}
        />
      </div>
    </>
  )
}

export function NewProjectButton({
  workspaceId,
  users,
}: {
  workspaceId: string
  users: readonly UserOption[]
}) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const ids = { name: useId(), lead: useId(), status: useId(), target: useId() }
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const form = useProjectForm({ name: '', leadId: '', status: 'planned', target: '' })

  if (!canWrite) return null

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (form.name.trim().length === 0) {
      setError('A project name is required.')
      return
    }
    const targetDate = form.target ? Date.parse(form.target) : null
    setError(undefined)
    setBusy(true)
    const now = Date.now()
    // The id is minted HERE, at the call site — never inside the mutator, which re-runs on rebase.
    const failure = await runMutation(
      zero.mutate(
        mutators.project.create({
          id: newId(),
          workspaceId,
          name: form.name.trim(),
          leadId: form.leadId || null,
          status: form.status,
          targetDate: targetDate === null || Number.isNaN(targetDate) ? null : targetDate,
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
    setOpen(false)
    form.setName('')
    form.setLeadId('')
    form.setStatus('planned')
    form.setTarget('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" data-testid="new-project">
            + New project
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A project groups issues across teams toward a shared outcome.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={create} noValidate>
          <ProjectFields form={form} users={users} ids={ids} />
          {error !== undefined ? (
            <p className="text-xs text-status-urgent-ink" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditProjectButton({
  project,
  users,
  onDeleted,
}: {
  project: ProjectRowData
  users: readonly UserOption[]
  onDeleted?: () => void
}) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const ids = { name: useId(), lead: useId(), status: useId(), target: useId() }
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const initialTarget = project.targetDate
    ? new Date(project.targetDate).toISOString().slice(0, 10)
    : ''
  const form = useProjectForm({
    name: project.name,
    leadId: project.leadId ?? '',
    status: project.status,
    target: initialTarget,
  })

  if (!canWrite) return null

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (form.name.trim().length === 0) {
      setError('A project name is required.')
      return
    }
    const targetDate = form.target ? Date.parse(form.target) : null
    setError(undefined)
    setBusy(true)
    const failure = await runMutation(
      zero.mutate(
        mutators.project.update({
          id: project.id,
          name: form.name.trim(),
          leadId: form.leadId || null,
          status: form.status,
          targetDate: targetDate === null || Number.isNaN(targetDate) ? null : targetDate,
          updatedAt: Date.now(),
        }),
      ),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setOpen(false)
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    const failure = await runMutation(zero.mutate(mutators.project.delete({ id: project.id })))
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setOpen(false)
    onDeleted?.()
  }

  // Reseed the form each time the dialog opens (not via a component key) so switching the open
  // project and reopening Edit shows the current project — without remounting, so the Edit trigger
  // persists and focus is still returned correctly after a delete.
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      form.setName(project.name)
      form.setLeadId(project.leadId ?? '')
      form.setStatus(project.status)
      form.setTarget(
        project.targetDate ? new Date(project.targetDate).toISOString().slice(0, 10) : '',
      )
      setError(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" data-testid="edit-project">
            Edit
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>Edit project</DialogTitle>
        <DialogDescription>Update the project's name, lead, status, or target.</DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={save} noValidate>
          <ProjectFields form={form} users={users} ids={ids} />
          {error !== undefined ? (
            <p className="text-xs text-status-urgent-ink" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-status-urgent-ink"
              onClick={() => void remove()}
              data-testid="delete-project"
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
