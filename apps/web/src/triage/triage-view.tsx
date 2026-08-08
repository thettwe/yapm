import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ISSUE_STATUSES, type IssueStatus, mutators, queries } from '@yapm/schema'
import { Avatar, AvatarFallback } from '@yapm/ui/components/avatar'
import { IssueRow } from '@yapm/ui/components/issue-row'
import { RichTextRenderer, type RichTextValue } from '@yapm/ui/components/rich-text'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import { cycleKey } from '@/cycles/model'
import { Masthead } from '@/frame/masthead'
import { attachmentSrc } from '@/issues/attachments/upload'
import {
  formatRelative,
  type IssueRowData,
  issueKey,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

interface TriageIssue extends IssueRowData {
  readonly description: RichTextValue | null
  readonly reporter: string | null
}

interface AttachmentChipRow {
  readonly id: string
  readonly filename: string
}

interface RouteDraft {
  readonly status: IssueStatus
  readonly assigneeId: string
  readonly cycleId: string
  readonly projectId: string
  readonly labelIds: ReadonlySet<string>
}

interface Option {
  readonly id: string
  readonly name: string
}

interface LabelOption extends Option {
  readonly color: string
}

// The arrival stamp, stated once — the queue's age column is a plain relative number and the
// panel is the only place the surface names the moment itself.
export function formatStamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Key({ children, armed = false }: { children: ReactNode; armed?: boolean }) {
  return (
    <kbd
      className={cn(
        'rounded border border-border-strong bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-2',
        armed && 'border-accent text-accent-strong ring-2 ring-accent-line',
      )}
    >
      {children}
    </kbd>
  )
}

function CyclesGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5 text-text-3">
      <circle cx="10" cy="10" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 1.4 V4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5.5" cy="14.5" r="1.9" fill="currentColor" />
    </svg>
  )
}

function ProjectsGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5 text-text-3">
      <path
        d="M5 4 H4 V16 H5 M15 4 H16 V16 H15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
    </svg>
  )
}

function UploadGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3 shrink-0 text-text-2">
      <rect
        x="3"
        y="4.5"
        width="14"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5.5 13 L9 9.5 L11 11.3 L14.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TriageView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const zero = useZero()
  const { canWrite } = useMembership()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [projects] = useQuery(queries.projects.all())
  const [inboxRaw, inboxResult] = useQuery(queries.triage.inbox({ teamId }))

  const [focusIndex, setFocusIndex] = useState(0)
  const [routingId, setRoutingId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const containerRef = useRef<HTMLElement>(null)

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const members = useMemo<Option[]>(() => {
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return { id: membership.userId, name: user?.name ?? user?.email ?? membership.userId }
    })
  }, [team, users])

  const issues = useMemo<TriageIssue[]>(
    () =>
      inboxRaw.map((issue) => {
        const creator = issue.creator as { name?: string | null; email?: string | null } | undefined
        return {
          id: issue.id,
          number: issue.number ?? null,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          assigneeId: issue.assigneeId ?? null,
          cycleId: issue.cycleId ?? null,
          projectId: issue.projectId ?? null,
          updatedAt: issue.updatedAt,
          createdAt: issue.createdAt,
          description: (issue.description as RichTextValue | null) ?? null,
          reporter: creator?.name ?? creator?.email ?? null,
          labels: (
            (issue.labels ?? []) as readonly { id: string; name: string; color: string }[]
          ).map((label) => ({ id: label.id, name: label.name, color: label.color })),
        }
      }),
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
    // A sync tick must never pull focus out of the open transient mid-edit; the transient hands
    // focus back to its row itself when it closes.
    if (!container || issues.length === 0 || routingId !== null) return
    const active = document.activeElement
    if (active === document.body || container.contains(active)) {
      focusRow(clamped)
    }
  }, [issues, focusIndex, routingId, focusRow])

  // The panel and the verdict keys must always name the same issue, so moving focus closes an
  // open transient rather than leaving it addressed to the row that just lost the decision.
  const move = useCallback(
    (delta: number) => {
      setRoutingId(null)
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
    setError(failure)
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
      if (issues.length === 0 || routingId !== null) return
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
    [issues, focusIndex, routingId, move, onOpenIssue, canWrite, accept, decline],
  )

  const closeRoute = useCallback(() => {
    setRoutingId(null)
    focusRow(focusIndex)
  }, [focusIndex, focusRow])

  const commitRoute = useCallback(
    async (issue: TriageIssue, draft: RouteDraft): Promise<string | undefined> => {
      const failure = await runMutation(
        zero.mutate(
          mutators.issue.routeIssue({
            id: issue.id,
            status: draft.status,
            assigneeId: draft.assigneeId === '' ? null : draft.assigneeId,
            cycleId: draft.cycleId === '' ? null : draft.cycleId,
            projectId: draft.projectId === '' ? null : draft.projectId,
            addLabelIds: [...draft.labelIds],
            updatedAt: Date.now(),
          }),
        ),
      )
      setError(failure)
      if (failure === undefined) closeRoute()
      return failure
    },
    [zero, closeRoute],
  )

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || inboxResult.type === 'complete' ? 'No such team.' : 'Loading…'}
      </p>
    )
  }

  const labelOptions: LabelOption[] = labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
  }))
  const cycleOptions: Option[] = cycles.map((cycle) => ({
    id: cycle.id,
    name: `${cycle.name} · ${cycleKey({ number: cycle.number ?? null })}`,
  }))
  const projectOptions: Option[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
  }))

  return (
    <>
      <Masthead
        title="Triage"
        // The same `triage.inbox` rows `team-home.ts`'s `buildAttention` counts: one derivation,
        // so the masthead, the deck badge, the statusline and Team Home cannot disagree.
        count={issues.length}
        {...(issues.length === 0
          ? {}
          : { actions: <span className="font-mono text-[11px] text-text-3">oldest first</span> })}
        {...(error === undefined
          ? {}
          : {
              meta: (
                <span className="text-xs text-status-urgent" role="alert">
                  {error}
                </span>
              ),
            })}
      />
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <section
          ref={containerRef}
          className="flex-1 overflow-y-auto pb-10 outline-none"
          onKeyDown={onKeyDown}
          aria-label="Triage inbox"
        >
          {issues.length === 0 ? (
            inboxResult.type === 'complete' ? (
              <EmptyQueue teamId={teamId} />
            ) : (
              <p className="p-8 text-sm text-text-3" role="status">
                Loading…
              </p>
            )
          ) : (
            issues.map((issue, index) => (
              <div key={issue.id}>
                <IssueRow
                  data-index={index}
                  data-issue-id={issue.id}
                  data-testid="triage-row"
                  tabIndex={index === focusIndex ? 0 : -1}
                  issueKey={issueKey(teamKey, issue)}
                  title={issue.title}
                  status={STATUS_TO_KIND[issue.status]}
                  priority={PRIORITY_TO_KIND[issue.priority]}
                  labels={(issue.labels ?? []).map((label) => ({
                    name: label.name,
                    color: label.color,
                  }))}
                  date={formatRelative(issue.createdAt)}
                  selected={index === focusIndex}
                  {...(issue.reporter === null
                    ? {}
                    : {
                        assignee: { name: issue.reporter },
                        assigneeLabel: `Reported by ${issue.reporter}`,
                      })}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => onOpenIssue(issue)}
                />
                {index === focusIndex ? (
                  <DecisionPanel
                    key={issue.id}
                    issue={issue}
                    issueKeyText={issueKey(teamKey, issue)}
                    canWrite={canWrite}
                    routing={routingId === issue.id}
                    members={members}
                    labelOptions={labelOptions}
                    cycleOptions={cycleOptions}
                    projectOptions={projectOptions}
                    onAccept={() => accept(issue.id)}
                    onDecline={() => decline(issue.id)}
                    onOpenRoute={() => setRoutingId(issue.id)}
                    onCloseRoute={closeRoute}
                    onCommitRoute={(draft) => commitRoute(issue, draft)}
                  />
                ) : null}
              </div>
            ))
          )}
        </section>
      </div>
    </>
  )
}

