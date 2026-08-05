import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import {
  ISSUE_STATUSES,
  type IssueStatus,
  mutators,
  newId,
  queries,
  rankBetween,
} from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@yapm/ui/components/command-palette'
import { SearchResultRow } from '@yapm/ui/components/search-result-row'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import {
  ArrowRightIcon,
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  CircleDotIcon,
  GaugeIcon,
  InboxIcon,
  PlusIcon,
  RocketIcon,
  RouteIcon,
  SearchIcon,
  TagIcon,
  UserIcon,
  UserXIcon,
  XIcon,
} from 'lucide-react'
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import { type IssueRowData, STATUS_LABEL, STATUS_TO_KIND } from '@/issues/model'
import { runMutation } from '@/lib/mutation'
import { useSearchCursor } from '@/search/cursor'
import { filterPaletteGroups, type PaletteGroup, type PaletteRow } from '@/search/palette-rows'
import { localSearchRows, type SearchRow } from '@/search/results'
import {
  SEARCH_EMPTY_REFINE,
  SEARCH_EMPTY_STALE,
  SEARCH_GROUP_LOCAL,
  SEARCH_GROUP_SERVER,
  searchAnnouncement,
  searchEmptyHeadline,
  searchEverythingLabel,
  serverGroupLine,
} from '@/search/states'
import { useLocalSearchCorpus } from '@/search/use-local-corpus'
import { useOpenSearchResult } from '@/search/use-open-result'
import { useDedupedServerRows } from '@/search/use-server-rows'
import { useServerSearch } from '@/search/use-server-search'

type PalettePage = 'root' | 'status' | 'assign' | 'label' | 'project' | 'create'

// Both result groups are capped small: Cmd-K is a launcher, and a launcher that fills its viewport
// with hits has stopped being one. The "search everything" row below them is where depth lives.
const PALETTE_GROUP_LIMIT = 5

const ESCALATE_ROW_ID = 'search:everything'

// Shared rather than a fresh literal: the sub-pages render no result rows at all, and a new empty
// array each render would re-key the cursor's row list for nothing.
const NO_SEARCH_ROWS: readonly SearchRow[] = []

interface CommandApi {
  open: () => void
  openStatus: (ids: readonly string[]) => void
  openAssign: (ids: readonly string[]) => void
  openLabel: (ids: readonly string[]) => void
  openProject: (ids: readonly string[]) => void
  openCreate: () => void
  setContextIssues: (ids: readonly string[]) => void
}

const CommandContext = createContext<CommandApi | null>(null)

export function useCommand(): CommandApi {
  const value = useContext(CommandContext)
  if (!value) throw new Error('useCommand must be used within CommandProvider')
  return value
}

interface CommandProviderProps {
  teamId: string
  issues: readonly IssueRowData[]
  children: ReactNode
}

interface TeamMember {
  id: string
  name: string
  image?: string | null
}

/**
 * The palette owns its own filtering, ordering and cursor.
 *
 * `cmdk`'s built-in scorer re-sorts items within a group AND groups by their best item's score, so
 * appending a "From the server" group after the debounced request resolves would re-order every
 * group above it — a list that moves between the arrow key and Enter. `shouldFilter={false}` turns
 * that off; the shared search core filters every group, action rows included, over a stable
 * declaration order, and the active row is controlled and keyed to a row IDENTITY, so an append
 * cannot move it.
 *
 * Both groups mean the same scope — the open team — so the palette never answers a question its
 * two halves disagree about. `/search` is where the workspace-wide answer lives.
 */
