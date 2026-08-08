import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import {
  buildDeploymentIndex,
  DELIVERY_PREDICATES,
  type DeliveryPredicate,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueFilter,
  type IssueGrouping,
  type IssuePriority,
  type IssueSort,
  type IssueSortKey,
  type IssueStatus,
  mutators,
  newId,
  queries,
  type TeamDeploymentRow,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { IssueRow } from '@yapm/ui/components/issue-row'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@yapm/ui/components/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@yapm/ui/components/popover'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import {
  buildRealityShape,
  formatReviewAge,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import { CheckIcon, PlusIcon } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import { cycleKey } from '@/cycles/model'
import { Masthead } from '@/frame/masthead'
import { CommandProvider, useCommand } from '@/issues/command'
import {
  DIVERGENCE_LABEL,
  deliveryView,
  type LinkedIssueRow,
  linkedEntitiesFor,
} from '@/issues/delivery'
import {
  buildGroups,
  DEFAULT_GROUPING,
  DEFAULT_SORT,
  type IssueGroup,
  type IssueRowData,
  isPendingNumber,
  issueKey,
  type ListGrouping,
  NO_CYCLE,
  NO_PROJECT,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
  UNASSIGNED,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

const GROUPING_LABEL: Record<ListGrouping, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  cycle: 'Cycle',
  project: 'Project',
  none: 'No grouping',
}

// The three reality-derived predicates. A team with no connector still sees all three offered:
// where a predicate has no linked data it matches nothing rather than being hidden, so the axis
// never implies the facts do not exist.
const DELIVERY_LABEL: Record<DeliveryPredicate, string> = {
  'blocked-on-review': 'Blocked on review',
  'failing-ci': 'Failing CI',
  'merged-not-deployed': 'Merged, not deployed',
}

const SORT_LABEL: Record<IssueSortKey, string> = {
  priority: 'Priority',
  status: 'Status',
  assignee: 'Assignee',
  updated: 'Last updated',
  created: 'Created',
  number: 'Number',
}

// One rendered page. The fold below states the true remainder, so this is a rendering bound and
// never a claim about how much work matches — `ordered` stays the whole filtered set, and so do
// the masthead count, the selection targets and the palette's context.
const VISIBLE_ROW_CAP = 50

// The mock's `≔` — the filter axes' shared mark, drawn once at the head of the row. Decorative:
// each axis carries its own accessible name.
function FilterMark() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 14 14"
      className="flex-none text-text-3"
    >
      <path
        d="M2 3.5h10M3.5 7h7M5.5 10.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface TeamMemberOption {
  id: string
  name: string
}

export function IssueList({
  teamId,
  openIssueId,
  lens,
}: {
  teamId: string
  openIssueId?: string
  // Band 2's lens slot, owned by the route: List | Board. Board is a lens on Issues, not a peer
  // destination, so the toggle lives in the masthead and the bar keeps ONE current stop.
  lens?: ReactNode
}) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [issuesRaw, issuesResult] = useQuery(queries.issues.byTeam({ teamId }))
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [projects] = useQuery(queries.projects.all())
  // The same team-scoped query issue-detail already subscribes to, unchanged. The deployment ->
  // merged-PR match is a computed join, so the list needs the team's deployments to evaluate
  // `merged-not-deployed` and to render the strip's deploy glyph.
  const [deployments] = useQuery(queries.deployments.byTeam({ teamId }))
  // Indexed once for the whole list, not rescanned per row: the join is `repo + merge commit`, so
  // one pass over the team's deployments serves every issue (design §Risks).
  const deployIndex = useMemo(
    () => buildDeploymentIndex(deployments as readonly TeamDeploymentRow[]),
    [deployments],
  )

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const memberOptions = useMemo<TeamMemberOption[]>(() => {
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return { id: membership.userId, name: user?.name ?? user?.email ?? membership.userId }
    })
  }, [team, users])

  const rows = useMemo<IssueRowData[]>(
    () =>
      issuesRaw.map((issue) => ({
        id: issue.id,
        number: issue.number ?? null,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId ?? null,
        rank: issue.rank ?? null,
        cycleId: issue.cycleId ?? null,
        projectId: issue.projectId ?? null,
        updatedAt: issue.updatedAt,
        createdAt: issue.createdAt,
        labels: (
          (issue.labels ?? []) as readonly { id: string; name: string; color: string }[]
        ).map((label) => ({ id: label.id, name: label.name, color: label.color })),
        assignee: issue.assignee
          ? {
              id: issue.assignee.id,
              name: issue.assignee.name,
              email: issue.assignee.email,
              image: issue.assignee.image,
            }
          : null,
        linked: linkedEntitiesFor(
          (issue as { issueLinks?: readonly LinkedIssueRow[] }).issueLinks,
          deployIndex,
        ),
      })),
    [issuesRaw, deployIndex],
  )

  const onOpenIssue = useCallback(
    (issue: IssueRowData) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: { open: issue.id } })
    },
    [navigate, teamId],
  )

  if (!team) {
    return (
      // Labels, not sentences: this page carries no explanatory prose at all.
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || issuesResult.type === 'complete' ? 'Team not found' : 'Loading…'}
      </p>
    )
  }

  return (
    <CommandProvider teamId={teamId} issues={rows}>
      <IssueListBody
        teamId={teamId}
        teamKey={teamKey}
        team={team}
        rows={rows}
        memberOptions={memberOptions}
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
        projectOptions={projects.map((project) => ({ id: project.id, name: project.name }))}
        openIssueId={openIssueId}
        onOpenIssue={onOpenIssue}
        {...(lens === undefined ? {} : { lens })}
      />
    </CommandProvider>
  )
}

