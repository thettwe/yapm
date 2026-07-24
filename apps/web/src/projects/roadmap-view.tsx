import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { type ProjectStatus, queries } from '@yapm/schema'
import { cn } from '@yapm/ui/lib/utils'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  formatTargetDate,
  PROJECT_STATUS_LABEL,
  type ProjectRowData,
  projectProgress,
  roadmapTimeline,
  sortProjects,
} from '@/projects/model'

const PROJECT_STATUS_DOT: Record<ProjectStatus, string> = {
  planned: 'bg-text-3',
  active: 'bg-status-in-progress',
  completed: 'bg-status-done',
  cancelled: 'bg-text-3',
}

export function RoadmapView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const [projectsRaw, projectsResult] = useQuery(queries.projects.all())

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

  const progressById = useMemo(() => {
    const map = new Map<string, number>()
    for (const project of projectsRaw) {
      map.set(project.id, projectProgress((project.issues ?? []) as never).percent)
    }
    return map
  }, [projectsRaw])

  const timeline = useMemo(() => roadmapTimeline(projects, Date.now()), [projects])

  // A single flat, keyboard-navigable order: scheduled projects (by target) then unscheduled.
  const ordered = useMemo(
    () => [...timeline.scheduled.map((m) => m.project), ...timeline.unscheduled],
    [timeline],
  )

  const [focusIndex, setFocusIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const focusRow = useCallback((index: number) => {
    containerRef.current?.querySelector<HTMLElement>(`[data-roadmap-index="${index}"]`)?.focus()
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
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (ordered.length === 0) return
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          setFocusIndex((prev) => {
            const next = Math.min(ordered.length - 1, prev + 1)
            focusRow(next)
            return next
          })
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          setFocusIndex((prev) => {
            const next = Math.max(0, prev - 1)
            focusRow(next)
            return next
          })
          break
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

  if (projects.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-text-3" role="status">
        {projectsResult.type === 'complete'
          ? 'No projects yet. Create a project to see it on the roadmap.'
          : 'Loading roadmap…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight text-text-1">Roadmap</h1>
        <span className="font-mono text-xs text-text-3">{projects.length}</span>
      </div>

      <section
        ref={containerRef}
        className="flex-1 outline-none"
        onKeyDown={onKeyDown}
        aria-label="Project roadmap timeline"
      >
        {/* Month ruler */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-bg/95 backdrop-blur">
          <div className="w-56 shrink-0 border-r border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Project
          </div>
          <div className="relative h-8 flex-1">
            {timeline.months.map((month) => (
              <span
                key={month.ts}
                className="absolute top-2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-text-3"
                style={{ left: `${month.leftPercent}%` }}
              >
                {month.label}
              </span>
            ))}
          </div>
        </div>

        {timeline.scheduled.map((marker, index) => (
          <RoadmapRow
            key={marker.project.id}
            index={index}
            project={marker.project}
            leftPercent={marker.leftPercent}
            nowPercent={timeline.nowPercent}
            progress={progressById.get(marker.project.id) ?? 0}
            focused={index === focusIndex}
            months={timeline.months}
            onFocus={() => setFocusIndex(index)}
            onOpen={() => openProject(marker.project)}
          />
        ))}

        {timeline.unscheduled.length > 0 ? (
          <div className="border-t border-border">
            <div className="bg-bg-sidebar/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              No target date
            </div>
            {timeline.unscheduled.map((project, offset) => {
              const index = timeline.scheduled.length + offset
              return (
                <RoadmapRow
                  key={project.id}
                  index={index}
                  project={project}
                  leftPercent={null}
                  nowPercent={timeline.nowPercent}
                  progress={progressById.get(project.id) ?? 0}
                  focused={index === focusIndex}
                  months={timeline.months}
                  onFocus={() => setFocusIndex(index)}
                  onOpen={() => openProject(project)}
                />
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function RoadmapRow({
  index,
  project,
  leftPercent,
  nowPercent,
  progress,
  focused,
  months,
  onFocus,
  onOpen,
}: {
  index: number
  project: ProjectRowData
  leftPercent: number | null
  nowPercent: number | null
  progress: number
  focused: boolean
  months: readonly { ts: number; leftPercent: number }[]
  onFocus: () => void
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      data-roadmap-index={index}
      data-testid="roadmap-row"
      tabIndex={focused ? 0 : -1}
      aria-label={`${project.name}, ${PROJECT_STATUS_LABEL[project.status]}, target ${formatTargetDate(project.targetDate)}`}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        'flex w-full cursor-pointer items-stretch border-b border-border text-left outline-none transition-colors hover:bg-bg-sidebar',
        focused ? 'bg-bg-elevated' : '',
      )}
    >
      <div className="flex w-56 shrink-0 flex-col justify-center gap-0.5 border-r border-border px-4 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text-1">
          <span
            className={cn('size-2 rounded-full', PROJECT_STATUS_DOT[project.status])}
            aria-hidden="true"
          />
          {project.name}
        </span>
        <span className="pl-3.5 font-mono text-[11px] text-text-3">{progress}% done</span>
      </div>
      <div className="relative flex-1">
        {/* Month gridlines */}
        {months.map((month) => (
          <span
            key={month.ts}
            className="absolute inset-y-0 w-px bg-border/60"
            style={{ left: `${month.leftPercent}%` }}
            aria-hidden="true"
          />
        ))}
        {nowPercent !== null ? (
          <span
            className="absolute inset-y-0 w-px bg-accent/60"
            style={{ left: `${nowPercent}%` }}
            aria-hidden="true"
          />
        ) : null}
        {leftPercent !== null ? (
          <span
            className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
            style={{ left: `${leftPercent}%` }}
          >
            <span
              className={cn(
                'size-2.5 rounded-full ring-2 ring-bg',
                PROJECT_STATUS_DOT[project.status],
              )}
            />
            <span className="whitespace-nowrap font-mono text-[11px] text-text-3">
              {formatTargetDate(project.targetDate)}
            </span>
          </span>
        ) : (
          <span className="flex h-full items-center pl-4 text-[11px] italic text-text-3">
            No target date
          </span>
        )}
      </div>
    </button>
  )
}
