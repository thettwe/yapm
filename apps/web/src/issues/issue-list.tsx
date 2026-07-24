import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import {
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
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { IssueRow } from '@yapm/ui/components/issue-row'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@yapm/ui/components/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@yapm/ui/components/popover'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
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
import { CommandProvider, useCommand } from '@/issues/command'
import {
  buildGroups,
  DEFAULT_GROUPING,
  DEFAULT_SORT,
  type IssueGroup,
  type IssueRowData,
  isPendingNumber,
  issueKey,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
  UNASSIGNED,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

const GROUPING_LABEL: Record<IssueGrouping, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  none: 'No grouping',
}

const SORT_LABEL: Record<IssueSortKey, string> = {
  priority: 'Priority',
  status: 'Status',
  assignee: 'Assignee',
  updated: 'Last updated',
  created: 'Created',
  number: 'Number',
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

export function IssueList({ teamId, openIssueId }: { teamId: string; openIssueId?: string }) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [issuesRaw, issuesResult] = useQuery(queries.issues.byTeam({ teamId }))
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))

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
      })),
    [issuesRaw],
  )

  const onOpenIssue = useCallback(
    (issue: IssueRowData) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: { open: issue.id } })
    },
    [navigate, teamId],
  )

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || issuesResult.type === 'complete'
          ? 'This team no longer exists.'
          : 'Loading team…'}
      </p>
    )
  }

  return (
    <CommandProvider teamId={teamId} teamKey={teamKey} issues={rows} onOpenIssue={onOpenIssue}>
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
        openIssueId={openIssueId}
        onOpenIssue={onOpenIssue}
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
  openIssueId?: string
  onOpenIssue: (issue: IssueRowData) => void
}