interface CycleOption {
  id: string
  name: string
  number: number | null
}

interface ProjectOption {
  id: string
  name: string
}

interface IssueListBodyProps {
  teamId: string
  teamKey: string
  team: { name: string; key: string }
  rows: readonly IssueRowData[]
  memberOptions: readonly TeamMemberOption[]
  labelOptions: readonly { id: string; name: string; color: string }[]
  cycleOptions: readonly CycleOption[]
  projectOptions: readonly ProjectOption[]
  openIssueId?: string
  onOpenIssue: (issue: IssueRowData) => void
  lens?: ReactNode
}

function IssueListBody({
  teamId,
  teamKey,
  team,
  rows,
  memberOptions,
  labelOptions,
  cycleOptions,
  projectOptions,
  openIssueId,
  onOpenIssue,
  lens,
}: IssueListBodyProps) {
  const command = useCommand()
  const [savedViews] = useQuery(queries.savedViews.byTeam({ teamId }))

  const [filter, setFilter] = useState<IssueFilter>({})
  const [grouping, setGrouping] = useState<ListGrouping>(DEFAULT_GROUPING)
  const [cycleFilter, setCycleFilter] = useState<readonly (string | null)[] | undefined>(undefined)
  const [projectFilter, setProjectFilter] = useState<readonly (string | null)[] | undefined>(
    undefined,
  )
  const [sort, setSort] = useState<IssueSort>(DEFAULT_SORT)
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const [cap, setCap] = useState(VISIBLE_ROW_CAP)
  const containerRef = useRef<HTMLElement>(null)
  const foldRef = useRef<HTMLButtonElement>(null)
  // The index the fold must land focus on once the newly revealed rows have mounted.
  const revealedRef = useRef<number | null>(null)

  const assigneeName = useCallback(
    (id: string) => memberOptions.find((member) => member.id === id)?.name ?? id,
    [memberOptions],
  )

  const cycleName = useCallback(
    (id: string) => cycleOptions.find((cycle) => cycle.id === id)?.name ?? id,
    [cycleOptions],
  )

  const projectName = useCallback(
    (id: string) => projectOptions.find((project) => project.id === id)?.name ?? id,
    [projectOptions],
  )

  const { groups, ordered } = useMemo(
    () =>
      buildGroups(rows, {
        filter,
        grouping,
        sort,
        teamKey,
        assigneeName,
        cycleName,
        projectName,
        ...(cycleFilter ? { cycleIds: cycleFilter } : {}),
        ...(projectFilter ? { projectIds: projectFilter } : {}),
      }),
    [
      rows,
      filter,
      grouping,
      sort,
      teamKey,
      assigneeName,
      cycleName,
      projectName,
      cycleFilter,
      projectFilter,
    ],
  )

  const visibleCount = Math.min(cap, ordered.length)
  const hiddenCount = ordered.length - visibleCount

  // A new filter is a new result, so the fold starts closed again — otherwise a cap raised on a
  // hundred rows would silently render every row of the next, narrower query.
  // The query, not the result, is what re-closes the fold: a row arriving over sync must not
  // collapse a page the member opened.
  useEffect(() => {
    setCap(VISIBLE_ROW_CAP)
  }, [filter, grouping, sort, cycleFilter, projectFilter])

  // Keep focus in range as the filtered set changes.
  useEffect(() => {
    setFocusIndex((prev) => Math.min(prev, Math.max(0, visibleCount - 1)))
  }, [visibleCount])

  const targets = useMemo(() => {
    if (selection.size > 0) return [...selection]
    const current = ordered[focusIndex]
    return current ? [current.id] : []
  }, [selection, ordered, focusIndex])

  // Feed the ambient palette target (⌘K acts on the focused/selected issue). Writes a ref in
  // the provider, so this never re-renders the list.
  useEffect(() => {
    command.setContextIssues(targets)
  }, [command, targets])

  const focusRow = useCallback((index: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.focus()
  }, [])

  const move = useCallback(
    (delta: number) => {
      setFocusIndex((prev) => {
        // Down from the last rendered row reaches the fold rather than stopping dead, so the
        // hidden remainder is reachable without a pointer.
        if (delta > 0 && prev >= visibleCount - 1 && hiddenCount > 0) {
          foldRef.current?.focus()
          return prev
        }
        const next = Math.max(0, Math.min(visibleCount - 1, prev + delta))
        focusRow(next)
        return next
      })
    },
    [visibleCount, hiddenCount, focusRow],
  )

  // Focus lands on the first newly revealed row, once it has mounted.
  useEffect(() => {
    const target = revealedRef.current
    if (target === null) return
    revealedRef.current = null
    setFocusIndex(target)
    focusRow(target)
  }, [cap, focusRow])

  const openFold = useCallback(() => {
    revealedRef.current = Math.min(visibleCount, ordered.length - 1)
    setCap((prev) => prev + VISIBLE_ROW_CAP)
  }, [visibleCount, ordered.length])

  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (ordered.length === 0) return
      // The fold is a real button: the browser already turns Enter and Space on it into a click,
      // and the row model must not also read those as "open the focused issue".
      if (event.target === foldRef.current) {
        if (event.key === 'k' || event.key === 'ArrowUp') {
          event.preventDefault()
          focusRow(visibleCount - 1)
          setFocusIndex(visibleCount - 1)
        }
        return
      }
      const current = ordered[focusIndex]
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
        case 'x':
          if (current) {
            event.preventDefault()
            toggleSelect(current.id)
          }
          break
        case 'Enter':
        case 'ArrowRight':
          if (current) {
            event.preventDefault()
            onOpenIssue(current)
          }
          break
        case 'c':
          event.preventDefault()
          command.openCreate()
          break
        case 's':
          if (targets.length > 0) {
            event.preventDefault()
            command.openStatus(targets)
          }
          break
        case 'a':
          if (targets.length > 0) {
            event.preventDefault()
            command.openAssign(targets)
          }
          break
        case 'l':
          if (targets.length > 0) {
            event.preventDefault()
            command.openLabel(targets)
          }
          break
        case 'p':
          if (targets.length > 0) {
            event.preventDefault()
            command.openProject(targets)
          }
          break
        default:
          break
      }
    },
    [
      ordered,
      focusIndex,
      move,
      toggleSelect,
      onOpenIssue,
      command,
      targets,
      focusRow,
      visibleCount,
    ],
  )

  const applySavedView = useCallback(
    (view: { filter: unknown; grouping: unknown; sort: unknown }) => {
      setFilter((view.filter as IssueFilter) ?? {})
      setGrouping((view.grouping as IssueGrouping) ?? DEFAULT_GROUPING)
      setSort((view.sort as IssueSort) ?? DEFAULT_SORT)
    },
    [],
  )

  let runningIndex = 0

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <Toolbar
        count={ordered.length}
        {...(lens === undefined ? {} : { lens })}
        filter={filter}
        setFilter={setFilter}
        grouping={grouping}
        setGrouping={setGrouping}
        sort={sort}
        setSort={setSort}
        memberOptions={memberOptions}
        labelOptions={labelOptions}
        cycleOptions={cycleOptions}
        cycleFilter={cycleFilter}
        setCycleFilter={setCycleFilter}
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        setProjectFilter={setProjectFilter}
        savedViews={savedViews}
        applySavedView={applySavedView}
        teamId={teamId}
        onNewIssue={() => command.openCreate()}
      />

      <section
        ref={containerRef}
        className="flex-1 overflow-y-auto pb-10 outline-none"
        onKeyDown={onKeyDown}
        aria-label={`${team.name} issues`}
      >
        {ordered.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            No matches
          </p>
        ) : (
          groups.map((group) => {
            const startIndex = runningIndex
            runningIndex += group.issues.length
            if (startIndex >= cap) return null
            return (
              <IssueGroupSection
                key={group.key}
                group={group}
                startIndex={startIndex}
                cap={cap}
                focusIndex={focusIndex}
                selection={selection}
                teamKey={teamKey}
                openIssueId={openIssueId}
                onFocusRow={setFocusIndex}
                onOpenIssue={onOpenIssue}
                onToggleSelect={toggleSelect}
              />
            )
          })
        )}

        {hiddenCount > 0 ? (
          // The count is a subtraction over the true filtered length — never a constant, never an
          // estimate, and never a truncation the page declines to mention.
          <button
            ref={foldRef}
            type="button"
            data-testid="issue-fold"
            onClick={openFold}
            className="px-5 py-3.5 text-left font-mono text-[11.5px] text-text-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            ↓ {hiddenCount} more
          </button>
        ) : null}
      </section>
    </div>
  )
}

