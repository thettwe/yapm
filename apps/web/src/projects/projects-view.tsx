import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { mutators, newId, PROJECT_STATUSES, type ProjectStatus, queries } from '@yapm/schema'
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
import { IssueRow } from '@yapm/ui/components/issue-row'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { cn } from '@yapm/ui/lib/utils'
import { PlusIcon, TargetIcon } from 'lucide-react'
import { type FormEvent, useCallback, useId, useMemo, useRef, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { Masthead } from '@/frame/masthead'
import { type IssueRowData, issueKey, PRIORITY_TO_KIND, STATUS_TO_KIND } from '@/issues/model'
import { runMutation } from '@/lib/mutation'
import {
  formatTargetDate,
  PROJECT_STATUS_LABEL,
  type ProjectRowData,
  projectProgress,
  sortProjects,
} from '@/projects/model'

// Status → a tokenized dot color. Terracotta accent is never a status (DESIGN), so active uses
// the in-progress status token, completed the done token, and the terminal/neutral states the
// muted text token.
const PROJECT_STATUS_DOT: Record<ProjectStatus, string> = {
  planned: 'bg-text-3',
  active: 'bg-status-in-progress',
  completed: 'bg-status-done',
  cancelled: 'bg-text-3',
}

interface ProjectIssue extends IssueRowData {
  readonly teamId: string
}

export function ProjectsView({ openProjectId }: { openProjectId?: string }) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [projectsRaw, projectsResult] = useQuery(queries.projects.all())
  const [selectedId, setSelectedId] = useState<string | null>(openProjectId ?? null)

  const projects = useMemo<ProjectRowData[]>(
    () =>
      sortProjects(
        projectsRaw.map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          leadId: project.leadId ?? null,
          targetDate: project.targetDate ?? null,
          createdAt: project.createdAt,
        })),
      ),
    [projectsRaw],
  )

  const issuesByProject = useMemo(() => {
    const map = new Map<string, ProjectIssue[]>()
    for (const project of projectsRaw) {
      const issues = ((project.issues ?? []) as readonly ProjectIssue[]).map((issue) => ({
        id: issue.id,
        number: issue.number ?? null,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId ?? null,
        cycleId: issue.cycleId ?? null,
        teamId: issue.teamId,
        updatedAt: issue.updatedAt,
        createdAt: issue.createdAt,
      }))
      map.set(project.id, issues)
    }
    return map
  }, [projectsRaw])

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId],
  )

  const userName = useCallback(
    (id: string | null) => {
      if (id === null) return null
      const user = users.find((candidate) => candidate.id === id)
      return user?.name ?? user?.email ?? id
    },
    [users],
  )

  const teamKeyFor = useCallback(
    (issueTeamId: string) => teams.find((team) => team.id === issueTeamId)?.key ?? '',
    [teams],
  )

  const onOpenIssue = useCallback(
    (issue: ProjectIssue) => {
      void navigate({
        to: '/teams/$teamId/issues',
        params: { teamId: issue.teamId },
        search: { open: issue.id },
      })
    },
    [navigate],
  )

  return (
    <>
      <Masthead
        title="Projects"
        count={projects.length}
        {...(teams[0]
          ? { actions: <NewProjectButton workspaceId={teams[0].workspaceId} users={users} /> }
          : {})}
      />
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-64 flex-col gap-2 overflow-y-auto border-r border-border p-3"
          aria-label="Projects"
        >
          {projects.length === 0 ? (
            <p className="px-1 py-4 text-xs text-text-3" role="status">
              {projectsResult.type === 'complete'
                ? 'No projects yet. Create one to plan across teams.'
                : 'Loading projects…'}
            </p>
          ) : (
            projects.map((project) => {
              const progress = projectProgress(issuesByProject.get(project.id) ?? [])
              return (
                <button
                  key={project.id}
                  type="button"
                  aria-current={project.id === selected?.id ? 'true' : undefined}
                  onClick={() => setSelectedId(project.id)}
                  data-testid="project-rail-item"
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-control px-2 py-1.5 text-left transition-colors',
                    project.id === selected?.id
                      ? 'bg-bg-elevated text-text-1 shadow-sm'
                      : 'text-text-2 hover:bg-bg-sidebar',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span
                      className={cn('size-2 rounded-full', PROJECT_STATUS_DOT[project.status])}
                      aria-hidden="true"
                    />
                    {project.name}
                  </span>
                  <span className="flex w-full items-center gap-2 pl-3.5 font-mono text-[11px] text-text-3">
                    <span>{formatTargetDate(project.targetDate)}</span>
                    <span className="ml-auto">{progress.percent}%</span>
                  </span>
                </button>
              )
            })
          )}
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col overflow-y-auto"
          aria-label="Project detail"
        >
          {selected ? (
            <ProjectPanel
              project={selected}
              issues={issuesByProject.get(selected.id) ?? []}
              leadName={userName(selected.leadId)}
              users={users}
              teamKeyFor={teamKeyFor}
              onOpenIssue={onOpenIssue}
            />
          ) : (
            <p className="p-8 text-center text-sm text-text-3" role="status">
              No project selected.
            </p>
          )}
        </section>
      </div>
    </>
  )
}

