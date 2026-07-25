import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
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
import { IssueRow } from '@yapm/ui/components/issue-row'
import { Label } from '@yapm/ui/components/label'
import { cn } from '@yapm/ui/lib/utils'
import { CircleDashedIcon, FlagIcon, PlusIcon } from 'lucide-react'
import { type FormEvent, useCallback, useId, useMemo, useRef, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import type { DigestIssueRow } from '@/cycles/digest'
import { CycleDigestPanel } from '@/cycles/digest-panel'
import {
  CYCLE_STATUS_LABEL,
  type CycleRowData,
  currentCycle,
  cycleKey,
  cycleProgress,
  formatCycleRange,
  partitionCycles,
} from '@/cycles/model'
import { type IssueRowData, issueKey, PRIORITY_TO_KIND, STATUS_TO_KIND } from '@/issues/model'
import { runMutation } from '@/lib/mutation'

export function CyclesView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [cyclesRaw, cyclesResult] = useQuery(queries.cycles.byTeam({ teamId }))
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const cycles = useMemo<CycleRowData[]>(
    () =>
      cyclesRaw.map((cycle) => ({
        id: cycle.id,
        number: cycle.number ?? null,
        name: cycle.name,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      })),
    [cyclesRaw],
  )

  const issues = useMemo<IssueRowData[]>(
    () =>
      issuesRaw.map((issue) => ({
        id: issue.id,
        number: issue.number ?? null,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId ?? null,
        cycleId: issue.cycleId ?? null,
        updatedAt: issue.updatedAt,
        createdAt: issue.createdAt,
      })),
    [issuesRaw],
  )

  const { active, upcoming, completed } = useMemo(() => partitionCycles(cycles), [cycles])
  const selected = useMemo(
    () =>
      cycles.find((cycle) => cycle.id === selectedId) ??
      currentCycle(cycles) ??
      completed[0] ??
      null,
    [cycles, selectedId, completed],
  )

  const selectedIssues = useMemo(
    () => (selected ? issues.filter((issue) => issue.cycleId === selected.id) : []),
    [issues, selected],
  )

  const selectedRawIssues = useMemo<readonly DigestIssueRow[]>(
    () =>
      selected
        ? (issuesRaw.filter(
            (issue) => (issue.cycleId ?? null) === selected.id,
          ) as unknown as readonly DigestIssueRow[])
        : [],
    [issuesRaw, selected],
  )

  const onOpenIssueId = useCallback(
    (issueId: string) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: { open: issueId } })
    },
    [navigate, teamId],
  )

  const onOpenIssue = useCallback((issue: IssueRowData) => onOpenIssueId(issue.id), [onOpenIssueId])

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || cyclesResult.type === 'complete'
          ? 'This team no longer exists.'
          : 'Loading team…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className="flex w-64 flex-col gap-4 overflow-y-auto border-r border-border p-3"
        aria-label="Cycles"
      >
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold tracking-tight text-text-1">Cycles</h1>
          <NewCycleButton teamId={teamId} />
        </div>
        <CycleGroup
          label={CYCLE_STATUS_LABEL.active}
          cycles={active}
          selectedId={selected?.id}
          onSelect={setSelectedId}
        />
        <CycleGroup
          label={CYCLE_STATUS_LABEL.upcoming}
          cycles={upcoming}
          selectedId={selected?.id}
          onSelect={setSelectedId}
        />
        <CycleGroup
          label={CYCLE_STATUS_LABEL.completed}
          cycles={completed}
          selectedId={selected?.id}
          onSelect={setSelectedId}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Cycle detail">
        {selected ? (
          <CyclePanel
            teamId={teamId}
            teamKey={teamKey}
            cycle={selected}
            issues={selectedIssues}
            rawIssues={selectedRawIssues}
            onOpenIssue={onOpenIssue}
            onOpenIssueId={onOpenIssueId}
          />
        ) : (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            No cycles yet. Create one to start planning a time-boxed iteration.
          </p>
        )}
      </section>
    </div>
  )
}

