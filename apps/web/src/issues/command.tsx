import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { ISSUE_STATUSES, type IssueStatus, mutators, newId, queries } from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@yapm/ui/components/command-palette'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { ArrowRightIcon, CircleDotIcon, PlusIcon, TagIcon, UserIcon, UserXIcon } from 'lucide-react'
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
import { type IssueRowData, issueKey, STATUS_LABEL, STATUS_TO_KIND } from '@/issues/model'
import { runMutation } from '@/lib/mutation'

type PalettePage = 'root' | 'status' | 'assign' | 'label' | 'create'

interface CommandApi {
  open: () => void
  openStatus: (ids: readonly string[]) => void
  openAssign: (ids: readonly string[]) => void
  openLabel: (ids: readonly string[]) => void
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
  teamKey: string
  issues: readonly IssueRowData[]
  onOpenIssue: (issue: IssueRowData) => void
  children: ReactNode
}

interface TeamMember {
  id: string
  name: string
  image?: string | null
}

export function CommandProvider({
  teamId,
  teamKey,
  issues,
  onOpenIssue,
  children,
}: CommandProviderProps) {
  const zero = useZero()
  const navigate = useNavigate()
  const { userId, canWrite } = useMembership()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<PalettePage>('root')
  const [targetIds, setTargetIds] = useState<readonly string[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const contextRef = useRef<readonly string[]>([])

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
    setOpen(true)
  }, [])

  const api = useMemo<CommandApi>(
    () => ({
      open: () => start('root', contextRef.current),
      openStatus: (ids) => start('status', ids),
      openAssign: (ids) => start('assign', ids),
      openLabel: (ids) => start('label', ids),
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

  const createIssue = useCallback(
    (title: string) => {
      const now = Date.now()
      void runAll([
        zero.mutate(
          mutators.issue.create({
            id: newId(),
            teamId,
            title,
            status: 'todo',
            priority: 'no_priority',
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ])
    },
    [runAll, teamId, zero],
  )

  const hasTarget = targetIds.length > 0
  const targetLabel =
    targetIds.length === 1
      ? (issues.find((issue) => issue.id === targetIds[0])?.title ?? 'issue')
      : `${targetIds.length} issues`

  return (
    <CommandContext.Provider value={api}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} label="Command palette">
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
              {page === 'root' ? (
                <RootPage
                  issues={issues}
                  teamKey={teamKey}
                  teams={teams}
                  canWrite={canWrite}
                  hasTarget={hasTarget}
                  onOpenIssue={(issue) => {
                    onOpenIssue(issue)
                    close()
                  }}
                  onNavigateTeam={(id) => {
                    void navigate({ to: '/teams/$teamId/issues', params: { teamId: id } })
                    close()
                  }}
                  onNavigateHome={() => {
                    void navigate({ to: '/' })
                    close()
                  }}
                  onCreate={() => start('create', [])}
                  onStatus={() => start('status', targetIds)}
                  onAssign={() => start('assign', targetIds)}
                  onLabel={() => start('label', targetIds)}
                />
              ) : null}
              {page === 'status' ? <StatusPage onPick={applyStatus} /> : null}
              {page === 'assign' ? (
                <AssignPage members={members} meId={userId} onPick={applyAssign} />
              ) : null}
              {page === 'label' ? <LabelPage labels={labels} onPick={applyLabel} /> : null}
            </CommandList>
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

function placeholderFor(page: PalettePage, target: string): string {
  switch (page) {
    case 'status':
      return `Set status of ${target}…`
    case 'assign':
      return `Assign ${target}…`
    case 'label':
      return `Add label to ${target}…`
    default:
      return 'Type a command or search…'
  }
}

function RootPage({
  issues,
  teamKey,
  teams,
  canWrite,
  hasTarget,
  onOpenIssue,
  onNavigateTeam,
  onNavigateHome,
  onCreate,
  onStatus,
  onAssign,
  onLabel,
}: {
  issues: readonly IssueRowData[]
  teamKey: string
  teams: readonly { id: string; name: string }[]
  canWrite: boolean
  hasTarget: boolean
  onOpenIssue: (issue: IssueRowData) => void
  onNavigateTeam: (id: string) => void
  onNavigateHome: () => void
  onCreate: () => void
  onStatus: () => void
  onAssign: () => void
  onLabel: () => void
}) {
  return (
    <>
      <CommandGroup heading="Create">
        <CommandItem value="new issue create" onSelect={onCreate}>
          <PlusIcon />
          New issue
          <CommandShortcut>C</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      {hasTarget && canWrite ? (
        <CommandGroup heading="Issue">
          <CommandItem value="change status" onSelect={onStatus}>
            <CircleDotIcon />
            Change status…
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
          <CommandItem value="assign" onSelect={onAssign}>
            <UserIcon />
            Assign…
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
          <CommandItem value="add label" onSelect={onLabel}>
            <TagIcon />
            Add label…
            <CommandShortcut>L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      ) : null}
      <CommandGroup heading="Navigate">
        <CommandItem value="go to workspace overview" onSelect={onNavigateHome}>
          <ArrowRightIcon />
          Go to workspace overview
        </CommandItem>
        {teams.map((team) => (
          <CommandItem
            key={team.id}
            value={`go to ${team.name} issues`}
            onSelect={() => onNavigateTeam(team.id)}
          >
            <ArrowRightIcon />
            Go to {team.name} issues
          </CommandItem>
        ))}
      </CommandGroup>
      {issues.length > 0 ? (
        <CommandGroup heading="Jump to issue">
          {issues.map((issue) => (
            <CommandItem
              key={issue.id}
              value={`${issueKey(teamKey, issue)} ${issue.title}`}
              onSelect={() => onOpenIssue(issue)}
            >
              <StatusGlyph status={STATUS_TO_KIND[issue.status]} />
              <span className="font-mono text-xs text-text-3">{issueKey(teamKey, issue)}</span>
              <span className="truncate">{issue.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  )
}

function StatusPage({ onPick }: { onPick: (status: IssueStatus) => void }) {
  return (
    <CommandGroup heading="Change status">
      {ISSUE_STATUSES.map((status) => (
        <CommandItem
          key={status}
          value={`set status ${STATUS_LABEL[status]}`}
          onSelect={() => onPick(status)}
        >
          <StatusGlyph status={STATUS_TO_KIND[status]} />
          Set status: {STATUS_LABEL[status]}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function AssignPage({
  members,
  meId,
  onPick,
}: {
  members: readonly TeamMember[]
  meId: string | null
  onPick: (assigneeId: string | null) => void
}) {
  return (
    <CommandGroup heading="Assign">
      {meId ? (
        <CommandItem value="assign to me" onSelect={() => onPick(meId)}>
          <UserIcon />
          Assign to me
          <CommandShortcut>I</CommandShortcut>
        </CommandItem>
      ) : null}
      <CommandItem value="unassign" onSelect={() => onPick(null)}>
        <UserXIcon />
        Unassign
      </CommandItem>
      {members
        .filter((member) => member.id !== meId)
        .map((member) => (
          <CommandItem
            key={member.id}
            value={`assign to ${member.name}`}
            onSelect={() => onPick(member.id)}
          >
            <Avatar size="xs">
              {member.image ? <AvatarImage src={member.image} alt={member.name} /> : null}
              <AvatarFallback aria-label={member.name}>{initials(member.name)}</AvatarFallback>
            </Avatar>
            Assign to {member.name}
          </CommandItem>
        ))}
    </CommandGroup>
  )
}

function LabelPage({
  labels,
  onPick,
}: {
  labels: readonly { id: string; name: string; color: string }[]
  onPick: (labelId: string) => void
}) {
  if (labels.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-text-3">No labels in this team yet.</div>
    )
  }
  return (
    <CommandGroup heading="Add label">
      {labels.map((label) => (
        <CommandItem
          key={label.id}
          value={`add label ${label.name}`}
          onSelect={() => onPick(label.id)}
        >
          <span className="size-3 rounded-full" style={{ backgroundColor: label.color }} />
          {label.name}
        </CommandItem>
      ))}
    </CommandGroup>
  )
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