function ProjectPanel({
  project,
  issues,
  leadName,
  users,
  teamKeyFor,
  onOpenIssue,
}: {
  project: ProjectRowData
  issues: readonly ProjectIssue[]
  leadName: string | null
  users: readonly { id: string; name?: string | null; email?: string | null }[]
  teamKeyFor: (teamId: string) => string
  onOpenIssue: (issue: ProjectIssue) => void
}) {
  const progress = projectProgress(issues)
  const headingRef = useRef<HTMLHeadingElement>(null)

  return (
    <>
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span
            className={cn('size-2.5 rounded-full', PROJECT_STATUS_DOT[project.status])}
            aria-hidden="true"
          />
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold tracking-tight text-text-1 outline-none"
          >
            {project.name}
          </h2>
          <span className="rounded-full bg-bg-sidebar px-2 py-0.5 text-[11px] font-medium text-text-2">
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
          <div className="ml-auto">
            <EditProjectButton project={project} users={users} />
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-text-3">
          <div className="flex items-center gap-1.5">
            <dt className="font-medium text-text-2">Lead</dt>
            <dd>{leadName ?? 'Unassigned'}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="flex items-center gap-1 font-medium text-text-2">
              <TargetIcon className="size-3.5" aria-hidden="true" />
              Target
            </dt>
            <dd className="font-mono">{formatTargetDate(project.targetDate)}</dd>
          </div>
        </dl>
        <ProgressBar progress={progress} />
      </header>

      <div className="flex-1">
        {issues.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            No issues in this project yet. Assign issues to it from the issue list.
          </p>
        ) : (
          issues.map((issue) => (
            <IssueRow
              key={issue.id}
              data-issue-id={issue.id}
              data-testid="project-issue-row"
              issueKey={issueKey(teamKeyFor(issue.teamId), issue)}
              title={issue.title}
              status={STATUS_TO_KIND[issue.status]}
              priority={PRIORITY_TO_KIND[issue.priority]}
              onClick={() => onOpenIssue(issue)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenIssue(issue)
                }
              }}
            />
          ))
        )}
      </div>
    </>
  )
}

function ProgressBar({ progress }: { progress: { total: number; done: number; percent: number } }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-bg-sidebar"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Project progress"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="font-mono text-xs text-text-3">
        {progress.done}/{progress.total} · {progress.percent}%
      </span>
    </div>
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
  users: readonly { id: string; name?: string | null; email?: string | null }[]
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

function NewProjectButton({
  workspaceId,
  users,
}: {
  workspaceId: string
  users: readonly { id: string; name?: string | null; email?: string | null }[]
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
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="New project"
            data-testid="new-project"
          >
            <PlusIcon />
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
            <p className="text-xs text-status-urgent" role="alert">
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

function EditProjectButton({
  project,
  users,
}: {
  project: ProjectRowData
  users: readonly { id: string; name?: string | null; email?: string | null }[]
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
  }

  // Reseed the form each time the dialog opens (not via a component key) so switching the
  // selected project and reopening Edit shows the current project — without remounting, so the
  // Edit trigger persists and focus is still returned correctly after a delete.
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
            <p className="text-xs text-status-urgent" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-status-urgent"
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
