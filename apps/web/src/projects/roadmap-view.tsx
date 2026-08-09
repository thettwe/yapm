import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
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
  formatTargetDate,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TO_KIND,
  type ProjectCycleRow,
  type ProjectRowData,
  type RoadmapRowModel,
  roadmapAxis,
} from '@/projects/model'
import { useProjectRows } from '@/projects/use-project-rows'

export function RoadmapView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const { projects, issuesByProject, complete } = useProjectRows()
  // The deck team's cycles rule the GRID. An issue's own mark is still positioned from its own
  // cycle's stored dates, which is why the axis needs both.
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))

  const axis = useMemo(
    () =>
      roadmapAxis({
        projects,
        issuesByProject,
        cycles: cycles as readonly ProjectCycleRow[],
        now: Date.now(),
      }),
    [projects, issuesByProject, cycles],
  )

  const ordered = useMemo(() => axis.rows.map((row) => row.project), [axis])
  const dated = axis.rows.filter((row) => row.dated)
  const undated = axis.rows.filter((row) => !row.dated)

  const [focusIndex, setFocusIndex] = useState(0)
  const containerRef = useRef<HTMLElement>(null)

  // Keep the roving tabindex pointed at a valid, mounted row when the ordered set shrinks,
  // so focus never falls to <body> and keyboard navigation keeps working (CLAUDE.md #10).
  useEffect(() => {
    setFocusIndex((prev) => Math.min(prev, Math.max(0, ordered.length - 1)))
  }, [ordered.length])

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
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (ordered.length === 0) return
      switch (event.key) {
        // Compute the next index from the closed-over focusIndex and move focus as an explicit
        // side effect — never inside the setState updater, which React StrictMode double-invokes
        // (that would advance the roving focus by two rows per keypress).
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

  if (ordered.length === 0) {
    return (
      <>
        <Masthead title="Roadmap" {...(complete ? { count: 0 } : {})} />
        <p className="p-8 text-sm text-text-3" role="status">
          {complete ? 'No projects' : 'Loading…'}
        </p>
      </>
    )
  }

  return (
    <>
      <Masthead title="Roadmap" count={ordered.length} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <section
          ref={containerRef}
          className="flex-1 outline-none"
          onKeyDown={onKeyDown}
          aria-label="Project roadmap timeline"
        >
          <div className="sticky top-0 z-10 flex border-border border-b bg-bg/95 backdrop-blur">
            <div className="w-56 shrink-0 border-border border-r px-4 py-2 font-semibold text-[11px] text-text-3 uppercase tracking-wide">
              Project
            </div>
            <div className="relative h-8 flex-1">
              {axis.monthTicks.map((tick) => (
                <span
                  key={tick.ts}
                  className="absolute top-2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-text-3"
                  style={{ left: `${tick.fraction * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>

          {dated.map((row) => (
            <RoadmapRow
              key={row.project.id}
              index={ordered.indexOf(row.project)}
              row={row}
              nowFraction={axis.nowFraction}
              monthTicks={axis.monthTicks}
              focused={ordered.indexOf(row.project) === focusIndex}
              onFocus={() => setFocusIndex(ordered.indexOf(row.project))}
              onOpen={() => openProject(row.project)}
            />
          ))}

          {undated.length > 0 ? (
            <div className="border-border border-t">
              <div className="bg-bg-sidebar/60 px-4 py-1.5 font-semibold text-[11px] text-text-3 uppercase tracking-wide">
                No target date
              </div>
              {undated.map((row) => (
                <RoadmapRow
                  key={row.project.id}
                  index={ordered.indexOf(row.project)}
                  row={row}
                  nowFraction={axis.nowFraction}
                  monthTicks={axis.monthTicks}
                  focused={ordered.indexOf(row.project) === focusIndex}
                  onFocus={() => setFocusIndex(ordered.indexOf(row.project))}
                  onOpen={() => openProject(row.project)}
                />
              ))}
            </div>
          ) : null}

          {/* The refusal, stated on the surface rather than merely obeyed. */}
          <p className="max-w-[760px] px-10 pt-6 pb-10 text-[12.5px] text-text-2 leading-relaxed">
            <b className="text-text-1">What this page won't guess:</b> a project's start — only a
            target is stored, so nothing here draws a bar.
          </p>
        </section>
      </div>
    </>
  )
}

function RoadmapRow({
  index,
  row,
  nowFraction,
  monthTicks,
  focused,
  onFocus,
  onOpen,
}: {
  index: number
  row: RoadmapRowModel
  nowFraction: number | null
  monthTicks: readonly { ts: number; fraction: number }[]
  focused: boolean
  onFocus: () => void
  onOpen: () => void
}) {
  const { project } = row
  return (
    <button
      type="button"
      data-roadmap-index={index}
      data-testid="roadmap-row"
      tabIndex={focused ? 0 : -1}
      aria-label={`${project.name}, ${PROJECT_STATUS_LABEL[project.status]}, target ${formatTargetDate(project.targetDate)}, ${row.done} of ${row.total} issues done`}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        'flex w-full cursor-pointer items-stretch border-border border-b text-left outline-none transition-colors hover:bg-bg-sidebar focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        focused ? 'bg-bg-elevated' : '',
      )}
    >
      <div className="flex w-56 shrink-0 flex-col justify-center gap-0.5 border-border border-r px-4 py-2">
        <span className="flex items-center gap-1.5 font-medium text-sm text-text-1">
          <StatusGlyph
            status={PROJECT_STATUS_TO_KIND[project.status]}
            aria-hidden="true"
            className="size-3.5"
          />
          {project.name}
        </span>
        <span className="pl-5 font-mono text-[11px] text-text-3">
          {row.total === 0 ? null : `${row.done}/${row.total}`}
        </span>
      </div>
      <div className="relative flex-1">
        {monthTicks.map((tick) => (
          <span
            key={tick.ts}
            className="absolute inset-y-0 w-px bg-border/60"
            style={{ left: `${tick.fraction * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {nowFraction !== null ? (
          <span
            className="absolute inset-y-0 w-px bg-accent/60"
            style={{ left: `${nowFraction * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
        {row.targetFraction !== null ? (
          <span
            className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
            style={{ left: `${row.targetFraction * 100}%` }}
          >
            <span
              className={cn(
                'size-2.5 rounded-full ring-2 ring-bg',
                row.targetPassed ? 'bg-status-urgent' : 'bg-text-3',
              )}
            />
            <span className="whitespace-nowrap font-mono text-[11px] text-text-3">
              {formatTargetDate(project.targetDate)}
            </span>
            {row.targetPassed ? (
              <span className="whitespace-nowrap font-semibold text-[12px] text-status-urgent-ink">
                Target passed
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </button>
  )
}
