import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { ISSUE_STATUSES, type IssueStatus, mutators, queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@yapm/ui/components/dialog'
import { IssueRow } from '@yapm/ui/components/issue-row'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { CheckIcon, InboxIcon, RouteIcon, XIcon } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import { cycleKey } from '@/cycles/model'
import {
  type IssueRowData,
  issueKey,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

interface RouteTarget {
  status?: IssueStatus
  assigneeId?: string | null
  cycleId?: string | null
  labelIds: readonly string[]
}

export function TriageView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const zero = useZero()
  const { canWrite } = useMembership()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [inboxRaw, inboxResult] = useQuery(queries.triage.inbox({ teamId }))

  const [focusIndex, setFocusIndex] = useState(0)
  const [routingId, setRoutingId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const containerRef = useRef<HTMLElement>(null)

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const members = useMemo(() => {
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return { id: membership.userId, name: user?.name ?? user?.email ?? membership.userId }
    })
  }, [team, users])

  const issues = useMemo<IssueRowData[]>(
    () =>
      inboxRaw.map((issue) => ({
        id: issue.id,
        number: issue.number ?? null,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId ?? null,
        cycleId: issue.cycleId ?? null,
        updatedAt: issue.updatedAt,
        createdAt: issue.createdAt,
        labels: (
          (issue.labels ?? []) as readonly { id: string; name: string; color: string }[]
        ).map((label) => ({ id: label.id, name: label.name, color: label.color })),
      })),
    [inboxRaw],
  )

  const focusRow = useCallback((index: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.focus()
  }, [])

  useEffect(() => {
    const clamped = Math.min(focusIndex, Math.max(0, issues.length - 1))
    if (clamped !== focusIndex) setFocusIndex(clamped)
    const container = containerRef.current
    if (!container || issues.length === 0) return
    const active = document.activeElement
    if (active === document.body || container.contains(active)) {
      focusRow(clamped)
    }
  }, [issues, focusIndex, focusRow])

  const move = useCallback(
    (delta: number) => {
      setFocusIndex((prev) => {
        const next = Math.max(0, Math.min(issues.length - 1, prev + delta))
        focusRow(next)
        return next
      })
    },
    [issues.length, focusRow],
  )

  const run = useCallback(async (write: ReturnType<typeof zero.mutate>) => {
    const failure = await runMutation(write)
    if (failure !== undefined) setError(failure)
    else setError(undefined)
  }, [])

  const accept = useCallback(
    (id: string) =>
      void run(zero.mutate(mutators.issue.acceptTriage({ id, updatedAt: Date.now() }))),
    [run, zero],
  )

  const decline = useCallback(
    (id: string) =>
      void run(zero.mutate(mutators.issue.declineTriage({ id, updatedAt: Date.now() }))),
    [run, zero],
  )

  const onOpenIssue = useCallback(
    (issue: IssueRowData) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: { open: issue.id } })
    },
    [navigate, teamId],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (issues.length === 0) return
      const current = issues[focusIndex]
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          break
        case 'Enter':
        case 'ArrowRight':
          if (current) {
            event.preventDefault()
            onOpenIssue(current)
          }
          break
        case 'a':
        case 'A':
          if (current && canWrite) {
            event.preventDefault()
            accept(current.id)
          }
          break
        case 'd':
        case 'D':
          if (current && canWrite) {
            event.preventDefault()
            decline(current.id)
          }
          break
        case 'r':
        case 'R':
          if (current && canWrite) {
            event.preventDefault()
            setRoutingId(current.id)
          }
          break
        default:
          break
      }
    },
    [issues, focusIndex, move, onOpenIssue, canWrite, accept, decline],
  )

  const routing = issues.find((issue) => issue.id === routingId) ?? null

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || inboxResult.type === 'complete'
          ? 'This team no longer exists.'
          : 'Loading team…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <InboxIcon aria-hidden="true" className="size-4 text-text-3" />
        <h1 className="text-sm font-semibold tracking-tight text-text-1">{team.name} · Triage</h1>
        <span className="ml-1 font-mono text-xs text-text-3">{issues.length}</span>
        {error !== undefined ? (
          <span className="ml-2 text-xs text-status-urgent" role="alert">
            {error}
          </span>
        ) : null}
      </header>

      <section
        ref={containerRef}
        className="flex-1 overflow-y-auto pb-10 outline-none"
        onKeyDown={onKeyDown}
        aria-label={`${team.name} triage inbox`}
      >
        {issues.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            {inboxResult.type === 'complete'
              ? 'The triage inbox is empty. Incoming issues awaiting triage will appear here.'
              : 'Loading inbox…'}
          </p>
        ) : (
          issues.map((issue, index) => (
            <TriageRow
              key={issue.id}
              index={index}
              issue={issue}
              teamKey={teamKey}
              focused={index === focusIndex}
              canWrite={canWrite}
              onFocusRow={setFocusIndex}
              onOpen={() => onOpenIssue(issue)}
              onAccept={() => accept(issue.id)}
              onDecline={() => decline(issue.id)}
              onRoute={() => setRoutingId(issue.id)}
            />
          ))
        )}
      </section>

      {routing && canWrite ? (
        <RouteDialog
          issue={routing}
          members={members}
          labelOptions={labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
          }))}
          cycleOptions={cycles.map((cycle) => ({
            id: cycle.id,
            name: cycle.name,
            number: cycle.number ?? null,
          }))}
          onClose={() => setRoutingId(null)}
          onSubmit={async (target) => {
            const failure = await runMutation(
              zero.mutate(
                mutators.issue.routeIssue({
                  id: routing.id,
                  ...(target.status === undefined ? {} : { status: target.status }),
                  ...(target.assigneeId === undefined ? {} : { assigneeId: target.assigneeId }),
                  ...(target.cycleId === undefined ? {} : { cycleId: target.cycleId }),
                  ...(target.labelIds.length > 0 ? { addLabelIds: [...target.labelIds] } : {}),
                  updatedAt: Date.now(),
                }),
              ),
            )
            if (failure !== undefined) {
              setError(failure)
              return false
            }
            setError(undefined)
            setRoutingId(null)
            return true
          }}
        />
      ) : null}
    </div>
  )
}