function IssueListBody({
  teamId,
  teamKey,
  team,
  rows,
  memberOptions,
  labelOptions,
  openIssueId,
  onOpenIssue,
}: IssueListBodyProps) {
  const command = useCommand()
  const [savedViews] = useQuery(queries.savedViews.byTeam({ teamId }))

  const [filter, setFilter] = useState<IssueFilter>({})
  const [grouping, setGrouping] = useState<IssueGrouping>(DEFAULT_GROUPING)
  const [sort, setSort] = useState<IssueSort>(DEFAULT_SORT)
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const containerRef = useRef<HTMLElement>(null)

  const assigneeName = useCallback(
    (id: string) => memberOptions.find((member) => member.id === id)?.name ?? id,
    [memberOptions],
  )

  const { groups, ordered } = useMemo(
    () => buildGroups(rows, { filter, grouping, sort, teamKey, assigneeName }),
    [rows, filter, grouping, sort, teamKey, assigneeName],
  )

  // Keep focus in range as the filtered set changes.
  useEffect(() => {
    setFocusIndex((prev) => Math.min(prev, Math.max(0, ordered.length - 1)))
  }, [ordered.length])

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
        const next = Math.max(0, Math.min(ordered.length - 1, prev + delta))
        focusRow(next)
        return next
      })
    },
    [ordered.length, focusRow],
  )

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
        default:
          break
      }
    },
    [ordered, focusIndex, move, toggleSelect, onOpenIssue, command, targets],
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
        team={team}
        count={ordered.length}
        filter={filter}
        setFilter={setFilter}
        grouping={grouping}
        setGrouping={setGrouping}
        sort={sort}
        setSort={setSort}
        memberOptions={memberOptions}
        labelOptions={labelOptions}
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
            No issues match the current filters.
          </p>
        ) : (
          groups.map((group) => {
            const startIndex = runningIndex
            runningIndex += group.issues.length
            return (
              <IssueGroupSection
                key={group.key}
                group={group}
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
      </section>
    </div>
  )
}

function IssueGroupSection({
  group,
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
      <div className="flex h-[var(--density-group-header)] items-center gap-2.5 bg-bg-sidebar/60 px-4">
        {group.status ? (
          <StatusGlyph status={STATUS_TO_KIND[group.status]} />
        ) : group.priority ? (
          <PriorityMark priority={PRIORITY_TO_KIND[group.priority]} />
        ) : null}
        <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
          {group.label}
        </span>
        <span className="font-mono text-xs text-text-3">{group.issues.length}</span>
      </div>
      {group.issues.map((issue, offset) => {
        const index = startIndex + offset
        const pending = isPendingNumber(issue)
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
  team: { name: string }
  count: number
  filter: IssueFilter
  setFilter: (next: IssueFilter) => void
  grouping: IssueGrouping
  setGrouping: (next: IssueGrouping) => void
  sort: IssueSort
  setSort: (next: IssueSort) => void
  memberOptions: readonly TeamMemberOption[]
  labelOptions: readonly { id: string; name: string; color: string }[]
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
  team,
  count,
  filter,
  setFilter,
  grouping,
  setGrouping,
  sort,
  setSort,
  memberOptions,
  labelOptions,
  savedViews,
  applySavedView,
  teamId,
  onNewIssue,
}: ToolbarProps) {
  const patch = (next: Partial<IssueFilter>) => setFilter({ ...filter, ...next })

  return (
    <header className="flex flex-col gap-2 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <StatusGlyph status="in-progress" aria-hidden="true" />
        <h1 className="text-sm font-semibold tracking-tight text-text-1">{team.name} · Issues</h1>
        <span className="ml-1 font-mono text-xs text-text-3">{count}</span>
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 size-3.5 text-text-3"
          />
          <Input
            aria-label="Search issues"
            placeholder="Search…"
            value={filter.text ?? ''}
            onChange={(event) => patch({ text: event.target.value || undefined })}
            className="h-7 w-48 pl-8 text-sm"
          />
        </div>

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
        {labelOptions.length > 0 ? (
          <FilterMenu
            label="Label"
            options={labelOptions.map((label) => ({
              value: label.id,
              label: label.name,
              icon: (
                <span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />
              ),
            }))}
            selected={filter.labelIds ?? []}
            onToggle={(value) => patch({ labelIds: toggle(filter.labelIds, value) })}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-text-3">
            Group
            <Select
              aria-label="Group by"
              value={grouping}
              onChange={(event) => setGrouping(event.target.value as IssueGrouping)}
              className="h-7 w-32"
            >
              {(Object.keys(GROUPING_LABEL) as IssueGrouping[]).map((value) => (
                <option key={value} value={value}>
                  {GROUPING_LABEL[value]}
                </option>
              ))}
            </Select>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-3">
            Sort
            <Select
              aria-label="Sort by"
              value={sort.key}
              onChange={(event) => setSort({ ...sort, key: event.target.value as IssueSortKey })}
              className="h-7 w-32"
            >
              {(Object.keys(SORT_LABEL) as IssueSortKey[]).map((value) => (
                <option key={value} value={value}>
                  {SORT_LABEL[value]}
                </option>
              ))}
            </Select>
          </span>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`Sort ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() =>
              setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
            }
          >
            <ChevronDownIcon className={sort.direction === 'asc' ? 'rotate-180' : ''} />
          </Button>
        </div>
      </div>
    </header>
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
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`Filter by ${label}`}>
            <ListFilterIcon />
            {label}
            {selectedSet.size > 0 ? (
              <span className="ml-1 font-mono text-[10.5px] text-accent-strong">
                {selectedSet.size}
              </span>
            ) : null}
          </Button>
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
  grouping: IssueGrouping
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
    <div className="flex items-center gap-2">
      {savedViews.length > 0 ? (
        <Select
          aria-label="Saved view"
          className="h-7 w-40"
          defaultValue=""
          onChange={(event) => {
            const view = savedViews.find((candidate) => candidate.id === event.target.value)
            if (view) applySavedView(view)
          }}
        >
          <option value="">Saved views…</option>
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
  grouping: IssueGrouping
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
          <Button variant="outline" size="sm" aria-label="Save current view">
            <BookmarkIcon />
            Save view
          </Button>
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
  grouping: IssueGrouping
  sort: IssueSort
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
            grouping,
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
