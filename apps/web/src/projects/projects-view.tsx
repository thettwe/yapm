import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { How } from '@yapm/ui/components/how'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Masthead } from '@/frame/masthead'
import {
  formatTargetDay,
  groupProjectsByStatus,
  PROJECT_STATUS_TO_KIND,
  type ProjectIssueRow,
  type ProjectRowData,
  pastTargetReading,
  projectProgress,
  teamSplit,
} from '@/projects/model'
import { initials, NewProjectButton, ScopeChip, type UserOption } from '@/projects/project-controls'
import { ProjectPage } from '@/projects/project-page'
import { useProjectRows } from '@/projects/use-project-rows'

// `?open=<id>` is a project's own page; without it this route is the index. One route, two
// surfaces — the roadmap already navigates by that search param and so does the e2e.
export function ProjectsView({
  teamId,
  openProjectId,
}: {
  teamId: string
  openProjectId?: string
}) {
  if (openProjectId !== undefined) {
    return <ProjectPage teamId={teamId} projectId={openProjectId} />
  }
  return <ProjectsIndex teamId={teamId} />
}

// The width the mock gives each slot, kept as constants because the QUIET version of every one of
// them has to reserve exactly the measure the populated one does.
const TEAM_SLOT = 'w-[132px] flex-none'
const METER_SLOT = 'w-24 flex-none'
const COUNT_SLOT = 'w-11 flex-none text-right'
const TARGET_SLOT = 'w-[76px] flex-none text-right'

function ProjectsIndex({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [workspace] = useQuery(queries.workspace.current())
  const { projects, issuesByProject, complete } = useProjectRows()

  const teamKeys = useMemo(
    () => new Map(teams.map((team) => [team.id, team.key] as const)),
    [teams],
  )

  const groups = useMemo(() => groupProjectsByStatus(projects), [projects])
  const ordered = useMemo(() => groups.flatMap((group) => group.projects), [groups])

  const [focusIndex, setFocusIndex] = useState(0)
  const containerRef = useRef<HTMLElement>(null)

  // Keep the roving tabindex on a MOUNTED row when the ordered set shrinks, so focus never falls
  // to <body> and the keyboard keeps working.
  useEffect(() => {
    setFocusIndex((prev) => Math.min(prev, Math.max(0, ordered.length - 1)))
  }, [ordered.length])

  const focusRow = useCallback((index: number) => {
    containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus()
  }, [])

  const openProject = useCallback(
    (project: ProjectRowData) => {
      void navigate({
        to: '/teams/$teamId/projects',
        params: { teamId },
        search: { open: project.id },
      })
    },
    [navigate, teamId],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // Only keys pressed ON a row: a `how ·` panel keeps its own Enter and Escape.
      if (!(event.target instanceof HTMLElement) || event.target.dataset.slot !== 'project-row') {
        return
      }
      if (ordered.length === 0) return
      switch (event.key) {
        case 'j':
        case 'ArrowDown': {
          event.preventDefault()
          const next = Math.min(ordered.length - 1, focusIndex + 1)
          setFocusIndex(next)
          focusRow(next)
          break
        }
        case 'k':
        case 'ArrowUp': {
          event.preventDefault()
          const next = Math.max(0, focusIndex - 1)
          setFocusIndex(next)
          focusRow(next)
          break
        }
        case 'Enter': {
          const project = ordered[focusIndex]
          if (project) {
            event.preventDefault()
            openProject(project)
          }
          break
        }
        default:
          break
      }
    },
    [ordered, focusIndex, focusRow, openProject],
  )

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user] as const)), [users])
  const workspaceName = workspace?.name ?? null

  let runningIndex = 0

  return (
    <>
      <Masthead
        title="Projects"
        {...(complete ? { count: projects.length } : {})}
        lens={<ScopeChip workspaceName={workspaceName} />}
        {...(teams[0]
          ? {
              actions: (
                <NewProjectButton
                  workspaceId={teams[0].workspaceId}
                  users={users as readonly UserOption[]}
                />
              ),
            }
          : {})}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg">
        <div className="flex items-center gap-4 px-10 pt-3 pb-3 text-[12.5px] text-text-2">
          <FilterMark />
          <span className="ml-auto font-mono text-[11px] text-text-2">
            Group <b className="font-medium text-text-1">Status</b> · Sort{' '}
            <b className="font-medium text-text-1">Target</b>
          </span>
        </div>

        <section
          ref={containerRef}
          className="flex-1 outline-none"
          onKeyDown={onKeyDown}
          aria-label="Projects"
        >
          {ordered.length === 0 ? (
            // Labels, never sentences — and the two states are distinguishable, so a premature
            // "no projects" is never announced over an unfinished sync.
            <p className="px-10 py-8 text-sm text-text-2" role="status">
              {complete ? 'No projects' : 'Loading…'}
            </p>
          ) : (
            groups.map((group) => {
              const startIndex = runningIndex
              runningIndex += group.projects.length
              return (
                <section key={group.status} aria-label={group.label}>
                  <div
                    data-testid="project-group-header"
                    data-status={group.status}
                    className="flex h-[35px] items-center gap-2.5 border-row-hairline border-t bg-bg-hover px-10"
                  >
                    <StatusGlyph
                      status={PROJECT_STATUS_TO_KIND[group.status]}
                      aria-hidden="true"
                      className="size-3.5"
                    />
                    <span className="font-semibold text-[12.5px] text-text-1">{group.label}</span>
                    <span className="font-mono text-[11.5px] text-text-2">
                      {group.projects.length}
                    </span>
                  </div>
                  {group.projects.map((project, offset) => {
                    const index = startIndex + offset
                    const issues = issuesByProject.get(project.id) ?? []
                    const lead = project.leadId === null ? null : userById.get(project.leadId)
                    return (
                      <ProjectIndexRow
                        key={project.id}
                        index={index}
                        project={project}
                        issues={issues}
                        teamKeys={teamKeys}
                        focused={index === focusIndex}
                        {...(lead
                          ? { leadName: lead.name ?? lead.email ?? lead.id, leadImage: lead.image }
                          : {})}
                        onFocus={() => setFocusIndex(index)}
                        onOpen={() => openProject(project)}
                      />
                    )
                  })}
                </section>
              )
            })
          )}
        </section>

        <div className="flex items-baseline gap-3.5 px-10 pt-4 pb-6 font-mono text-[10.5px] text-text-2">
          <span>workspace-scoped · counted over the issues in your teams</span>
          <How
            label="the counting rule"
            constraint="isMember on the project · teamScoped on its issues"
          >
            Every project in this workspace is listed. Its teams, meter and count are over the
            project's issues in teams you belong to — issues from other teams never sync, so nothing
            here counts what it cannot see.
          </How>
        </div>
      </div>
    </>
  )
}

