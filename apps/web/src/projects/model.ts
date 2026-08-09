import { ISSUE_STATUSES, type IssueStatus, type ProjectStatus } from '@yapm/schema'
import type { StatusKind } from '@yapm/ui/components/status-glyph'
import { type IssueRowData, STATUS_LABEL } from '@/issues/model'

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// A project's status is cycle position at a coarser grain, so it borrows the issue glyph family
// rather than inventing a second one. The two enums spell their terminal state differently —
// `project.status` is `cancelled` (migrations/0008) and `issue.status` is `canceled`
// (migrations/0004) — and this map is the only place the two spellings meet.
export const PROJECT_STATUS_TO_KIND: Record<ProjectStatus, StatusKind> = {
  planned: 'todo',
  active: 'in-progress',
  completed: 'done',
  cancelled: 'canceled',
}

// The order projects list in: active first (the work in flight), then planned, then the two
// terminal states. Within a status, earlier target dates sort first; a missing target sorts last.
const PROJECT_STATUS_ORDER: Record<ProjectStatus, number> = {
  active: 0,
  planned: 1,
  completed: 2,
  cancelled: 3,
}

const STATUS_SEQUENCE: readonly ProjectStatus[] = ['active', 'planned', 'completed', 'cancelled']

const DAY = 24 * 60 * 60 * 1000
// Three months of runway so a single near-term project is not crammed against the axis edge.
const MINIMUM_RUNWAY_MONTHS = 3

export interface ProjectRowData {
  readonly id: string
  readonly name: string
  readonly status: ProjectStatus
  readonly leadId: string | null
  readonly targetDate: number | null
  readonly createdAt: number
}

// A cycle as the axis reads it: a real start and a real end, both stored columns.
export interface ProjectCycleRow {
  readonly id: string
  readonly name: string
  readonly startDate: number
  readonly endDate: number
}

// A project's readable issue: which team it came from (a project spans several) and which cycle
// it is scheduled in, carried as the cycle's OWN row so a mark is positioned from stored dates
// rather than from whichever team's grid happens to be drawn.
export interface ProjectIssueRow extends IssueRowData {
  readonly teamId: string
  readonly cycle: ProjectCycleRow | null
}

export interface ProjectProgress {
  readonly total: number
  readonly done: number
  readonly percent: number
}

// Progress over a project's issues: the share that have reached Done. Canceled issues count
// toward the total (they are scope that was cut, not shipped) but not toward done. Percent is 0
// for an empty project (never NaN). Note the issues are only those the caller can read
// (team-scoped), so for a cross-team project a viewer not in every team sees partial progress.
// No surface renders the percent — the drawn meter and `done/total` carry the fact, because a
// percent over a project nobody has broken down yet reads 0%, which is a lie.
export function projectProgress(issues: readonly IssueRowData[]): ProjectProgress {
  const total = issues.length
  const done = issues.filter((issue) => issue.status === 'done').length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { total, done, percent }
}

export function compareProjects(a: ProjectRowData, b: ProjectRowData): number {
  const byStatus = PROJECT_STATUS_ORDER[a.status] - PROJECT_STATUS_ORDER[b.status]
  if (byStatus !== 0) return byStatus
  return compareByTarget(a, b)
}

// Target order, undated last, name as the tiebreak — the order inside a status group and the
// order the roadmap's axis lists its rows in.
export function compareByTarget(a: ProjectRowData, b: ProjectRowData): number {
  const at = a.targetDate ?? Number.POSITIVE_INFINITY
  const bt = b.targetDate ?? Number.POSITIVE_INFINITY
  if (at !== bt) return at - bt
  return a.name.localeCompare(b.name)
}

export function sortProjects(projects: readonly ProjectRowData[]): ProjectRowData[] {
  return [...projects].sort(compareProjects)
}

export interface ProjectStatusGroup {
  readonly status: ProjectStatus
  readonly label: string
  readonly projects: readonly ProjectRowData[]
}