function IssueGroupSection({
  group,
  startIndex,
  cap,
  focusIndex,
  selection,
  teamKey,
  openIssueId,
  onFocusRow,
  onOpenIssue,
  onToggleSelect,
}: {
  group: IssueGroup
  startIndex: number
  cap: number
  focusIndex: number
  selection: ReadonlySet<string>
  teamKey: string
  openIssueId?: string
  onFocusRow: (index: number) => void
  onOpenIssue: (issue: IssueRowData) => void
  onToggleSelect: (id: string) => void
}) {
  return (
    <section className="border-b border-border" aria-label={group.label}>
      {/* The mock's quiet tinted band: the grouping's own mark, the label, the filtered count. */}
      <div className="flex h-[var(--density-group-header)] items-center gap-2.5 border-t border-row-hairline bg-bg-hover px-5">
        {group.status ? (
          <StatusGlyph status={STATUS_TO_KIND[group.status]} />
        ) : group.priority ? (
          <PriorityMark priority={PRIORITY_TO_KIND[group.priority]} />
        ) : group.color ? (
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ backgroundColor: group.color }}
          />
        ) : null}
        <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
          {group.label}
        </span>
        {/* The count after filtering, not after the fold: the group states how much matches. */}
        <span className="font-mono text-[11.5px] text-text-2">{group.issues.length}</span>
      </div>
      {group.issues.map((issue, offset) => {
        const index = startIndex + offset
        if (index >= cap) return null
        const pending = isPendingNumber(issue)
        const view = deliveryView(issue, issue.linked ?? {})
        return (
          <IssueRow
            key={issue.id}
            data-index={index}
            data-issue-id={issue.id}
            data-testid="issue-row"
            data-pending={pending || undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-current={openIssueId === issue.id ? 'true' : undefined}
            issueKey={issueKey(teamKey, issue)}
            title={issue.title}
            status={STATUS_TO_KIND[issue.status]}
            priority={PRIORITY_TO_KIND[issue.priority]}
            labels={(issue.labels ?? []).map((label) => ({ name: label.name, color: label.color }))}
            date={formatRelative(issue.updatedAt)}
            selected={selection.has(issue.id)}
            phrase={<RestPhraseText phrase={view.phrase} />}
            realityTrack={
              <RealityTrack
                shape={buildRealityShape(view.strip, { divergence: view.divergence })}
                // `null`, never omitted: the row's age column is reserved whether or not this
                // issue has an age to put in it, which is what keeps the list's alignment fixed.
                age={
                  view.strip?.reviewAgeMs == null ? null : formatReviewAge(view.strip.reviewAgeMs)
                }
                label={realityTrackLabel(
                  view.strip,
                  view.divergence ? DIVERGENCE_LABEL[view.divergence] : null,
                )}
              />
            }
            {...(issue.assignee
              ? {
                  assignee: {
                    name: issue.assignee.name ?? issue.assignee.email ?? issue.assignee.id,
                    ...(issue.assignee.image ? { src: issue.assignee.image } : {}),
                  },
                }
              : {})}
            onFocus={() => onFocusRow(index)}
            onClick={() => onOpenIssue(issue)}
            onKeyDownCapture={(event) => {
              // Space toggles selection on the focused row without scrolling.
              if (event.key === ' ') {
                event.preventDefault()
                onToggleSelect(issue.id)
              }
            }}
          />
        )
      })}
    </section>
  )
}