function ProjectIndexRow({
  index,
  project,
  issues,
  teamKeys,
  focused,
  leadName,
  leadImage,
  onFocus,
  onOpen,
}: {
  index: number
  project: ProjectRowData
  issues: readonly ProjectIssueRow[]
  teamKeys: ReadonlyMap<string, string>
  focused: boolean
  leadName?: string
  leadImage?: string | null
  onFocus: () => void
  onOpen: () => void
}) {
  const progress = projectProgress(issues)
  const split = teamSplit(issues, teamKeys)
  const past = pastTargetReading(project, issues, Date.now())
  const quiet = project.status === 'completed' || project.status === 'cancelled'

  return (
    // A focusable row rather than a <button>: the row carries a real `how ·` control, and an
    // interactive element cannot legally nest inside a button. The same shape `IssueRow` ships.
    // biome-ignore lint/a11y/noStaticElementInteractions: roving-focus row primitive, per IssueRow
    <div
      data-slot="project-row"
      data-testid="project-row"
      data-index={index}
      data-project-id={project.id}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'relative flex h-11 items-center gap-3 border-row-hairline border-t pr-10 pl-[37px] outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
      )}
    >
      <StatusGlyph
        status={PROJECT_STATUS_TO_KIND[project.status]}
        aria-hidden="true"
        className="size-3.5 flex-none"
      />
      <span className={cn('truncate text-[13.5px]', quiet ? 'text-text-2' : 'text-text-1')}>
        {project.name}
      </span>
      <span className="flex-1" />

      {past.passed ? (
        <span className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[12.5px]">
          <span className="font-semibold text-status-urgent-ink">
            {`Past target — ${past.openCount} open`}
          </span>
          <How
            label="past target"
            align="end"
            constraint="target_date is one stored field; nothing records whether it was re-agreed."
          >
            The target date is earlier than today and the project is not completed. The number is
            its readable issues not at Done. It joins no attention count.
          </How>
        </span>
      ) : null}

      {/* Quiet slots: a project with no issues reserves teams / meter / count and draws NOTHING —
          no zero, no empty track — so nothing shifts the day its first issue arrives. */}
      <span
        className={cn(
          TEAM_SLOT,
          'flex items-center gap-1.5 truncate font-mono text-[11px] text-text-2',
        )}
      >
        {split.map((entry, position) => (
          <span key={entry.teamId} className="flex items-center gap-1">
            {position === 0 ? null : (
              <span aria-hidden="true" className="text-border-strong">
                ·
              </span>
            )}
            <b className="font-medium text-text-2">{entry.teamKey}</b>
            {entry.count}
          </span>
        ))}
      </span>

      <span className={METER_SLOT}>
        {progress.total === 0 ? null : (
          <span className="block h-1 overflow-hidden rounded-[2px] bg-row-hairline">
            <span
              className="block h-full rounded-[2px] bg-status-done"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </span>
        )}
      </span>
      <span className={cn(COUNT_SLOT, 'font-mono text-[11px] text-text-2')}>
        {progress.total === 0 ? null : `${progress.done}/${progress.total}`}
      </span>

      {leadName === undefined ? (
        <span className="size-5 flex-none" aria-hidden="true" />
      ) : (
        <Avatar size="xs" className="flex-none" title={`Lead ${leadName}`}>
          {leadImage ? <AvatarImage src={leadImage} alt={leadName} /> : null}
          <AvatarFallback aria-label={`Lead ${leadName}`}>{initials(leadName)}</AvatarFallback>
        </Avatar>
      )}

      <span
        className={cn(
          TARGET_SLOT,
          'font-mono text-[11px]',
          past.passed ? 'font-medium text-status-urgent-ink' : 'text-text-2',
        )}
      >
        {project.targetDate === null ? null : formatTargetDay(project.targetDate)}
      </span>
    </div>
  )
}

// The filter row's shared mark, drawn once at its head. Decorative — the axes name themselves.
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