// The panel is mounted for exactly the issue under decision, so its attachment query is one
// unconditional hook over one issue's already-synced rows.
function DecisionPanel({
  issue,
  issueKeyText,
  canWrite,
  routing,
  members,
  labelOptions,
  cycleOptions,
  projectOptions,
  onAccept,
  onDecline,
  onOpenRoute,
  onCloseRoute,
  onCommitRoute,
}: {
  issue: TriageIssue
  issueKeyText: string
  canWrite: boolean
  routing: boolean
  members: readonly Option[]
  labelOptions: readonly LabelOption[]
  cycleOptions: readonly Option[]
  projectOptions: readonly Option[]
  onAccept: () => void
  onDecline: () => void
  onOpenRoute: () => void
  onCloseRoute: () => void
  onCommitRoute: (draft: RouteDraft) => Promise<string | undefined>
}) {
  const [attachments] = useQuery(queries.attachments.byIssue({ issueId: issue.id }))
  const chips = attachments as readonly AttachmentChipRow[]
  const declineTargetId = `${issue.id}-decline-target`

  return (
    <div
      data-testid="triage-decision"
      className="relative flex items-start gap-10 border-row-hairline border-y border-l-[3px] border-l-accent bg-bg-selected py-[17px] pr-10 pl-[34px]"
    >
      <div className="min-w-0 max-w-[660px] flex-1">
        {issue.description === null ? null : (
          <RichTextRenderer
            value={issue.description}
            resolveAttachmentSrc={attachmentSrc}
            className="text-sm leading-relaxed text-text-1"
          />
        )}
        {/* Every mono fact this panel states is `--text-2`, not the quieter `--text-3` the mock
            draws: on the panel's tint that ink measures 2.43–3.33 across the six theme blocks,
            which is under the bar a 10.5px fact may sit at. `contrast.test.ts` holds the number. */}
        <div
          data-testid="triage-provenance"
          className="mt-[11px] flex flex-wrap items-center gap-2.5 font-mono text-[10.5px] text-text-2"
        >
          <span>
            {issue.reporter ?? 'Unknown reporter'} · {formatStamp(issue.createdAt)}
          </span>
          {chips.map((chip) => (
            <a
              key={chip.id}
              href={attachmentSrc(chip.id, 'full')}
              download={chip.filename}
              data-testid="triage-attachment"
              className="flex items-center gap-1.5 rounded-control border border-border-strong bg-bg-elevated px-1.5 py-0.5 font-mono text-[11.5px] text-text-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
            >
              <UploadGlyph />
              {chip.filename}
            </a>
          ))}
        </div>
      </div>

      <div className="ml-auto flex w-[214px] flex-none flex-col gap-2.5">
        {canWrite ? (
          <>
            <VerdictKey
              testId="triage-accept"
              shortcut="a"
              word="Accept"
              cap="A"
              onClick={onAccept}
            />
            <VerdictKey
              testId="triage-route"
              shortcut="r"
              word="Route"
              cap="R"
              armed={routing}
              onClick={onOpenRoute}
            />
            <VerdictKey
              testId="triage-decline"
              shortcut="d"
              word="Decline"
              cap="D"
              describedBy={declineTargetId}
              onClick={onDecline}
              trailing={
                <span
                  id={declineTargetId}
                  className="inline-flex items-center gap-1 font-mono text-[10.5px] font-normal text-text-2"
                >
                  <StatusGlyph status="canceled" className="size-3" aria-hidden="true" />
                  canceled
                </span>
              }
            />
          </>
        ) : null}
        <span className="mt-[3px] flex items-center gap-1.5 border-border-strong border-t pt-2.5 text-xs text-text-2">
          <Key>⏎</Key>Open
          <span aria-hidden="true" className="text-border-strong">
            ·
          </span>
          <Key>J</Key>
          <Key>K</Key>Move
        </span>
      </div>

      {routing && canWrite ? (
        <RouteTransient
          issue={issue}
          issueKeyText={issueKeyText}
          members={members}
          labelOptions={labelOptions}
          cycleOptions={cycleOptions}
          projectOptions={projectOptions}
          onClose={onCloseRoute}
          onCommit={onCommitRoute}
        />
      ) : null}
    </div>
  )
}