function CycleGroup({
  label,
  cycles,
  selectedId,
  onSelect,
}: {
  label: string
  cycles: readonly CycleRowData[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  if (cycles.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </span>
      {cycles.map((cycle) => (
        <button
          key={cycle.id}
          type="button"
          aria-current={cycle.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(cycle.id)}
          className={cn(
            'flex flex-col items-start gap-0.5 rounded-control px-2 py-1.5 text-left transition-colors',
            cycle.id === selectedId
              ? 'bg-bg-elevated text-text-1 shadow-sm'
              : 'text-text-2 hover:bg-bg-sidebar',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CircleDashedIcon className="size-3.5 text-text-3" />
            {cycle.name}
          </span>
          <span className="pl-5 font-mono text-[11px] text-text-3">
            {cycleKey(cycle)} · {formatCycleRange(cycle.startDate, cycle.endDate)}
          </span>
        </button>
      ))}
    </div>
  )
}

function CyclePanel({
  teamId,
  teamKey,
  cycle,
  issues,
  rawIssues,
  onOpenIssue,
  onOpenIssueId,
}: {
  teamId: string
  teamKey: string
  cycle: CycleRowData
  issues: readonly IssueRowData[]
  rawIssues: readonly DigestIssueRow[]
  onOpenIssue: (issue: IssueRowData) => void
  onOpenIssueId: (issueId: string) => void
}) {
  const progress = cycleProgress(issues)
  const headingRef = useRef<HTMLHeadingElement>(null)

  return (
    <>
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold tracking-tight text-text-1 outline-none"
          >
            {cycle.name}
          </h2>
          <span className="font-mono text-xs text-text-3">{cycleKey(cycle)}</span>
          <span className="rounded-full bg-bg-sidebar px-2 py-0.5 text-[11px] font-medium text-text-2">
            {CYCLE_STATUS_LABEL[cycle.status]}
          </span>
          <span className="ml-1 text-xs text-text-3">
            {formatCycleRange(cycle.startDate, cycle.endDate)}
          </span>
          <div className="ml-auto">
            <CompleteCycleButton
              teamId={teamId}
              cycle={cycle}
              onCompleted={() => headingRef.current?.focus()}
            />
          </div>
        </div>
        <ProgressBar progress={progress} />
      </header>

      <CycleDigestPanel
        teamId={teamId}
        cycle={cycle}
        issues={rawIssues}
        onOpenIssue={onOpenIssueId}
      />

      <div className="flex-1">
        {issues.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            No issues in this cycle yet.
          </p>
        ) : (
          issues.map((issue) => (
            <IssueRow
              key={issue.id}
              data-issue-id={issue.id}
              data-testid="cycle-issue-row"
              issueKey={issueKey(teamKey, issue)}
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
        aria-label="Cycle progress"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="font-mono text-xs text-text-3">
        {progress.done}/{progress.total} · {progress.percent}%
      </span>
    </div>
  )
}

function CompleteCycleButton({
  teamId,
  cycle,
  onCompleted,
}: {
  teamId: string
  cycle: CycleRowData
  onCompleted: () => void
}) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const [error, setError] = useState<string | undefined>(undefined)
  void teamId

  if (!canWrite || cycle.status === 'completed') return null

  async function complete() {
    const failure = await runMutation(
      zero.mutate(mutators.cycle.complete({ id: cycle.id, updatedAt: Date.now() })),
    )
    if (failure === undefined) {
      onCompleted()
      return
    }
    setError(failure)
  }

  return (
    <div className="flex items-center gap-2">
      {error !== undefined ? (
        <span className="text-xs text-status-urgent" role="alert">
          {error}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void complete()}
        data-testid="complete-cycle"
      >
        <FlagIcon />
        Complete cycle
      </Button>
    </div>
  )
}

function NewCycleButton({ teamId }: { teamId: string }) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const nameId = useId()
  const startId = useId()
  const endId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function reset() {
    setName('')
    setStart('')
    setEnd('')
    setError(undefined)
  }

  if (!canWrite) return null

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const startDate = Date.parse(start)
    const endDate = Date.parse(end)
    if (name.trim().length === 0 || Number.isNaN(startDate) || Number.isNaN(endDate)) {
      setError('Name and both dates are required.')
      return
    }
    setError(undefined)
    setBusy(true)
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(
        mutators.cycle.create({
          id: newId(),
          teamId,
          name: name.trim(),
          startDate,
          endDate,
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
          <Button size="icon-sm" variant="outline" aria-label="New cycle" data-testid="new-cycle">
            <PlusIcon />
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>New cycle</DialogTitle>
        <DialogDescription>
          A cycle is a time-boxed iteration. Set a name and a start and end date.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={create} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Cycle name</Label>
            <Input
              id={nameId}
              aria-label="Cycle name"
              autoComplete="off"
              placeholder="Cycle name…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={startId}>Start date</Label>
            <Input
              id={startId}
              type="date"
              aria-label="Start date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={endId}>End date</Label>
            <Input
              id={endId}
              type="date"
              aria-label="End date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
          {error !== undefined ? (
            <p className="text-xs text-status-urgent" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              Create cycle
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
