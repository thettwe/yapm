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
  formatAxisWindow,
  formatTargetDay,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TO_KIND,
  type ProjectCycleRow,
  type ProjectRowData,
  type RoadmapAxis,
  type RoadmapRowModel,
  roadmapAxis,
} from '@/projects/model'
import { initials, NewProjectButton, type UserOption } from '@/projects/project-controls'
import { useProjectRows } from '@/projects/use-project-rows'

// One day of the axis is a fraction of this run. The axis is a fixed measure rather than a
// percentage of the viewport so a cycle band is the same width on every row and in the header, and
// so the whole page scrolls sideways as one drawing.
const AXIS_W = 1000
const ROW_H = 56
// Where the two rows of the drawing sit: the target mark on the upper line, the issue marks under
// it. Nothing is drawn between them, because between them is where a bar would go.
const TARGET_Y = 24
const MARK_Y = 41

const NAME_COL = 'w-[260px] flex-none'
const METER_COL = 'w-[140px] flex-none'

export function RoadmapView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const { projects, issuesByProject, complete } = useProjectRows()
  // The deck team's cycles rule the GRID, and the surface says so — cycles are team-scoped while
  // projects are workspace-scoped. An issue's own mark is still positioned from its own cycle's
  // stored dates, which is why the axis needs both.
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())

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

  // Every cycle edge, both ends: two consecutive cycles do not share a boundary (one ends the day
  // before the next starts) and drawing only one line would close a gap the stored dates leave open.
  const gridlines = useMemo(() => {
    const edges = new Set<number>()
    for (const band of axis.cycleBands) {
      edges.add(band.startFraction)
      edges.add(band.endFraction)
    }
    return [...edges].sort((a, b) => a - b)
  }, [axis])

  const ordered = useMemo(() => axis.rows.map((row) => row.project), [axis])
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user] as const)), [users])
  const teamName = teams.find((team) => team.id === teamId)?.name ?? null
  const workspaceId = teams[0]?.workspaceId

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
      // Only keys pressed ON a row: the axis header's `how ·` keeps its own Enter and Escape.
      if (!(event.target instanceof HTMLElement) || event.target.dataset.slot !== 'roadmap-row') {
        return
      }
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
        {/* Two different nothings, two different labels: an unfinished sync must never announce an
            empty workspace. Neither is a sentence. */}
        <p className="p-8 text-sm text-text-2" role="status">
          {complete ? 'No projects' : 'Loading…'}
        </p>
      </>
    )
  }

  const firstUndated = axis.rows.findIndex((row) => !row.dated)
  const undatedCount = firstUndated === -1 ? 0 : axis.rows.length - firstUndated

  return (
    <>
      <Masthead
        title="Roadmap"
        count={ordered.length}
        lens={
          <span data-testid="roadmap-window" className="font-mono text-[11px] text-text-2">
            {formatAxisWindow(axis.window)}
          </span>
        }
        {...(workspaceId
          ? {
              actions: (
                <NewProjectButton
                  workspaceId={workspaceId}
                  users={users as readonly UserOption[]}
                />
              ),
            }
          : {})}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-bg">
        <div className="min-w-max">
          <div className="flex items-center gap-2.5 px-10 pt-3 pb-3 text-[12.5px] text-text-2">
            <FilterMark />
            <span className="font-mono text-[11px] text-text-2">
              Cycle bands <b className="font-medium text-text-1">{teamName ?? 'this team'}</b>
            </span>
            <How
              label="the cycle bands"
              constraint="cycle.team_id = this team · project.workspace_id = this workspace"
            >
              A project belongs to the workspace and can hold issues from several teams. The bands
              are this team's cycles, at their stored start and end dates. An issue in another
              team's cycle is still marked at that cycle's own dates — no band is drawn round it.
            </How>
            <span className="ml-16 font-mono text-[11px] text-text-2">
              Sort <b className="font-medium text-text-1">Target date</b>
            </span>
          </div>

          <section
            ref={containerRef}
            className="outline-none"
            onKeyDown={onKeyDown}
            aria-label="Project roadmap"
          >
            <AxisHeader axis={axis} teamName={teamName} />

            {axis.rows.map((row, index) => {
              const lead = row.project.leadId === null ? null : userById.get(row.project.leadId)
              const node = (
                <RoadmapRow
                  key={row.project.id}
                  index={index}
                  row={row}
                  gridlines={gridlines}
                  nowFraction={axis.nowFraction}
                  focused={index === focusIndex}
                  {...(lead
                    ? { leadName: lead.name ?? lead.email ?? lead.id, leadImage: lead.image }
                    : {})}
                  onFocus={() => setFocusIndex(index)}
                  onOpen={() => openProject(row.project)}
                />
              )
              if (index !== firstUndated) return node
              return (
                // One header for the whole undated set, replacing the ornament that used to repeat
                // on every one of these rows. They keep their meter and their issue marks.
                <div key={`undated-${row.project.id}`}>
                  <div
                    data-testid="roadmap-undated-header"
                    className="flex h-[35px] items-center gap-2.5 border-row-hairline border-t border-b bg-bg-hover px-10 font-semibold text-[12.5px] text-text-1"
                  >
                    No target date
                    <span className="font-mono font-normal text-[11.5px] text-text-2">
                      {undatedCount}
                    </span>
                  </div>
                  {node}
                </div>
              )
            })}
          </section>

          {/* The refusal, stated on the surface rather than merely obeyed. */}
          <p
            data-testid="roadmap-refusal"
            className="flex max-w-[760px] items-baseline gap-3 px-10 pt-6 pb-10 text-[12.5px] text-text-2 leading-relaxed"
          >
            <span>
              <b className="text-text-1">What this page won't guess:</b> a project's start — only a
              target is stored, so nothing here draws a bar.
            </span>
            <How label="the missing start" constraint="project stores target_date and nothing else">
              A project has no start date. Its earliest issue's creation was available as a
              derivation and refused: a drawn left edge reads as a commitment nobody made, and every
              span, slip and critical path after it would be invented too.
            </How>
          </p>
        </div>
      </div>
    </>
  )
}