interface ToolbarProps {
  count: number
  lens?: ReactNode
  filter: IssueFilter
  setFilter: (next: IssueFilter) => void
  grouping: ListGrouping
  setGrouping: (next: ListGrouping) => void
  sort: IssueSort
  setSort: (next: IssueSort) => void
  memberOptions: readonly TeamMemberOption[]
  labelOptions: readonly { id: string; name: string; color: string }[]
  cycleOptions: readonly CycleOption[]
  cycleFilter: readonly (string | null)[] | undefined
  setCycleFilter: (next: readonly (string | null)[] | undefined) => void
  projectOptions: readonly ProjectOption[]
  projectFilter: readonly (string | null)[] | undefined
  setProjectFilter: (next: readonly (string | null)[] | undefined) => void
  savedViews: readonly {
    id: string
    name: string
    filter: unknown
    grouping: unknown
    sort: unknown
  }[]
  applySavedView: (view: { filter: unknown; grouping: unknown; sort: unknown }) => void
  teamId: string
  onNewIssue: () => void
}

function Toolbar({
  lens,
  count,
  filter,
  setFilter,
  grouping,
  setGrouping,
  sort,
  setSort,
  memberOptions,
  labelOptions,
  cycleOptions,
  cycleFilter,
  setCycleFilter,
  projectOptions,
  projectFilter,
  setProjectFilter,
  savedViews,
  applySavedView,
  teamId,
  onNewIssue,
}: ToolbarProps) {
  const patch = (next: Partial<IssueFilter>) => setFilter({ ...filter, ...next })

  return (
    <Masthead
      // The deck one band above already reads the team; repeating it here is a word the diet does
      // not pay for, and Board's masthead already reads `Issues`.
      title="Issues"
      count={count}
      {...(lens === undefined ? {} : { lens })}
      actions={
        <>
          <SavedViewControls
            teamId={teamId}
            filter={filter}
            grouping={grouping}
            sort={sort}
            savedViews={savedViews}
            applySavedView={applySavedView}
          />
          <Button size="sm" onClick={onNewIssue} data-testid="new-issue">
            <PlusIcon />
            New issue
          </Button>
        </>
      }
      meta={
        <div className="-mt-0.5 flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          <FilterMark />

          <FilterMenu
            label="Status"
            options={ISSUE_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABEL[status],
              icon: <StatusGlyph status={STATUS_TO_KIND[status]} />,
            }))}
            selected={(filter.status ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                status: toggle(
                  filter.status as readonly IssueStatus[] | undefined,
                  value as IssueStatus,
                ),
              })
            }
          />
          <FilterMenu
            label="Priority"
            options={ISSUE_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABEL[priority],
              icon: <PriorityMark priority={PRIORITY_TO_KIND[priority]} />,
            }))}
            selected={(filter.priority ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                priority: toggle(
                  filter.priority as readonly IssuePriority[] | undefined,
                  value as IssuePriority,
                ),
              })
            }
          />
          <FilterMenu
            label="Assignee"
            options={[
              { value: UNASSIGNED, label: 'Unassigned' },
              ...memberOptions.map((member) => ({ value: member.id, label: member.name })),
            ]}
            selected={(filter.assigneeIds ?? []).map((id) => id ?? UNASSIGNED)}
            onToggle={(value) => {
              const real = value === UNASSIGNED ? null : value
              patch({ assigneeIds: toggle(filter.assigneeIds, real) })
            }}
          />
          <FilterMenu
            label="Delivery"
            options={DELIVERY_PREDICATES.map((predicate) => ({
              value: predicate,
              label: DELIVERY_LABEL[predicate],
            }))}
            selected={(filter.delivery ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                delivery: toggle(
                  filter.delivery as readonly DeliveryPredicate[] | undefined,
                  value as DeliveryPredicate,
                ),
              })
            }
          />
          {labelOptions.length > 0 ? (
            <FilterMenu
              label="Label"
              options={labelOptions.map((label) => ({
                value: label.id,
                label: label.name,
                icon: (
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                ),
              }))}
              selected={filter.labelIds ?? []}
              onToggle={(value) => patch({ labelIds: toggle(filter.labelIds, value) })}
            />
          ) : null}
          {cycleOptions.length > 0 ? (
            <FilterMenu
              label="Cycle"
              options={[
                { value: NO_CYCLE, label: 'No cycle' },
                ...cycleOptions.map((cycle) => ({
                  value: cycle.id,
                  label: `${cycle.name} · ${cycleKey(cycle)}`,
                })),
              ]}
              selected={(cycleFilter ?? []).map((id) => id ?? NO_CYCLE)}
              onToggle={(value) => {
                const real = value === NO_CYCLE ? null : value
                setCycleFilter(toggle(cycleFilter, real))
              }}
            />
          ) : null}
          {projectOptions.length > 0 ? (
            <FilterMenu
              label="Project"
              options={[
                { value: NO_PROJECT, label: 'No project' },
                ...projectOptions.map((project) => ({ value: project.id, label: project.name })),
              ]}
              selected={(projectFilter ?? []).map((id) => id ?? NO_PROJECT)}
              onToggle={(value) => {
                const real = value === NO_PROJECT ? null : value
                setProjectFilter(toggle(projectFilter, real))
              }}
            />
          ) : null}

          {/* The mock draws no search field — ⌘K carries search in band 1. Cutting the field
              would cut a capability, so it stays, quiet: no border, no icon, no width it does not
              need. */}
          <Input
            aria-label="Search issues"
            placeholder="Search…"
            value={filter.text ?? ''}
            onChange={(event) => patch({ text: event.target.value || undefined })}
            className="h-6 w-32 rounded-none border-0 border-b border-transparent bg-transparent px-0 text-[12.5px] shadow-none placeholder:text-text-3 focus-visible:border-b-accent focus-visible:ring-0"
          />

          <div className="ml-auto flex items-center gap-1.5 text-text-3">
            <span className="flex items-center gap-1">
              Group
              <GroupSelect grouping={grouping} setGrouping={setGrouping} />
            </span>
            <span aria-hidden="true">·</span>
            <SortMenu sort={sort} setSort={setSort} />
          </div>
        </div>
      }
    />
  )
}