// A status with no projects yields NO group: a header is a container for rows, not a legend for
// the enum, and an empty one would assert a project this workspace does not have.
export function groupProjectsByStatus(
  projects: readonly ProjectRowData[],
): readonly ProjectStatusGroup[] {
  const groups: ProjectStatusGroup[] = []
  for (const status of STATUS_SEQUENCE) {
    const inStatus = projects.filter((project) => project.status === status)
    if (inStatus.length === 0) continue
    groups.push({
      status,
      label: PROJECT_STATUS_LABEL[status],
      projects: [...inStatus].sort(compareByTarget),
    })
  }
  return groups
}

export interface TeamSplitEntry {
  readonly teamId: string
  readonly teamKey: string
  readonly count: number
}

// Which teams a project's READABLE issues came from. It sums to the project's issue total by
// construction — it is a partition of the same rows, never a second count — and it names only the
// teams whose issues arrived: issues from teams the reader is not in never sync, so the client
// cannot count them and cannot even prove they exist.
export function teamSplit(
  issues: readonly { readonly teamId: string }[],
  teamKeys: ReadonlyMap<string, string>,
): readonly TeamSplitEntry[] {
  const counts = new Map<string, number>()
  for (const issue of issues) counts.set(issue.teamId, (counts.get(issue.teamId) ?? 0) + 1)
  return [...counts.entries()]
    .map(([teamId, count]) => ({ teamId, teamKey: teamKeys.get(teamId) ?? '', count }))
    .sort((a, b) => b.count - a.count || a.teamKey.localeCompare(b.teamKey))
}

export interface PastTargetReading {
  readonly passed: boolean
  // Readable issues not at Done — the work the passed date is passed WITH.
  readonly openCount: number
  readonly daysPast: number
}