// ============ the axis header — cycle boundaries are the grid ============

function AxisHeader({ axis, teamName }: { axis: RoadmapAxis; teamName: string | null }) {
  const x = (fraction: number) => fraction * AXIS_W
  const lastBandEnd = axis.cycleBands.at(-1)?.endFraction ?? 0
  const tail =
    axis.cycleBands.length > 0 && axis.lastCycleEnd !== null && axis.lastCycleEnd < axis.window.end
      ? `no cycles past ${formatTargetDay(axis.lastCycleEnd)}`
      : null
  const tailX = Math.min(AXIS_W - 132, x(lastBandEnd) + 14)

  const bandLabel =
    axis.cycleBands.length === 0
      ? 'no cycles in this window'
      : axis.cycleBands.map((band) => band.name).join(', ')
  const label = `Timeline ${formatAxisWindow(axis.window)}. Cycle bands${
    teamName === null ? '' : ` from ${teamName}`
  }: ${bandLabel}.${tail === null ? '' : ` ${tail}.`}`

  return (
    <div className="flex h-[54px] items-stretch border-row-hairline border-t border-b border-l-[3px] border-l-transparent bg-bg-hover">
      <span className={cn(NAME_COL, 'flex items-center pl-[37px] font-semibold text-[12.5px]')}>
        Project
      </span>
      <span className={cn(METER_COL, 'flex items-center gap-2 font-semibold text-[12.5px]')}>
        Done
        <How
          label="the done meter"
          constraint="one tick per readable issue · filled at status done"
        >
          One tick per issue in this project that is in a team you belong to, filled when the issue
          is at Done. Canceled issues count in the total and never in the fill. No percent is drawn:
          over a project nobody has broken down yet a percent reads 0%, which is a lie.
        </How>
      </span>
      <span className="flex-none" style={{ width: AXIS_W }}>
        <svg
          width={AXIS_W}
          height={54}
          viewBox={`0 0 ${AXIS_W} 54`}
          role="img"
          aria-label={label}
          className="block overflow-visible"
        >
          {axis.monthTicks.map((tick) => (
            <g key={tick.ts}>
              <line
                x1={x(tick.fraction)}
                y1="2"
                x2={x(tick.fraction)}
                y2="8"
                stroke="var(--border-strong)"
                strokeWidth="1"
              />
              <text
                x={x(tick.fraction) + 3}
                y="18"
                fontSize="10"
                fill="var(--text-2)"
                style={{ fontFamily: 'var(--type-mono)' }}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {axis.cycleBands.map((band) => {
            const left = x(band.startFraction)
            const width = Math.max(10, x(band.endFraction) - left)
            return (
              <g key={band.id}>
                <rect
                  x={left + 0.5}
                  y="24.5"
                  width={width}
                  height="17"
                  rx="3"
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                />
                <text
                  x={left + 6}
                  y="36"
                  fontSize="10"
                  fill={band.current ? 'var(--text-1)' : 'var(--text-2)'}
                  style={{ fontFamily: 'var(--type-mono)' }}
                >
                  {band.name}
                </text>
              </g>
            )
          })}

          {/* Where the stored cycles run out, said plainly — never ruled columns over months
              nobody has planned. */}
          {tail === null ? null : (
            <text
              x={tailX}
              y="36"
              fontSize="10"
              fill="var(--text-2)"
              style={{ fontFamily: 'var(--type-mono)' }}
            >
              {tail}
            </text>
          )}
          {axis.cycleBands.length === 0 ? (
            <text
              x="12"
              y="36"
              fontSize="10"
              fill="var(--text-2)"
              style={{ fontFamily: 'var(--type-mono)' }}
            >
              no cycles in this window
            </text>
          ) : null}

          {axis.nowFraction === null ? null : (
            <g>
              <line
                x1={x(axis.nowFraction)}
                y1="24"
                x2={x(axis.nowFraction)}
                y2="42"
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
              <text
                x={x(axis.nowFraction)}
                y="52"
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="var(--text-1)"
                style={{ fontFamily: 'var(--type-mono)' }}
              >
                today
              </text>
            </g>
          )}
        </svg>
      </span>
    </div>
  )
}

// ============ one project's row ============

function RoadmapRow({
  index,
  row,
  gridlines,
  nowFraction,
  focused,
  leadName,
  leadImage,
  onFocus,
  onOpen,
}: {
  index: number
  row: RoadmapRowModel
  gridlines: readonly number[]
  nowFraction: number | null
  focused: boolean
  leadName?: string
  leadImage?: string | null
  onFocus: () => void
  onOpen: () => void
}) {
  const { project } = row
  const targetX = row.targetFraction === null ? null : row.targetFraction * AXIS_W
  const targetDay = project.targetDate === null ? null : formatTargetDay(project.targetDate)
  // A label at the far right runs off the drawing, so it hangs from the mark's left instead.
  const flip = targetX !== null && targetX > AXIS_W - 150
  const phrase = emptyNote(row)

  return (
    <button
      type="button"
      data-slot="roadmap-row"
      data-roadmap-index={index}
      data-testid="roadmap-row"
      tabIndex={focused ? 0 : -1}
      aria-label={rowLabel(row)}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        'flex w-full cursor-pointer items-stretch border-row-hairline border-b border-l-[3px] border-l-transparent text-left outline-none transition-colors hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        focused ? 'border-l-accent bg-bg-selected' : '',
      )}
      style={{ height: ROW_H }}
    >
      <span className={cn(NAME_COL, 'flex items-center gap-[9px] pr-3.5 pl-[37px]')}>
        <StatusGlyph
          status={PROJECT_STATUS_TO_KIND[project.status]}
          aria-hidden="true"
          className="size-3.5 flex-none"
        />
        <span className="truncate text-[13.5px] text-text-1">{project.name}</span>
        <span className="flex-1" />
        {/* A leadless project reserves the slot and draws nothing in it. */}
        {leadName === undefined ? (
          <span className="size-5 flex-none" aria-hidden="true" />
        ) : (
          <Avatar size="xs" className="flex-none" title={`Lead ${leadName}`}>
            {leadImage ? <AvatarImage src={leadImage} alt={leadName} /> : null}
            <AvatarFallback aria-label={`Lead ${leadName}`}>{initials(leadName)}</AvatarFallback>
          </Avatar>
        )}
      </span>

      <span className={cn(METER_COL, 'flex items-center gap-2.5')}>
        {row.total === 0 ? null : (
          <>
            <DoneMeter done={row.done} total={row.total} />
            <span className="font-mono text-[11px] text-text-2">{`${row.done}/${row.total}`}</span>
          </>
        )}
      </span>

      <span className="relative flex-none" style={{ width: AXIS_W, height: ROW_H }}>
        <svg
          width={AXIS_W}
          height={ROW_H}
          viewBox={`0 0 ${AXIS_W} ${ROW_H}`}
          className="block"
          data-testid="roadmap-row-drawing"
          // The row is a `<button>`, and WAI-ARIA gives role=button presentational children — a
          // nested `role="img"` is stripped and its label is never announced. So the drawing's
          // facts ride the button's OWN name (`rowLabel`) and the SVG is hidden: one voice, not a
          // second one that no screen reader can reach.
          aria-hidden="true"
        >
          {gridlines.map((fraction) => (
            <line
              key={fraction}
              x1={fraction * AXIS_W}
              y1="0"
              x2={fraction * AXIS_W}
              y2={ROW_H}
              stroke="var(--row-hairline)"
              strokeWidth="1"
            />
          ))}
          {nowFraction === null ? null : (
            <line
              x1={nowFraction * AXIS_W}
              y1="0"
              x2={nowFraction * AXIS_W}
              y2={ROW_H}
              stroke="var(--accent-line)"
              strokeWidth="1"
            />
          )}
          {/* Filled for done, a ring for not — shape is the channel. The ring is stroked in
              `--text-2` rather than `--border-strong`, which this change's own contrast file pins
              UNDER the 3:1 non-text bar in all six blocks: where a mock ink misses its bar the ink
              moves and the mock loses (D8). */}
          {row.marks.map((mark) => (
            <circle
              key={mark.id}
              cx={mark.fraction * AXIS_W}
              cy={MARK_Y}
              r="3.2"
              fill={mark.done ? 'var(--status-done)' : 'var(--bg)'}
              {...(mark.done ? {} : { stroke: 'var(--text-2)', strokeWidth: 1.4 })}
            />
          ))}
          {targetX === null ? null : (
            <TargetMark x={targetX} status={project.status} passed={row.targetPassed} />
          )}
        </svg>

        {/* Text is drawn as text, not as SVG glyphs: it is read the same way by an eye and by a
            screen reader, and it survives a row whose drawing carries no label at all. */}
        <span
          className="-translate-y-1/2 absolute flex items-center gap-2 whitespace-nowrap"
          style={
            flip && targetX !== null
              ? { right: AXIS_W - targetX + 9, top: TARGET_Y, flexDirection: 'row-reverse' }
              : { left: (targetX ?? 4) + 9, top: TARGET_Y }
          }
        >
          {targetDay === null ? null : (
            <span className="font-mono text-[10px] text-text-2">{targetDay}</span>
          )}
          {row.targetPassed ? (
            <span className="font-semibold text-[12px] text-status-urgent-ink">Target passed</span>
          ) : null}
          {phrase === null ? null : (
            <span className={cn('text-[12px] text-text-2', phrase.quiet ? '' : 'font-medium')}>
              {phrase.text}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

// The target is one point in time, shaped and inked by the project's own status: a filled disc for
// work planned or running, the done disc for a completed one, the × ring for a cancelled one, and
// a hollow urgent ring where the date has gone by. There is no second point, so there is no bar.
function TargetMark({
  x,
  status,
  passed,
}: {
  x: number
  status: ProjectRowData['status']
  passed: boolean
}) {
  const ink = passed
    ? 'var(--status-urgent)'
    : status === 'completed'
      ? 'var(--status-done)'
      : status === 'active'
        ? 'var(--status-in-progress)'
        : 'var(--text-2)'

  if (status === 'cancelled') {
    return (
      <g>
        <circle cx={x} cy={TARGET_Y} r="4.5" fill="var(--bg)" stroke={ink} strokeWidth="1.6" />
        <path
          d={`M${x - 2.2} ${TARGET_Y - 2.2}L${x + 2.2} ${TARGET_Y + 2.2}M${x + 2.2} ${TARGET_Y - 2.2}L${x - 2.2} ${TARGET_Y + 2.2}`}
          stroke={ink}
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    )
  }
  if (passed) {
    return <circle cx={x} cy={TARGET_Y} r="4.5" fill="var(--bg)" stroke={ink} strokeWidth="1.8" />
  }
  return <circle cx={x} cy={TARGET_Y} r="4.5" fill={ink} stroke="var(--bg)" strokeWidth="2" />
}

// One tick per readable issue, filled for done. Its LENGTH encodes issue count, which is the
// meter's known fault; the mono `done/total` beside it is the exact fact. Sixteen 3px ticks and
// their gaps are exactly the track, so past sixteen the ticks share it instead of overrunning the
// column into the count — still one element per issue, never a resampled bar.
const METER_TRACK = 86
const DENSE_AT = 16

function DoneMeter({ done, total }: { done: number; total: number }) {
  const dense = total > DENSE_AT
  return (
    <span
      aria-hidden="true"
      className="flex h-2 items-center overflow-hidden rounded-[1px]"
      style={{ width: METER_TRACK, gap: dense ? 0 : 2.5 }}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-2',
            dense ? '' : 'rounded-[1px]',
            index < done ? 'bg-status-done' : 'bg-border-strong',
          )}
          style={dense ? { flex: '1 1 0', minWidth: 0 } : { width: 3, flex: 'none' }}
        />
      ))}
    </span>
  )
}

