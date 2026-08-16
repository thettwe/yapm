import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import {
  buildDeploymentIndex,
  DEFAULT_ISSUE_STATUS_FILTER,
  type IssueFilter,
  type IssueGrouping,
  type IssueSort,
  queries,
  type TeamDeploymentRow,
} from '@yapm/schema'
import { IssueRow } from '@yapm/ui/components/issue-row'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import {
  buildRealityShape,
  formatReviewAge,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CommandProvider, useCommand } from '@/issues/command'
import {
  DIVERGENCE_LABEL,
  deliveryView,
  type LinkedIssueRow,
  linkedEntitiesFor,
  quietWords,
} from '@/issues/delivery'
import {
  type CycleOption,
  FilterBar,
  GroupSelect,
  type ProjectOption,
  SortMenu,
  type TeamMemberOption,
} from '@/issues/filter-bar'
import {
  buildGroups,
  DEFAULT_GROUPING,
  DEFAULT_SORT,
  formatRelative,
  type IssueGroup,
  type IssueRowData,
  isPendingNumber,
  issueKey,
  type ListGrouping,
  PRIORITY_TO_KIND,
  STATUS_TO_KIND,
} from '@/issues/model'

// One rendered page, counted in ISSUES rather than in row slots. The fold below states the true
// remainder, so this is a rendering bound and never a claim about how much work matches — the
// masthead count stays the whole filtered set.
const VISIBLE_ROW_CAP = 50

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

  const [filter, setFilter] = useState<IssueFilter>(DEFAULT_ISSUE_STATUS_FILTER)
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
  // The issues on screen when the fold was pressed. Focus lands on the first row that is not one
  // of them — an index cannot stand in for that, because raising the cap can reveal a row ABOVE
  // the last visible one (a newly admitted issue's first slot sits wherever its group does).
  const revealedRef = useRef<ReadonlySet<string> | null>(null)

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

  const { groups, ordered, count } = useMemo(
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

  // The page is cut in ISSUES, not in row slots: `cap` and the fold's remainder then speak the
  // same unit as the masthead. The visible set is the first `cap` DISTINCT ids in `ordered`, and a
  // repeated issue's later slots come with it — so under label grouping a page that holds every
  // matching issue draws every one of their rows, and `hiddenCount === 0` means nothing is hidden
  // rather than "nothing is hidden except the rows we truncated".
  const { visibleGroups, visible, visibleIds, hiddenCount } = useMemo(() => {
    const ids = new Set<string>()
    for (const issue of ordered) {
      if (ids.size >= cap) break
      ids.add(issue.id)
    }
    const shown = groups
      .map((group) => ({ group, issues: group.issues.filter((issue) => ids.has(issue.id)) }))
      .filter((entry) => entry.issues.length > 0)
    return {
      visibleGroups: shown,
      visible: shown.flatMap((entry) => entry.issues),
      visibleIds: ids as ReadonlySet<string>,
      hiddenCount: count - ids.size,
    }
  }, [groups, ordered, cap, count])

  const visibleCount = visible.length

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
    const current = visible[focusIndex]
    return current ? [current.id] : []
  }, [selection, visible, focusIndex])

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
    const previous = revealedRef.current
    if (previous === null) return
    revealedRef.current = null
    const target = visible.findIndex((issue) => !previous.has(issue.id))
    if (target < 0) return
    setFocusIndex(target)
    focusRow(target)
  }, [visible, focusRow])

  const openFold = useCallback(() => {
    revealedRef.current = visibleIds
    setCap((prev) => prev + VISIBLE_ROW_CAP)
  }, [visibleIds])

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
      if (visible.length === 0) return
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
      const current = visible[focusIndex]
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
      visible,
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
      <FilterBar
        count={count}
        {...(lens === undefined ? {} : { lens })}
        filter={filter}
        setFilter={setFilter}
        grouping={grouping}
        sort={sort}
        trailing={
          <>
            <span className="flex items-center gap-1">
              Group
              <GroupSelect grouping={grouping} setGrouping={setGrouping} />
            </span>
            <span aria-hidden="true">·</span>
            <SortMenu sort={sort} setSort={setSort} />
          </>
        }
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
        {visible.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            No matches
          </p>
        ) : (
          visibleGroups.map(({ group, issues }) => {
            const startIndex = runningIndex
            runningIndex += issues.length
            return (
              <IssueGroupSection
                key={group.key}
                group={group}
                issues={issues}
                startIndex={startIndex}
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
          // The count is a subtraction over the true filtered ISSUE count — never a constant,
          // never an estimate, and never a truncation the page declines to mention.
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
  issues,
  startIndex,
  focusIndex,
  selection,
  teamKey,
  openIssueId,
  onFocusRow,
  onOpenIssue,
  onToggleSelect,
}: {
  group: IssueGroup
  // The group's rows on THIS page. Equal to `group.issues` whenever nothing is folded away, which
  // is what makes the header's count and the rows beneath it agree.
  issues: readonly IssueRowData[]
  startIndex: number
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
      {issues.map((issue, offset) => {
        const index = startIndex + offset
        const pending = isPendingNumber(issue)
        const view = deliveryView(issue, issue.linked ?? {}, 'news')
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
                  quietWords(view.phrase),
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
