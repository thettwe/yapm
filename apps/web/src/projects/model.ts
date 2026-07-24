import type { ProjectStatus } from '@yapm/schema'
import type { IssueRowData } from '@/issues/model'

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// The order projects list in: active first (the work in flight), then planned, then the two
// terminal states. Within a status, earlier target dates sort first; a missing target sorts last.
const PROJECT_STATUS_ORDER: Record<ProjectStatus, number> = {
  active: 0,
  planned: 1,
  completed: 2,
  cancelled: 3,
}

export interface ProjectRowData {
  readonly id: string
  readonly name: string
  readonly status: ProjectStatus
  readonly leadId: string | null
  readonly targetDate: number | null
  readonly createdAt: number
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
export function projectProgress(issues: readonly IssueRowData[]): ProjectProgress {
  const total = issues.length
  const done = issues.filter((issue) => issue.status === 'done').length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { total, done, percent }
}

export function compareProjects(a: ProjectRowData, b: ProjectRowData): number {
  const byStatus = PROJECT_STATUS_ORDER[a.status] - PROJECT_STATUS_ORDER[b.status]
  if (byStatus !== 0) return byStatus
  const at = a.targetDate ?? Number.POSITIVE_INFINITY
  const bt = b.targetDate ?? Number.POSITIVE_INFINITY
  if (at !== bt) return at - bt
  return a.name.localeCompare(b.name)
}

export function sortProjects(projects: readonly ProjectRowData[]): ProjectRowData[] {
  return [...projects].sort(compareProjects)
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

function startOfMonthUTC(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

function addMonthsUTC(ts: number, months: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)
}

export interface TimelineMonth {
  readonly ts: number
  readonly label: string
  readonly leftPercent: number
}

export interface TimelineMarker {
  readonly project: ProjectRowData
  readonly leftPercent: number
}

export interface RoadmapTimeline {
  readonly start: number
  readonly end: number
  readonly months: readonly TimelineMonth[]
  readonly nowPercent: number | null
  readonly scheduled: readonly TimelineMarker[]
  readonly unscheduled: readonly ProjectRowData[]
}

// A tokenized, dependency-free timeline layout: a horizontal axis from the start of the current
// month (or the earliest target, whichever is earlier) to the end of the latest target, split
// into month gridlines, with each dated project positioned by a left-percent. Projects with no
// target date are returned separately so the view can list them off the axis. Pure and
// deterministic so it is unit-testable and renders sub-100ms.
export function roadmapTimeline(projects: readonly ProjectRowData[], now: number): RoadmapTimeline {
  const dated = projects.filter((p) => p.targetDate !== null)
  const unscheduled = sortProjects(projects.filter((p) => p.targetDate === null))

  const targets = dated.map((p) => p.targetDate as number)
  const earliest = Math.min(now, ...(targets.length > 0 ? targets : [now]))
  const latest = Math.max(now, ...(targets.length > 0 ? targets : [now]))

  const start = startOfMonthUTC(earliest)
  // At least three months of runway so a single near-term project is not crammed at the edge.
  const rawEnd = addMonthsUTC(startOfMonthUTC(latest), 1)
  const end = Math.max(rawEnd, addMonthsUTC(start, 3))
  const span = end - start

  const pct = (ts: number) => Math.min(100, Math.max(0, ((ts - start) / span) * 100))

  const months: TimelineMonth[] = []
  for (let ts = start; ts < end; ts = addMonthsUTC(ts, 1)) {
    months.push({
      ts,
      label: new Date(ts).toLocaleDateString(undefined, {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      leftPercent: pct(ts),
    })
    // Guard against pathological spans (should never trigger for month steps).
    if (months.length > 60) break
  }

  const scheduled = sortProjects(dated).map((project) => ({
    project,
    leftPercent: pct(project.targetDate as number),
  }))

  const nowPercent = now >= start && now <= end ? pct(now) : null

  return { start, end, months, nowPercent, scheduled, unscheduled }
}