// Two different kinds of nothing, and they must read differently: a project with no issues has not
// been broken down, while one whose issues sit in no cycle has work nobody has scheduled. Both are
// news about the project. A project whose work IS scheduled, in cycles this window does not cover,
// gets no note: that was a reading of the drawing rather than news, it fired on every such row, and
// a note every row carries distinguishes none of them. The row's own name says it instead.
function emptyNote(row: RoadmapRowModel): { text: string; quiet: boolean } | null {
  if (row.total === 0) return { text: 'No issues yet', quiet: true }
  if (row.scheduledCount === 0) return { text: 'Nothing scheduled', quiet: false }
  return null
}

function issueCountPhrase(row: RoadmapRowModel): string {
  return row.total === 0 ? 'no issues yet' : `${row.done} of ${row.total} issues done`
}

// Where the drawing's issue marks actually sit, in words — and the one channel left to a row whose
// work is scheduled off the axis, since the drawing is `aria-hidden` and the note is gone. Three
// answers, not two: the marks the axis drew; a schedule this window does not reach; or no schedule
// at all. Announcing the third for the second would deny a schedule the project has, which is the
// same offence as inventing one.
function schedulePhrase(row: RoadmapRowModel): string | null {
  const perCycle: { name: string; count: number }[] = []
  for (const mark of row.marks) {
    const seen = perCycle.find((entry) => entry.name === mark.cycleName)
    if (seen) seen.count += 1
    else perCycle.push({ name: mark.cycleName, count: 1 })
  }
  if (perCycle.length > 0) {
    return `scheduled ${perCycle.map((entry) => `${entry.count} in ${entry.name}`).join(', ')}`
  }
  if (row.scheduledCount > 0) return 'scheduled beyond the drawn window'
  return row.total > 0 ? 'no issues scheduled in a cycle' : null
}

// The row's ONE accessible name, carrying everything the drawing beside it draws: the target and
// how it stands against today, the done-over-total, and which cycles the marks sit in. Nothing
// here is carried by colour, and nothing is carried by a nested label a button would swallow.
function rowLabel(row: RoadmapRowModel): string {
  const { project } = row
  const target =
    project.targetDate === null
      ? 'no target date'
      : `target ${formatTargetDay(project.targetDate)}, ${
          row.targetPassed ? 'past today' : 'ahead of today'
        }`
  const schedule = schedulePhrase(row)
  const parts = [
    project.name,
    PROJECT_STATUS_LABEL[project.status],
    target,
    issueCountPhrase(row),
    ...(schedule === null ? [] : [schedule]),
  ]
  return parts.join(', ')
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