function TriageRow({
  index,
  issue,
  teamKey,
  focused,
  canWrite,
  onFocusRow,
  onOpen,
  onAccept,
  onDecline,
  onRoute,
}: {
  index: number
  issue: IssueRowData
  teamKey: string
  focused: boolean
  canWrite: boolean
  onFocusRow: (index: number) => void
  onOpen: () => void
  onAccept: () => void
  onDecline: () => void
  onRoute: () => void
}) {
  return (
    <div className="group flex items-center gap-1 border-b border-border pr-3">
      <div className="min-w-0 flex-1">
        <IssueRow
          data-index={index}
          data-issue-id={issue.id}
          data-testid="triage-row"
          tabIndex={focused ? 0 : -1}
          issueKey={issueKey(teamKey, issue)}
          title={issue.title}
          status={STATUS_TO_KIND[issue.status]}
          priority={PRIORITY_TO_KIND[issue.priority]}
          labels={(issue.labels ?? []).map((label) => ({ name: label.name, color: label.color }))}
          onFocus={() => onFocusRow(index)}
          onClick={onOpen}
        />
      </div>
      {canWrite ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Accept"
            data-testid="triage-accept"
            onClick={onAccept}
          >
            <CheckIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Route"
            data-testid="triage-route"
            onClick={onRoute}
          >
            <RouteIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Decline"
            data-testid="triage-decline"
            onClick={onDecline}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function RouteDialog({
  issue,
  members,
  labelOptions,
  cycleOptions,
  onClose,
  onSubmit,
}: {
  issue: IssueRowData
  members: readonly { id: string; name: string }[]
  labelOptions: readonly { id: string; name: string; color: string }[]
  cycleOptions: readonly { id: string; name: string; number: number | null }[]
  onClose: () => void
  onSubmit: (target: RouteTarget) => Promise<boolean>
}) {
  const statusId = useId()
  const assigneeId = useId()
  const cycleId = useId()
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [assignee, setAssignee] = useState<string>(issue.assigneeId ?? '')
  const [cycle, setCycle] = useState<string>(issue.cycleId ?? '')
  const [selectedLabels, setSelectedLabels] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  // Routing is add-only (routeIssue has no removal path), so labels already on the issue are
  // shown as read-only chips and only not-yet-applied labels are toggleable.
  const appliedIds = new Set((issue.labels ?? []).map((label) => label.id))
  const appliedLabels = issue.labels ?? []
  const addableLabels = labelOptions.filter((label) => !appliedIds.has(label.id))

  const toggleLabel = (id: string) =>
    setSelectedLabels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function submit() {
    if (busy) return
    setBusy(true)
    await onSubmit({
      status,
      assigneeId: assignee === '' ? null : assignee,
      cycleId: cycle === '' ? null : cycle,
      labelIds: [...selectedLabels],
    })
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent initialFocus>
        <DialogTitle>Route issue</DialogTitle>
        <DialogDescription>
          Accept this issue into the team's work, setting its status, assignee, cycle, and labels.
        </DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={statusId}>Status</Label>
            <Select
              id={statusId}
              value={status}
              onChange={(event) => setStatus(event.target.value as IssueStatus)}
            >
              {ISSUE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={assigneeId}>Assignee</Label>
            <Select
              id={assigneeId}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={cycleId}>Cycle</Label>
            <Select id={cycleId} value={cycle} onChange={(event) => setCycle(event.target.value)}>
              <option value="">No cycle</option>
              {cycleOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {cycleKey(option)}
                </option>
              ))}
            </Select>
          </div>
          {appliedLabels.length > 0 || addableLabels.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-text-2">Labels</legend>
              <div className="flex flex-wrap gap-2">
                {appliedLabels.map((label) => (
                  <span
                    key={label.id}
                    aria-disabled="true"
                    title="Already applied"
                    className="flex items-center gap-1.5 rounded-control border border-accent px-2 py-1 text-xs text-text-1"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    <CheckIcon className="size-3" />
                  </span>
                ))}
                {addableLabels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={selectedLabels.has(label.id)}
                    onClick={() => toggleLabel(label.id)}
                    className="flex items-center gap-1.5 rounded-control border border-border px-2 py-1 text-xs text-text-2 aria-pressed:border-accent aria-pressed:text-text-1"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    {selectedLabels.has(label.id) ? <CheckIcon className="size-3" /> : null}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              data-testid="route-submit"
              onClick={() => void submit()}
            >
              Route issue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