// A verdict is a word with a key, never an icon: `aria-label` holds the word alone so the button's
// name is what it does, `aria-keyshortcuts` carries the key the drawn cap shows, and Decline's
// landing status is a description rather than part of the name.
function VerdictKey({
  testId,
  shortcut,
  word,
  cap,
  armed = false,
  describedBy,
  trailing,
  onClick,
}: {
  testId: string
  shortcut: string
  word: string
  cap: string
  armed?: boolean
  describedBy?: string
  trailing?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={word}
      aria-keyshortcuts={shortcut}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      onClick={onClick}
      className="flex items-center gap-2 rounded-control text-left text-[13px] font-semibold text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Key armed={armed}>{cap}</Key>
      <span aria-hidden="true">{word}</span>
      {trailing}
    </button>
  )
}

// The page's one transient. It edits five values and commits them in ONE write, which is why it is
// a labelled panel rather than a menu: a menu's items fire on activation.
function RouteTransient({
  issue,
  issueKeyText,
  members,
  labelOptions,
  cycleOptions,
  projectOptions,
  onClose,
  onCommit,
}: {
  issue: TriageIssue
  issueKeyText: string
  members: readonly Option[]
  labelOptions: readonly LabelOption[]
  cycleOptions: readonly Option[]
  projectOptions: readonly Option[]
  onClose: () => void
  onCommit: (draft: RouteDraft) => Promise<string | undefined>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const statusFieldId = useId()
  const assigneeFieldId = useId()
  const cycleFieldId = useId()
  const projectFieldId = useId()
  const [status, setStatus] = useState<IssueStatus>(issue.status)
  const [assigneeId, setAssigneeId] = useState(issue.assigneeId ?? '')
  const [cycleId, setCycleId] = useState(issue.cycleId ?? '')
  const [projectId, setProjectId] = useState(issue.projectId ?? '')
  const [labelIds, setLabelIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const applied = issue.labels ?? []
  const appliedIds = new Set(applied.map((label) => label.id))
  const addable = labelOptions.filter((label) => !appliedIds.has(label.id))

  const draft: RouteDraft = { status, assigneeId, cycleId, projectId, labelIds }

  async function commit() {
    if (busy) return
    setBusy(true)
    setFailure(await onCommit(draft))
    setBusy(false)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      event.stopPropagation()
      void commit()
      return
    }
    // Every other key stays inside the transient: `a` in a select is a typeahead, not a verdict.
    event.stopPropagation()
  }

  const labelValue = [...applied.map((label) => label.name), ...namesFor(labelOptions, labelIds)]

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Route ${issueKeyText}`}
      data-testid="triage-route-panel"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute top-[calc(100%-6px)] right-10 z-50 w-[300px] rounded-[10px] border border-border bg-bg-elevated p-1.5 font-ui shadow-elevated outline-none"
    >
      <div className="px-2 pt-1 pb-1.5 font-mono text-[10px] tracking-[0.08em] text-text-2">
        ROUTE · {issueKeyText}
      </div>

      <RouteField
        controlId={statusFieldId}
        label="Status"
        glyph={<StatusGlyph status={STATUS_TO_KIND[status]} />}
      >
        <Select
          id={statusFieldId}
          className="h-7 text-[12px]"
          value={status}
          onChange={(event) => setStatus(event.target.value as IssueStatus)}
        >
          {ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
      </RouteField>

      <RouteField
        controlId={assigneeFieldId}
        label="Assignee"
        glyph={
          assigneeId === '' ? null : (
            <Avatar size="xs">
              <AvatarFallback aria-hidden="true">
                {(nameFor(members, assigneeId) ?? '?').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )
        }
      >
        <Select
          id={assigneeFieldId}
          className="h-7 text-[12px]"
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
        >
          <option value="">none</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
      </RouteField>

      <RouteField controlId={cycleFieldId} label="Cycle" glyph={<CyclesGlyph />}>
        <Select
          id={cycleFieldId}
          className="h-7 text-[12px]"
          value={cycleId}
          onChange={(event) => setCycleId(event.target.value)}
        >
          <option value="">none</option>
          {cycleOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </RouteField>

      <RouteField controlId={projectFieldId} label="Project" glyph={<ProjectsGlyph />}>
        <Select
          id={projectFieldId}
          className="h-7 text-[12px]"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">none</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </RouteField>

      <div className="px-2 py-1.5">
        <div className="flex items-center gap-2 text-[12.5px] text-text-2">
          <span className="flex w-3.5 justify-center">
            <span aria-hidden="true" className="size-2 rounded-full bg-text-3" />
          </span>
          <span>Labels</span>
          <span
            className={cn(
              'ml-auto truncate font-medium',
              labelValue.length === 0 ? 'font-normal text-text-2' : 'text-text-1',
            )}
          >
            {labelValue.length === 0 ? 'none' : labelValue.join(', ')}
          </span>
        </div>
        {/* Routing only ADDS labels — `routeIssue` has no removal path — so what is already on the
            issue is stated, and only the not-yet-applied ones are offered. */}
        {addable.length === 0 ? null : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {addable.map((label) => (
              <button
                key={label.id}
                type="button"
                aria-pressed={labelIds.has(label.id)}
                onClick={() =>
                  setLabelIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(label.id)) next.delete(label.id)
                    else next.add(label.id)
                    return next
                  })
                }
                className="flex items-center gap-1.5 rounded-control border border-border px-1.5 py-0.5 text-[11.5px] text-text-2 outline-none aria-pressed:border-accent aria-pressed:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {failure === undefined ? null : (
        <p className="px-2 pb-1 text-[11px] text-status-urgent" role="alert">
          {failure}
        </p>
      )}

      <div className="mt-1 flex items-center gap-2 border-row-hairline border-t px-2 pt-2 pb-0.5 text-[11px] text-text-2">
        <button
          type="button"
          data-testid="route-submit"
          aria-label="Route issue"
          disabled={busy}
          onClick={() => void commit()}
          className="flex items-center gap-1.5 rounded-control text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Key>⏎</Key>
          <span aria-hidden="true">route</span>
        </button>
        <span aria-hidden="true" className="text-border-strong">
          ·
        </span>
        <button
          type="button"
          aria-label="Close without routing"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-control text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Key>esc</Key>
          <span aria-hidden="true">stay</span>
        </button>
      </div>
    </div>
  )
}

function RouteField({
  controlId,
  label,
  glyph,
  children,
}: {
  controlId: string
  label: string
  glyph: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[12.5px] text-text-2">
      <span className="flex w-3.5 justify-center">{glyph}</span>
      <label htmlFor={controlId}>{label}</label>
      <span className="ml-auto w-[150px]">{children}</span>
    </div>
  )
}

function nameFor(options: readonly Option[], id: string): string | undefined {
  return options.find((option) => option.id === id)?.name
}

function namesFor(options: readonly Option[], ids: ReadonlySet<string>): string[] {
  return options.filter((option) => ids.has(option.id)).map((option) => option.name)
}

// The mock's second frame: the done disc, two words, and three doorways. Nothing here explains
// what triage is, and nothing claims the clearing was recent — no triage event is recorded.
function EmptyQueue({ teamId }: { teamId: string }) {
  const divider = (
    <span aria-hidden="true" className="mx-2.5 font-normal text-border-strong">
      ·
    </span>
  )
  return (
    <div role="status">
      <div className="flex items-center gap-4 border-row-hairline border-y px-10 pt-[34px] pb-8">
        <StatusGlyph status="done" aria-hidden="true" className="size-[26px] text-status-done" />
        <span className="font-heading text-[21px] font-bold tracking-[-0.018em] text-text-1">
          Nothing waiting.
        </span>
      </div>
      <div className="flex items-center px-10 py-5 text-[12.5px] font-semibold text-text-2">
        <Doorway to="/teams/$teamId/issues" teamId={teamId} label="Issues" />
        {divider}
        <Doorway to="/teams/$teamId/cycles" teamId={teamId} label="Cycles" />
        {divider}
        <Doorway to="/teams/$teamId/projects" teamId={teamId} label="Projects" />
        <span className="ml-auto flex items-center gap-[7px] font-normal text-text-3">
          <Key>⌘K</Key>
          goes anywhere
        </span>
      </div>
    </div>
  )
}

function Doorway({
  to,
  teamId,
  label,
}: {
  to: '/teams/$teamId/issues' | '/teams/$teamId/cycles' | '/teams/$teamId/projects'
  teamId: string
  label: string
}) {
  return (
    <Link
      to={to}
      params={{ teamId }}
      className="rounded-control outline-none hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-accent"
    >
      {label}
      <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
        ›
      </span>
    </Link>
  )
}