// Stays a native `<select>` on purpose: `cycles.spec.ts` drives it with `selectOption`, a keyboard
// assertion that already passes, and the mock renders this control as one word. Only the register
// changes — transparent, borderless, the current value bold.
function GroupSelect({
  grouping,
  setGrouping,
}: {
  grouping: ListGrouping
  setGrouping: (next: ListGrouping) => void
}) {
  return (
    <Select
      aria-label="Group by"
      value={grouping}
      onChange={(event) => setGrouping(event.target.value as ListGrouping)}
      className="h-6 w-auto rounded-none border-0 bg-transparent py-0 pr-5 pl-0 font-semibold text-[12.5px] text-text-2 shadow-none focus-visible:ring-0"
    >
      {(Object.keys(GROUPING_LABEL) as ListGrouping[]).map((value) => (
        <option key={value} value={value}>
          {GROUPING_LABEL[value]}
        </option>
      ))}
    </Select>
  )
}

// Sort is the one control that could NOT stay a pair of native selects: direction is a toggle, not
// a value list. Key and direction fold into one menu, and the direction's accessible names survive
// as explicit `Sort ascending` / `Sort descending` items.
function SortMenu({ sort, setSort }: { sort: IssueSort; setSort: (next: IssueSort) => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Sort by"
            className="rounded-control px-0.5 whitespace-nowrap text-text-3 transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sort <span className="font-semibold text-text-2">{SORT_LABEL[sort.key]}</span>
          </button>
        }
      />
      <MenuContent className="max-h-72 overflow-y-auto">
        {(Object.keys(SORT_LABEL) as IssueSortKey[]).map((value) => (
          <MenuItem
            key={value}
            closeOnClick={false}
            onClick={() => setSort({ ...sort, key: value })}
            className="justify-between"
          >
            {SORT_LABEL[value]}
            {sort.key === value ? <CheckIcon className="size-3.5 text-accent-strong" /> : null}
          </MenuItem>
        ))}
        {(['asc', 'desc'] as const).map((direction) => (
          <MenuItem
            key={direction}
            closeOnClick={false}
            aria-label={`Sort ${direction === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() => setSort({ ...sort, direction })}
            className="justify-between border-border border-t text-text-2"
          >
            {direction === 'asc' ? 'Ascending' : 'Descending'}
            {sort.direction === direction ? (
              <CheckIcon className="size-3.5 text-accent-strong" />
            ) : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function FilterMenu({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: readonly { value: string; label: string; icon?: ReactNode }[]
  selected: readonly string[]
  onToggle: (value: string) => void
}) {
  const selectedSet = new Set(selected)
  return (
    <Menu>
      {/* Plain text, as the mock draws it — the accessible name is what four e2e specs drive, and
          it is preserved verbatim through the re-registering. */}
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Filter by ${label}`}
            className={cn(
              'rounded-control px-0.5 whitespace-nowrap transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              selectedSet.size > 0 ? 'text-text-1' : 'text-text-2',
            )}
          >
            {label}
            {selectedSet.size > 0 ? (
              <span className="ml-1 font-mono text-[10.5px] text-accent-strong">
                {selectedSet.size}
              </span>
            ) : null}
          </button>
        }
      />
      <MenuContent className="max-h-72 overflow-y-auto">
        {options.map((option) => (
          <MenuItem
            key={option.value}
            closeOnClick={false}
            onClick={() => onToggle(option.value)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
            {selectedSet.has(option.value) ? (
              <CheckIcon className="size-3.5 text-accent-strong" />
            ) : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function SavedViewControls({
  teamId,
  filter,
  grouping,
  sort,
  savedViews,
  applySavedView,
}: {
  teamId: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
  savedViews: readonly {
    id: string
    name: string
    filter: unknown
    grouping: unknown
    sort: unknown
  }[]
  applySavedView: (view: { filter: unknown; grouping: unknown; sort: unknown }) => void
}) {
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      {savedViews.length > 0 ? (
        <Select
          aria-label="Saved view"
          className="h-6 w-auto rounded-none border-0 bg-transparent py-0 pr-5 pl-0 text-[12.5px] text-text-2 shadow-none focus-visible:ring-0"
          defaultValue=""
          onChange={(event) => {
            const view = savedViews.find((candidate) => candidate.id === event.target.value)
            if (view) applySavedView(view)
          }}
        >
          <option value="">Views</option>
          {savedViews.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </Select>
      ) : null}
      <SaveViewButton teamId={teamId} filter={filter} grouping={grouping} sort={sort} />
    </div>
  )
}

function SaveViewButton({
  teamId,
  filter,
  grouping,
  sort,
}: {
  teamId: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
}) {
  const { canWrite } = useMembership()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const saver = useSaveView()

  if (!canWrite) return null

  async function save() {
    if (name.trim().length === 0) return
    const failure = await saver({ teamId, name: name.trim(), filter, grouping, sort })
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setName('')
    setError(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Save current view"
            className="rounded-control px-0.5 whitespace-nowrap text-[12.5px] text-text-2 transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Save view
          </button>
        }
      />
      <PopoverContent className="w-64">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            autoFocus
            aria-label="View name"
            placeholder="View name…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error !== undefined ? (
            <p className="text-xs text-status-urgent" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={name.trim().length === 0}>
            Save view
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function toggle<T>(list: readonly T[] | undefined, value: T): T[] | undefined {
  const current = list ?? []
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  return next.length === 0 ? undefined : next
}

interface SaveViewInput {
  teamId: string
  name: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
}

// Saved views persist only the schema groupings; the web-only cycle/project groupings fall
// back to the default when a view is saved.
function persistableGrouping(grouping: ListGrouping): IssueGrouping {
  return grouping === 'cycle' || grouping === 'project' ? DEFAULT_GROUPING : grouping
}

function useSaveView(): (input: SaveViewInput) => Promise<string | undefined> {
  const zero = useZero()
  return useCallback(
    ({ teamId, name, filter, grouping, sort }) => {
      const now = Date.now()
      return runMutation(
        zero.mutate(
          mutators.savedView.create({
            id: newId(),
            teamId,
            name,
            filter: filter as unknown as ReadonlyJSONValue,
            grouping: persistableGrouping(grouping),
            sort: sort as unknown as ReadonlyJSONValue,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      )
    },
    [zero],
  )
}