function startOfDayUTC(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// `target_date < startOfToday AND status !== 'completed'`. A project whose target is exactly today
// has NOT passed it. A completed project never reads as past its target however old the date is.
//
// The comparison is honest about being softer than its ink: `target_date` is a single stored
// field and nothing records whether it was ever re-agreed. That disclosure rides the `how ·`
// beside the phrase, and this reading deliberately joins no attention count.
export function pastTargetReading(
  project: ProjectRowData,
  issues: readonly IssueRowData[],
  now: number,
): PastTargetReading {
  const openCount = issues.filter((issue) => issue.status !== 'done').length
  const today = startOfDayUTC(now)
  const target = project.targetDate
  if (target === null || project.status === 'completed' || startOfDayUTC(target) >= today) {
    return { passed: false, openCount, daysPast: 0 }
  }
  return { passed: true, openCount, daysPast: Math.round((today - startOfDayUTC(target)) / DAY) }
}

export interface IssueStateSegment {
  readonly status: IssueStatus
  readonly label: string
  readonly count: number
  readonly fraction: number
}

// The project page's state bar: what the issues ARE now, in the shared status order. A status
// nobody's issue is in yields no segment, and a project with no issues yields no segments at all
// — never a zero-width rect, never NaN.
export function issueStateSegments(issues: readonly IssueRowData[]): readonly IssueStateSegment[] {
  const total = issues.length
  if (total === 0) return []
  const segments: IssueStateSegment[] = []
  for (const status of ISSUE_STATUSES) {
    const count = issues.filter((issue) => issue.status === status).length
    if (count === 0) continue
    segments.push({ status, label: STATUS_LABEL[status], count, fraction: count / total })
  }
  return segments
}

export interface TargetStrip {
  // Positions along the created→(target or today) run, in 0..1. There is no `start` here and no
  // width per project: the left end is the CREATED dot, labelled as exactly that on the surface.
  readonly targetFraction: number
  readonly nowFraction: number
  readonly overrun: { readonly from: number; readonly to: number } | null
}

// Undated project → no strip at all. Drawing one would need a second date the entity does not
// have.
export function targetStrip(project: ProjectRowData, now: number): TargetStrip | null {
  const target = project.targetDate
  if (target === null) return null
  const end = Math.max(target, now)
  const run = Math.max(1, end - project.createdAt)
  const at = (ts: number) => Math.min(1, Math.max(0, (ts - project.createdAt) / run))
  const targetFraction = at(target)
  const nowFraction = at(now)
  return {
    targetFraction,
    nowFraction,
    overrun: now > target ? { from: targetFraction, to: nowFraction } : null,
  }
}

export interface RoadmapMonthTick {
  readonly ts: number
  readonly label: string
  readonly fraction: number
}

export interface RoadmapCycleBand {
  readonly id: string
  readonly name: string
  readonly startFraction: number
  readonly endFraction: number
  readonly current: boolean
}

export interface RoadmapIssueMark {
  readonly id: string
  readonly fraction: number
  readonly done: boolean
  readonly cycleName: string
}

export interface RoadmapRowModel {
  readonly project: ProjectRowData
  readonly dated: boolean
  // One point in time, or nothing. NOT a left edge, NOT a span, NOT a width.
  readonly targetFraction: number | null
  readonly targetPassed: boolean
  readonly done: number
  readonly total: number
  // Issues that sit in SOME cycle, whether or not that cycle falls inside the drawn window —
  // so `Nothing scheduled` can be told apart from "scheduled off the edge of the axis".
  readonly scheduledCount: number
  readonly marks: readonly RoadmapIssueMark[]
}

export interface RoadmapAxis {
  readonly window: { readonly start: number; readonly end: number }
  readonly monthTicks: readonly RoadmapMonthTick[]
  readonly cycleBands: readonly RoadmapCycleBand[]
  readonly nowFraction: number | null
  // Where the stored cycles run out, so the surface can state `no cycles past <date>` instead of
  // ruling columns over months nobody has planned.
  readonly lastCycleEnd: number | null
  readonly rows: readonly RoadmapRowModel[]
}

function startOfMonthUTC(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

function addMonthsUTC(ts: number, months: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)
}

// The year is carried whenever the drawn window crosses one: without it a thirteen-month axis
// renders two ticks reading `Aug` and a window label collapsing to the single word `Aug`, neither
// of which says which August.
function monthLabel(ts: number, withYear = false): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

function crossesYear(start: number, end: number): boolean {
  return new Date(start).getUTCFullYear() !== new Date(end - DAY).getUTCFullYear()
}

// The whole roadmap reading, over an injected `now`. NOTHING here returns a start date, a span, a
// duration or a per-project width — the absence is structural, not stylistic, because a project
// stores no start and every bar has a left edge.
export function roadmapAxis(input: {
  readonly projects: readonly ProjectRowData[]
  readonly issuesByProject: ReadonlyMap<string, readonly ProjectIssueRow[]>
  readonly cycles: readonly ProjectCycleRow[]
  readonly now: number
}): RoadmapAxis {
  const { projects, issuesByProject, cycles, now } = input

  const targets = projects
    .map((project) => project.targetDate)
    .filter((target): target is number => target !== null)

  // The window covers the data it draws. Anchoring it on the current cycle (or this month) and
  // clamping everything earlier would stack every passed target on the same pixel at fraction 0,
  // so a target already behind us pulls the left edge back to the start of its own month.
  const currentCycle = cycles.find((cycle) => cycle.startDate <= now && now <= cycle.endDate)
  const anchor = currentCycle ? currentCycle.startDate : startOfMonthUTC(now)
  const start =
    targets.length > 0 ? Math.min(anchor, startOfMonthUTC(Math.min(...targets))) : anchor

  const latest = targets.length > 0 ? Math.max(...targets) : now
  // The runway is measured forward from the ANCHOR, never from the pulled-back start. Measuring it
  // from the start would let a workspace whose targets have all gone by close its window before
  // today: no today caret, no current cycle band, and every current or future issue mark dropped.
  const end = Math.max(
    addMonthsUTC(startOfMonthUTC(latest), 1),
    addMonthsUTC(startOfMonthUTC(anchor), MINIMUM_RUNWAY_MONTHS),
  )
  const span = Math.max(1, end - start)
  const at = (ts: number) => (ts - start) / span
  const clamped = (ts: number) => Math.min(1, Math.max(0, at(ts)))

  const dated = crossesYear(start, end)
  const monthTicks: RoadmapMonthTick[] = []
  let tick = startOfMonthUTC(start)
  if (tick < start) tick = addMonthsUTC(tick, 1)
  while (tick < end && monthTicks.length <= 60) {
    monthTicks.push({ ts: tick, label: monthLabel(tick, dated), fraction: at(tick) })
    tick = addMonthsUTC(tick, 1)
  }

  const cycleBands: RoadmapCycleBand[] = cycles
    .filter((cycle) => cycle.endDate >= start && cycle.startDate <= end)
    .map((cycle) => ({
      id: cycle.id,
      name: cycle.name,
      startFraction: clamped(cycle.startDate),
      endFraction: clamped(cycle.endDate),
      current: cycle.startDate <= now && now <= cycle.endDate,
    }))

  const lastCycleEnd =
    cycles.length === 0 ? null : cycles.reduce((max, cycle) => Math.max(max, cycle.endDate), 0)

  const ordered = [...projects].sort(compareByTarget)
  const rows = ordered.map((project) => {
    const issues = issuesByProject.get(project.id) ?? []
    const progress = projectProgress(issues)
    const cycled = issues.filter(
      (issue): issue is ProjectIssueRow & { cycle: ProjectCycleRow } => issue.cycle !== null,
    )
    const perCycle = new Map<string, (ProjectIssueRow & { cycle: ProjectCycleRow })[]>()
    for (const issue of cycled) {
      const bucket = perCycle.get(issue.cycle.id)
      if (bucket) bucket.push(issue)
      else perCycle.set(issue.cycle.id, [issue])
    }
    const marks: RoadmapIssueMark[] = []
    for (const bucket of perCycle.values()) {
      const cycle = bucket[0]?.cycle
      if (!cycle) continue
      bucket.forEach((issue, index) => {
        // Inside its OWN cycle's stored run, spread so several issues in one cycle stay legible.
        const within =
          cycle.startDate + ((index + 1) / (bucket.length + 1)) * (cycle.endDate - cycle.startDate)
        const fraction = at(within)
        if (fraction < 0 || fraction > 1) return
        marks.push({
          id: issue.id,
          fraction,
          done: issue.status === 'done',
          cycleName: cycle.name,
        })
      })
    }
    marks.sort((a, b) => a.fraction - b.fraction)

    const targetFraction =
      project.targetDate === null ? null : Math.min(1, Math.max(0, at(project.targetDate)))
    return {
      project,
      dated: project.targetDate !== null,
      targetFraction,
      targetPassed: pastTargetReading(project, issues, now).passed,
      done: progress.done,
      total: progress.total,
      scheduledCount: cycled.length,
      marks,
    }
  })

  return {
    window: { start, end },
    monthTicks,
    cycleBands,
    nowFraction: now >= start && now <= end ? at(now) : null,
    lastCycleEnd,
    rows,
  }
}

// The drawn window, stated as a label — `Jul – Nov`. It is a reading of the axis the page already
// derived, never a control: nothing on this surface can change the window, and a chevron over
// nothing is a lie about an affordance.
export function formatAxisWindow(window: { readonly start: number; readonly end: number }): string {
  const lastDay = window.end - DAY
  const dated = crossesYear(window.start, window.end)
  const first = monthLabel(window.start, dated)
  const last = monthLabel(lastDay, dated)
  // Month AND year decide whether the window is one label: a thirteen-month axis running Aug to
  // Aug is two ends that happen to share a month name, not one month.
  const sameMonth = startOfMonthUTC(window.start) === startOfMonthUTC(lastDay)
  return sameMonth ? first : `${first} – ${last}`
}

export function formatTargetDate(targetDate: number | null): string {
  if (targetDate === null) return 'No target'
  return new Date(targetDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// The mono date a row states: `Aug 1`. The year is dropped because the axis and the group it sits
// in already place it, and the column is 76px.
export function formatTargetDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