export function CommandProvider({ teamId, issues, children }: CommandProviderProps) {
  const zero = useZero()
  const navigate = useNavigate()
  const openResult = useOpenSearchResult()
  const { userId, canWrite } = useMembership()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [projects] = useQuery(queries.projects.all())

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<PalettePage>('root')
  const [targetIds, setTargetIds] = useState<readonly string[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  // Bumped by every `start`, and read by the cursor as its session key. The provider outlives the
  // dialog, so a cursor left behind by the last visit is state the next visit must not inherit.
  const [session, setSession] = useState(0)
  const contextRef = useRef<readonly string[]>([])

  const isRoot = page === 'root'
  const corpus = useLocalSearchCorpus(teamId)
  // A closed palette, and every page that is not the launcher, asks the server nothing: the hook's
  // minimum-length rule turns an empty query into no request at all.
  const server = useServerSearch(open && isRoot ? search : '', {
    teamId,
    limit: PALETTE_GROUP_LIMIT,
  })

  const members = useMemo<TeamMember[]>(() => {
    const team = teams.find((candidate) => candidate.id === teamId)
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return {
        id: membership.userId,
        name: user?.name ?? user?.email ?? membership.userId,
        image: user?.image ?? null,
      }
    })
  }, [teams, users, teamId])

  const start = useCallback((next: PalettePage, ids: readonly string[]) => {
    setTargetIds(ids)
    setPage(next)
    setSearch('')
    setError(undefined)
    setSession((previous) => previous + 1)
    setOpen(true)
  }, [])

  const api = useMemo<CommandApi>(
    () => ({
      open: () => start('root', contextRef.current),
      openStatus: (ids) => start('status', ids),
      openAssign: (ids) => start('assign', ids),
      openLabel: (ids) => start('label', ids),
      openProject: (ids) => start('project', ids),
      openCreate: () => start('create', []),
      setContextIssues: (ids) => {
        contextRef.current = ids
      },
    }),
    [start],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        start('root', contextRef.current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const runAll = useCallback(
    async (writes: ReturnType<typeof zero.mutate>[]) => {
      for (const write of writes) {
        const failure = await runMutation(write)
        if (failure !== undefined) {
          setError(failure)
          return
        }
      }
      close()
    },
    [close],
  )

  const applyStatus = useCallback(
    (status: IssueStatus) => {
      const now = Date.now()
      void runAll(
        targetIds.map((id) =>
          zero.mutate(mutators.issue.setStatus({ id, status, updatedAt: now })),
        ),
      )
    },
    [runAll, targetIds, zero],
  )

  const applyAssign = useCallback(
    (assigneeId: string | null) => {
      const now = Date.now()
      void runAll(
        targetIds.map((id) =>
          zero.mutate(mutators.issue.assign({ id, assigneeId, updatedAt: now })),
        ),
      )
    },
    [runAll, targetIds, zero],
  )

  const applyLabel = useCallback(
    (labelId: string) => {
      const now = Date.now()
      void runAll(
        targetIds.map((issueId) =>
          zero.mutate(mutators.issue.addLabel({ issueId, labelId, createdAt: now })),
        ),
      )
    },
    [runAll, targetIds, zero],
  )

  const applyProject = useCallback(
    (projectId: string | null) => {
      const now = Date.now()
      void runAll(
        targetIds.map((id) =>
          zero.mutate(mutators.issue.setProject({ id, projectId, updatedAt: now })),
        ),
      )
    },
    [runAll, targetIds, zero],
  )

  const applyTriage = useCallback(
    (kind: 'flag' | 'accept' | 'decline') => {
      const now = Date.now()
      const build = (id: string) => {
        if (kind === 'flag') return mutators.issue.flagTriage({ id, updatedAt: now })
        if (kind === 'accept') return mutators.issue.acceptTriage({ id, updatedAt: now })
        return mutators.issue.declineTriage({ id, updatedAt: now })
      }
      void runAll(targetIds.map((id) => zero.mutate(build(id))))
    },
    [runAll, targetIds, zero],
  )

  // The same shared mutator the inbox's own control calls, so the palette path is authorized and
  // applied identically — and self-scoped by construction: the recipient comes from the verified
  // context, so there is no way to spell "somebody else's inbox" here.
  const markAllNotificationsRead = useCallback(() => {
    void runAll([zero.mutate(mutators.notification.markAllRead({ readAt: Date.now() }))])
  }, [runAll, zero])

  const createIssue = useCallback(
    (title: string) => {
      const now = Date.now()
      // Mint the rank at the call site (constraint #4, extended to rank): append after the
      // current maximum rank of the destination Todo column so the new card lands last and the
      // column stays densely ranked. Client-computed and passed in, never inside the mutator.
      const maxRank = issues.reduce<string | null>(
        (max, issue) =>
          issue.status === 'todo' &&
          typeof issue.rank === 'string' &&
          (max === null || issue.rank > max)
            ? issue.rank
            : max,
        null,
      )
      void runAll([
        zero.mutate(
          mutators.issue.create({
            id: newId(),
            teamId,
            title,
            status: 'todo',
            priority: 'no_priority',
            rank: rankBetween(maxRank, null),
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ])
    },
    [issues, runAll, teamId, zero],
  )

  const hasTarget = targetIds.length > 0
  const targetLabel =
    targetIds.length === 1
      ? (issues.find((issue) => issue.id === targetIds[0])?.title ?? 'issue')
      : `${targetIds.length} issues`

  const navigateTeam = useCallback(
    (id: string) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId: id }, search: {} })
      close()
    },
    [navigate, close],
  )

  const navigateTeamDelivery = useCallback(
    (id: string) => {
      void navigate({
        to: '/teams/$teamId/delivery',
        params: { teamId: id },
        search: { window: 6 },
      })
      close()
    },
    [navigate, close],
  )

  const actionGroups = useMemo<PaletteGroup[]>(() => {
    switch (page) {
      case 'root':
        return rootActionGroups({
          teams,
          canWrite,
          hasTarget,
          onCreate: () => start('create', []),
          onStatus: () => start('status', targetIds),
          onAssign: () => start('assign', targetIds),
          onLabel: () => start('label', targetIds),
          onProject: () => start('project', targetIds),
          onAcceptTriage: () => applyTriage('accept'),
          onDeclineTriage: () => applyTriage('decline'),
          onFlagTriage: () => applyTriage('flag'),
          onRouteTriage: () => {
            void navigate({ to: '/teams/$teamId/triage', params: { teamId } })
            close()
          },
          onMarkAllNotificationsRead: markAllNotificationsRead,
          onNavigateInbox: () => {
            void navigate({ to: '/inbox' })
            close()
          },
          onNavigateHome: () => {
            void navigate({ to: '/' })
            close()
          },
          onNavigateTeam: navigateTeam,
          onNavigateTeamDelivery: navigateTeamDelivery,
        })
      case 'status':
        return statusGroups(applyStatus)
      case 'assign':
        return assignGroups(members, userId, applyAssign)
      case 'label':
        return labelGroups(labels, applyLabel)
      case 'project':
        return projectGroups(projects, applyProject)
      case 'create':
        return []
    }
  }, [
    page,
    teams,
    canWrite,
    hasTarget,
    targetIds,
    members,
    userId,
    labels,
    projects,
    applyStatus,
    applyAssign,
    applyLabel,
    applyProject,
    applyTriage,
    markAllNotificationsRead,
    navigateTeam,
    navigateTeamDelivery,
    navigate,
    close,
    start,
    teamId,
  ])

  const visibleGroups = useMemo(
    () => filterPaletteGroups(actionGroups, search),
    [actionGroups, search],
  )

  const localRows = useMemo(
    () => (isRoot ? localSearchRows(corpus.search(search, PALETTE_GROUP_LIMIT), teamId) : []),
    [isRoot, corpus, search, teamId],
  )
  const dedupedServerRows = useDedupedServerRows(search, localRows, server.results)
  const serverRows = isRoot ? dedupedServerRows : NO_SEARCH_ROWS

  const escalate = isRoot && search.trim().length > 0
  const rowIds = useMemo(() => {
    const ids = visibleGroups.flatMap((group) => group.rows.map((row) => row.id))
    ids.push(...localRows.map((row) => row.id))
    if (escalate) ids.push(ESCALATE_ROW_ID)
    ids.push(...serverRows.map((row) => row.id))
    return ids
  }, [visibleGroups, localRows, serverRows, escalate])

  const { active, setActive } = useSearchCursor(rowIds, session)

  const serverState = {
    phase: server.phase,
    resultCount: serverRows.length,
    // Never truncated HERE. The palette asks for five rows, so `server.truncated` is true for
    // almost every real query, and D17's cap line names the route's limit rather than this one.
    // "There is more" is the escalation row directly above this group, which is a better answer on
    // a launcher than a sentence. The route shows the cap line, over the full fifty.
    truncated: false,
  }
  const nothingMatched =
    isRoot &&
    search.trim().length > 0 &&
    visibleGroups.length === 0 &&
    localRows.length === 0 &&
    serverRows.length === 0 &&
    server.phase === 'ready'
  const serverLine = nothingMatched ? undefined : serverGroupLine(serverState)

  const openRow = useCallback(
    (row: SearchRow) => {
      openResult(row.target)
      close()
    },
    [openResult, close],
  )

  return (
    <CommandContext.Provider value={api}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        shouldFilter={false}
        value={active}
        onValueChange={setActive}
      >
        {page === 'create' ? (
          <CreateIssueForm onSubmit={createIssue} onCancel={close} error={error} />
        ) : (
          <>
            <CommandInput
              placeholder={placeholderFor(page, targetLabel)}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              {visibleGroups.map((group) => (
                <CommandGroup key={group.id} heading={group.heading}>
                  {group.rows.map((row) => (
                    <CommandItem key={row.id} value={row.id} onSelect={row.onSelect}>
                      {row.content}
                      {row.shortcut === undefined ? null : (
                        <CommandShortcut>{row.shortcut}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {localRows.length > 0 ? (
                <CommandGroup heading={SEARCH_GROUP_LOCAL}>
                  {localRows.map((row) => (
                    <ResultItem
                      key={row.id}
                      row={row}
                      active={row.id === active}
                      onOpen={openRow}
                    />
                  ))}
                </CommandGroup>
              ) : null}
              {isRoot ? (
                <>
                  {/* The escalation row sits ABOVE the server group, not below it. Server results
                      arrive last and must therefore be the last rows in the list: a persistent row
                      underneath them would be pushed down every time the group answered, which is
                      the same reflow the two-group seam exists to prevent — just at the bottom. */}
                  {escalate ? (
                    <CommandGroup>
                      <CommandItem
                        value={ESCALATE_ROW_ID}
                        onSelect={() => {
                          void navigate({ to: '/search', search: { q: search } })
                          close()
                        }}
                      >
                        <SearchIcon />
                        {searchEverythingLabel(search)}
                      </CommandItem>
                    </CommandGroup>
                  ) : null}
                  {/* `alwaysRender`: cmdk hides a separator the moment the input has text, and the
                      seam between the two passes is precisely what H12 asked to stay visible. */}
                  <CommandSeparator alwaysRender />
                  <CommandGroup heading={SEARCH_GROUP_SERVER}>
                    {serverRows.map((row) => (
                      <ResultItem
                        key={row.id}
                        row={row}
                        active={row.id === active}
                        onOpen={openRow}
                      />
                    ))}
                    {serverLine === undefined ? null : (
                      <p
                        className="px-2 py-1.5 font-ui text-[13px] text-text-3"
                        data-testid="palette-server-state"
                      >
                        {serverLine}
                      </p>
                    )}
                  </CommandGroup>
                  {nothingMatched ? (
                    <div className="flex flex-col gap-1 px-2 py-4" data-testid="palette-empty">
                      <p className="font-ui text-sm text-text-1">{searchEmptyHeadline(search)}</p>
                      <p className="font-ui text-[13px] text-text-3">{SEARCH_EMPTY_REFINE}</p>
                      <p className="font-ui text-[13px] text-text-3">{SEARCH_EMPTY_STALE}</p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </CommandList>
            {isRoot ? (
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                data-testid="palette-announcement"
              >
                {searchAnnouncement(localRows.length, serverState)}
              </p>
            ) : null}
            {error !== undefined ? (
              <div
                className="border-t border-border px-4 py-2 text-xs text-status-urgent"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <CommandFooter>
              <span>↑↓ to navigate</span>
              <span>↵ to select</span>
              <span>esc to close</span>
              <span className="ml-auto font-bold text-text-3">yapm</span>
            </CommandFooter>
          </>
        )}
      </CommandDialog>
    </CommandContext.Provider>
  )
}

// `active` is threaded from the palette's own cursor rather than read back out of `cmdk`: the
// cursor is controlled here (D8), so this component already knows. Without it the row would carry
// only `CommandItem`'s wash and lose the accent rule, and the same primitive would look different
// selected in the palette than it does on `/search`.
function ResultItem({
  row,
  active,
  onOpen,
}: {
  row: SearchRow
  active: boolean
  onOpen: (row: SearchRow) => void
}) {
  return (
    <CommandItem value={row.id} onSelect={() => onOpen(row)} className="h-auto p-0">
      <SearchResultRow
        kind={row.kind}
        issueKey={row.issueKey}
        title={row.title}
        snippet={row.snippet}
        states={row.states}
        active={active}
        className="rounded-control"
      />
    </CommandItem>
  )
}

function placeholderFor(page: PalettePage, target: string): string {
  switch (page) {
    case 'status':
      return `Set status of ${target}…`
    case 'assign':
      return `Assign ${target}…`
    case 'label':
      return `Add label to ${target}…`
    case 'project':
      return `Move ${target} to project…`
    default:
      return 'Type a command or search…'
  }
}

interface RootActions {
  teams: readonly { id: string; name: string }[]
  canWrite: boolean
  hasTarget: boolean
  onCreate: () => void
  onStatus: () => void
  onAssign: () => void
  onLabel: () => void
  onProject: () => void
  onAcceptTriage: () => void
  onDeclineTriage: () => void
  onFlagTriage: () => void
  onRouteTriage: () => void
  onMarkAllNotificationsRead: () => void
  onNavigateInbox: () => void
  onNavigateHome: () => void
  onNavigateTeam: (id: string) => void
  onNavigateTeamDelivery: (id: string) => void
}

// The action rows as DATA, in declaration order. Each `search` string is the value the row used to
// hand `cmdk`, so what makes a row match is unchanged — only who applies the match moved.
function rootActionGroups(actions: RootActions): PaletteGroup[] {
  const groups: PaletteGroup[] = [
    {
      id: 'create',
      heading: 'Create',
      rows: [
        {
          id: 'action:create-issue',
          search: 'new issue create',
          shortcut: 'C',
          onSelect: actions.onCreate,
          content: (
            <>
              <PlusIcon />
              New issue
            </>
          ),
        },
      ],
    },
  ]

  if (actions.hasTarget && actions.canWrite) {
    groups.push(
      {
        id: 'issue',
        heading: 'Issue',
        rows: [
          {
            id: 'action:status',
            search: 'change status',
            shortcut: 'S',
            onSelect: actions.onStatus,
            content: (
              <>
                <CircleDotIcon />
                Change status…
              </>
            ),
          },
          {
            id: 'action:assign',
            search: 'assign',
            shortcut: 'A',
            onSelect: actions.onAssign,
            content: (
              <>
                <UserIcon />
                Assign…
              </>
            ),
          },
          {
            id: 'action:label',
            search: 'add label',
            shortcut: 'L',
            onSelect: actions.onLabel,
            content: (
              <>
                <TagIcon />
                Add label…
              </>
            ),
          },
          {
            id: 'action:project',
            search: 'move to project',
            shortcut: 'P',
            onSelect: actions.onProject,
            content: (
              <>
                <RocketIcon />
                Move to project…
              </>
            ),
          },
        ],
      },
      {
        id: 'triage',
        heading: 'Triage',
        rows: [
          {
            id: 'action:triage-accept',
            search: 'accept from triage',
            onSelect: actions.onAcceptTriage,
            content: (
              <>
                <CheckIcon />
                Accept from triage
              </>
            ),
          },
          {
            id: 'action:triage-route',
            search: 'route issue triage',
            onSelect: actions.onRouteTriage,
            content: (
              <>
                <RouteIcon />
                Route…
              </>
            ),
          },
          {
            id: 'action:triage-decline',
            search: 'decline triage cancel',
            onSelect: actions.onDeclineTriage,
            content: (
              <>
                <XIcon />
                Decline (cancel)
              </>
            ),
          },
          {
            id: 'action:triage-flag',
            search: 'send to triage',
            onSelect: actions.onFlagTriage,
            content: (
              <>
                <InboxIcon />
                Send to triage
              </>
            ),
          },
        ],
      },
    )
  }

  // Not gated on a selected issue: marking your own inbox read is never about the issues the
  // palette happens to be pointed at.
  groups.push(
    {
      id: 'notifications',
      heading: 'Notifications',
      rows: [
        {
          id: 'action:notifications-read-all',
          search: 'mark all notifications as read inbox',
          onSelect: actions.onMarkAllNotificationsRead,
          content: (
            <>
              <CheckCheckIcon />
              Mark all notifications as read
            </>
          ),
        },
      ],
    },
    {
      id: 'navigate',
      heading: 'Navigate',
      rows: [
        {
          id: 'action:go-inbox',
          search: 'go to inbox notifications',
          onSelect: actions.onNavigateInbox,
          content: (
            <>
              <BellIcon />
              Go to inbox
            </>
          ),
        },
        {
          id: 'action:go-home',
          search: 'go to workspace overview',
          onSelect: actions.onNavigateHome,
          content: (
            <>
              <ArrowRightIcon />
              Go to workspace overview
            </>
          ),
        },
        ...actions.teams.map((team) => ({
          id: `action:go-team:${team.id}`,
          search: `go to ${team.name} issues`,
          onSelect: () => actions.onNavigateTeam(team.id),
          content: (
            <>
              <ArrowRightIcon />
              Go to {team.name} issues
            </>
          ),
        })),
        ...actions.teams.map((team) => ({
          id: `action:go-team-delivery:${team.id}`,
          search: `go to ${team.name} delivery metrics dora flow`,
          onSelect: () => actions.onNavigateTeamDelivery(team.id),
          content: (
            <>
              <GaugeIcon />
              Go to {team.name} delivery
            </>
          ),
        })),
      ],
    },
  )

  return groups
}

function statusGroups(onPick: (status: IssueStatus) => void): PaletteGroup[] {
  return [
    {
      id: 'status',
      heading: 'Change status',
      rows: ISSUE_STATUSES.map((status) => ({
        id: `status:${status}`,
        search: `set status ${STATUS_LABEL[status]}`,
        onSelect: () => onPick(status),
        content: (
          <>
            <StatusGlyph status={STATUS_TO_KIND[status]} />
            Set status: {STATUS_LABEL[status]}
          </>
        ),
      })),
    },
  ]
}

function assignGroups(
  members: readonly TeamMember[],
  meId: string | null,
  onPick: (assigneeId: string | null) => void,
): PaletteGroup[] {
  const rows: PaletteRow[] = []
  if (meId) {
    rows.push({
      id: 'assign:me',
      search: 'assign to me',
      shortcut: 'I',
      onSelect: () => onPick(meId),
      content: (
        <>
          <UserIcon />
          Assign to me
        </>
      ),
    })
  }
  rows.push({
    id: 'assign:none',
    search: 'unassign',
    onSelect: () => onPick(null),
    content: (
      <>
        <UserXIcon />
        Unassign
      </>
    ),
  })
  for (const member of members) {
    if (member.id === meId) continue
    rows.push({
      id: `assign:${member.id}`,
      search: `assign to ${member.name}`,
      onSelect: () => onPick(member.id),
      content: (
        <>
          <Avatar size="xs">
            {member.image ? <AvatarImage src={member.image} alt={member.name} /> : null}
            <AvatarFallback aria-label={member.name}>{initials(member.name)}</AvatarFallback>
          </Avatar>
          Assign to {member.name}
        </>
      ),
    })
  }
  return [{ id: 'assign', heading: 'Assign', rows }]
}

function labelGroups(
  labels: readonly { id: string; name: string; color: string }[],
  onPick: (labelId: string) => void,
): PaletteGroup[] {
  return [
    {
      id: 'label',
      heading: 'Add label',
      rows: labels.map((label) => ({
        id: `label:${label.id}`,
        search: `add label ${label.name}`,
        onSelect: () => onPick(label.id),
        content: (
          <>
            <span className="size-3 rounded-full" style={{ backgroundColor: label.color }} />
            {label.name}
          </>
        ),
      })),
    },
  ]
}

function projectGroups(
  projects: readonly { id: string; name: string }[],
  onPick: (projectId: string | null) => void,
): PaletteGroup[] {
  return [
    {
      id: 'project',
      heading: 'Move to project',
      rows: [
        {
          id: 'project:none',
          search: 'remove from project none',
          onSelect: () => onPick(null),
          content: (
            <>
              <XIcon />
              No project
            </>
          ),
        },
        ...projects.map((project) => ({
          id: `project:${project.id}`,
          search: `move to project ${project.name}`,
          onSelect: () => onPick(project.id),
          content: (
            <>
              <RocketIcon />
              {project.name}
            </>
          ),
        })),
      ],
    },
  ]
}

function CreateIssueForm({
  onSubmit,
  onCancel,
  error,
}: {
  onSubmit: (title: string) => void
  onCancel: () => void
  error: string | undefined
}) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function commit() {
    if (title.trim().length === 0) return
    onSubmit(title.trim())
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    commit()
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      <div className="flex h-[54px] items-center gap-3 border-b border-border px-4">
        <PlusIcon aria-hidden="true" className="size-4 shrink-0 text-text-3" />
        <input
          ref={inputRef}
          aria-label="New issue title"
          placeholder="Issue title…"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            // The form is mounted inside cmdk's Command root, whose keydown handler claims
            // Enter (item selection) and the arrows. Shield those keys so the composer keeps
            // its own submit/cancel semantics.
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              commit()
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              onCancel()
            }
          }}
          className="flex-1 bg-transparent text-base text-text-1 placeholder:text-text-3 outline-none"
        />
      </div>
      {error !== undefined ? (
        <div className="px-4 py-2 text-xs text-status-urgent" role="alert">
          {error}
        </div>
      ) : null}
      <CommandFooter>
        <span>↵ to create</span>
        <span>esc to cancel</span>
        <span className="ml-auto font-bold text-text-3">yapm</span>
      </CommandFooter>
    </form>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
