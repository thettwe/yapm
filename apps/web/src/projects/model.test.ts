import { describe, expect, it } from 'vitest'
import type { IssueRowData } from '@/issues/model'
import {
  compareProjects,
  groupProjectsByStatus,
  issueStateSegments,
  type ProjectCycleRow,
  type ProjectIssueRow,
  type ProjectRowData,
  pastTargetReading,
  projectProgress,
  roadmapAxis,
  sortProjects,
  targetStrip,
  teamSplit,
} from '@/projects/model'

function issue(over: Partial<IssueRowData>): IssueRowData {
  return {
    id: 'i',
    title: 't',
    status: 'todo',
    priority: 'no_priority',
    assigneeId: null,
    updatedAt: 0,
    createdAt: 0,
    ...over,
  }
}

function projectIssue(over: Partial<ProjectIssueRow>): ProjectIssueRow {
  return { ...issue({}), teamId: 'team-eng', cycle: null, ...over }
}

function project(over: Partial<ProjectRowData>): ProjectRowData {
  return {
    id: 'p',
    name: 'Project',
    status: 'planned',
    leadId: null,
    targetDate: null,
    createdAt: 0,
    ...over,
  }
}

const DAY = 86_400_000
const TODAY = Date.UTC(2026, 7, 7, 11, 30)

describe('projectProgress', () => {
  it('is 0/0 with 0% for an empty project (never NaN)', () => {
    expect(projectProgress([])).toEqual({ total: 0, done: 0, percent: 0 })
  })

  it('counts only Done toward progress; canceled counts to total but not done', () => {
    const issues = [
      issue({ id: '1', status: 'done' }),
      issue({ id: '2', status: 'in_progress' }),
      issue({ id: '3', status: 'canceled' }),
      issue({ id: '4', status: 'done' }),
    ]
    expect(projectProgress(issues)).toEqual({ total: 4, done: 2, percent: 50 })
  })
})

describe('compareProjects / sortProjects', () => {
  it('orders active before planned before completed before cancelled', () => {
    const projects = [
      project({ id: 'a', status: 'completed' }),
      project({ id: 'b', status: 'active' }),
      project({ id: 'c', status: 'cancelled' }),
      project({ id: 'd', status: 'planned' }),
    ]
    expect(sortProjects(projects).map((p) => p.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('is a total order (stable on name tiebreak)', () => {
    const a = project({ id: 'a', name: 'Zebra', status: 'active', targetDate: 1 })
    const b = project({ id: 'b', name: 'Apple', status: 'active', targetDate: 1 })
    expect(compareProjects(a, b)).toBeGreaterThan(0)
  })
})

describe('groupProjectsByStatus', () => {
  it('drops a status nothing is in — no header over zero rows', () => {
    const groups = groupProjectsByStatus([
      project({ id: 'a', status: 'active' }),
      project({ id: 'b', status: 'completed' }),
    ])
    expect(groups.map((group) => group.label)).toEqual(['Active', 'Completed'])
  })

  it('sorts inside a group by target date, undated last, then by name', () => {
    const groups = groupProjectsByStatus([
      project({ id: 'none-z', name: 'Zulu', status: 'active', targetDate: null }),
      project({ id: 'late', name: 'Late', status: 'active', targetDate: 3_000 }),
      project({ id: 'none-a', name: 'Alfa', status: 'active', targetDate: null }),
      project({ id: 'early', name: 'Early', status: 'active', targetDate: 1_000 }),
    ])
    expect(groups[0]?.projects.map((p) => p.id)).toEqual(['early', 'late', 'none-a', 'none-z'])
  })
})

describe('teamSplit', () => {
  it('partitions the readable issues, summing to their total by construction', () => {
    const issues = [
      projectIssue({ id: '1', teamId: 'eng' }),
      projectIssue({ id: '2', teamId: 'eng' }),
      projectIssue({ id: '3', teamId: 'des' }),
    ]
    const split = teamSplit(
      issues,
      new Map([
        ['eng', 'ENG'],
        ['des', 'DES'],
      ]),
    )
    expect(split.map((entry) => `${entry.teamKey} ${entry.count}`)).toEqual(['ENG 2', 'DES 1'])
    expect(split.reduce((sum, entry) => sum + entry.count, 0)).toBe(issues.length)
  })

  it('is empty for a project with no readable issues', () => {
    expect(teamSplit([], new Map())).toEqual([])
  })
})

describe('pastTargetReading', () => {
  it('reads past with the count of issues not at done', () => {
    const reading = pastTargetReading(
      project({ status: 'active', targetDate: TODAY - 6 * DAY }),
      [issue({ id: '1', status: 'todo' }), issue({ id: '2', status: 'in_progress' })],
      TODAY,
    )
    expect(reading.passed).toBe(true)
    expect(reading.openCount).toBe(2)
    expect(reading.daysPast).toBe(6)
  })

  it('excludes a completed project however old its target', () => {
    const reading = pastTargetReading(
      project({ status: 'completed', targetDate: TODAY - 30 * DAY }),
      [issue({ id: '1', status: 'done' })],
      TODAY,
    )
    expect(reading.passed).toBe(false)
  })

  it('does not fire on the target day itself', () => {
    const today = pastTargetReading(
      project({ status: 'active', targetDate: Date.UTC(2026, 7, 7) }),
      [],
      TODAY,
    )
    expect(today.passed).toBe(false)
    const yesterday = pastTargetReading(
      project({ status: 'active', targetDate: Date.UTC(2026, 7, 6) }),
      [],
      TODAY,
    )
    expect(yesterday.passed).toBe(true)
  })

  it('never fires without a target date', () => {
    expect(pastTargetReading(project({ status: 'active' }), [], TODAY).passed).toBe(false)
  })
})

describe('issueStateSegments', () => {
  it('yields no segments at all for a project with no issues', () => {
    expect(issueStateSegments([])).toEqual([])
  })

  it('draws one segment per occupied status, fractions summing to one', () => {
    const segments = issueStateSegments([
      issue({ id: '1', status: 'done' }),
      issue({ id: '2', status: 'done' }),
      issue({ id: '3', status: 'todo' }),
    ])
    expect(segments.map((segment) => segment.status)).toEqual(['todo', 'done'])
    expect(segments.every((segment) => Number.isFinite(segment.fraction))).toBe(true)
    expect(segments.reduce((sum, segment) => sum + segment.fraction, 0)).toBeCloseTo(1)
  })
})

describe('targetStrip', () => {
  it('is null for an undated project — there is no second date to draw against', () => {
    expect(targetStrip(project({ targetDate: null }), TODAY)).toBeNull()
  })

  it('marks the overrun when today is past the target', () => {
    const strip = targetStrip(
      project({ createdAt: TODAY - 44 * DAY, targetDate: TODAY - 6 * DAY }),
      TODAY,
    )
    expect(strip).not.toBeNull()
    expect(strip?.overrun).not.toBeNull()
    expect(strip?.nowFraction).toBe(1)
    expect(strip?.targetFraction).toBeLessThan(1)
  })

  it('draws no overrun before the target', () => {
    const strip = targetStrip(
      project({ createdAt: TODAY - 10 * DAY, targetDate: TODAY + 10 * DAY }),
      TODAY,
    )
    expect(strip?.overrun).toBeNull()
    expect(strip?.targetFraction).toBe(1)
  })
})

describe('roadmapAxis', () => {
  const cycle = (over: Partial<ProjectCycleRow>): ProjectCycleRow => ({
    id: 'c',
    name: 'Cycle 2',
    startDate: Date.UTC(2026, 6, 30),
    endDate: Date.UTC(2026, 7, 12),
    ...over,
  })

  function axis(over: Partial<Parameters<typeof roadmapAxis>[0]>) {
    return roadmapAxis({
      projects: [],
      issuesByProject: new Map(),
      cycles: [],
      now: TODAY,
      ...over,
    })
  }

  it('starts the window at the current cycle when one exists', () => {
    const current = cycle({})
    expect(axis({ cycles: [current] }).window.start).toBe(current.startDate)
  })

  it('falls back to the start of the current month with no cycles at all', () => {
    const built = axis({})
    expect(built.window.start).toBe(Date.UTC(2026, 7, 1))
    expect(built.cycleBands).toEqual([])
    expect(built.lastCycleEnd).toBeNull()
  })

  it('reports where the stored cycles run out so the surface can say so', () => {
    const built = axis({
      cycles: [cycle({}), cycle({ id: 'c3', name: 'Cycle 3', endDate: Date.UTC(2026, 8, 23) })],
    })
    expect(built.lastCycleEnd).toBe(Date.UTC(2026, 8, 23))
  })

  it('runs at least three months even for one near-term project', () => {
    const built = axis({ projects: [project({ targetDate: TODAY + DAY })] })
    expect(built.window.end).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 1))
  })

  it('orders rows by target date and holds undated ones aside', () => {
    const built = axis({
      projects: [
        project({ id: 'late', name: 'Late', targetDate: Date.UTC(2026, 8, 9) }),
        project({ id: 'none', name: 'None', targetDate: null }),
        project({ id: 'soon', name: 'Soon', targetDate: Date.UTC(2026, 7, 12) }),
      ],
    })
    expect(built.rows.map((row) => row.project.id)).toEqual(['soon', 'late', 'none'])
    expect(built.rows.map((row) => row.dated)).toEqual([true, true, false])
    expect(built.rows.at(-1)?.targetFraction).toBeNull()
  })

  it('positions an issue mark inside its OWN cycle, and none for an uncycled issue', () => {
    const own = cycle({ id: 'c2' })
    const built = axis({
      cycles: [own],
      projects: [project({ id: 'p1', targetDate: Date.UTC(2026, 7, 20) })],
      issuesByProject: new Map([
        ['p1', [projectIssue({ id: 'a', cycle: own }), projectIssue({ id: 'b', cycle: null })]],
      ]),
    })
    const row = built.rows[0]
    expect(row?.scheduledCount).toBe(1)
    expect(row?.marks).toHaveLength(1)
    const fraction = row?.marks[0]?.fraction ?? -1
    const start = (own.startDate - built.window.start) / (built.window.end - built.window.start)
    const end = (own.endDate - built.window.start) / (built.window.end - built.window.start)
    expect(fraction).toBeGreaterThan(start)
    expect(fraction).toBeLessThan(end)
  })

  it("positions a mark from another team's cycle, which draws no band of its own", () => {
    const other = cycle({
      id: 'other',
      name: 'DES 4',
      startDate: Date.UTC(2026, 8, 1),
      endDate: Date.UTC(2026, 8, 14),
    })
    const built = axis({
      cycles: [cycle({})],
      projects: [project({ id: 'p1', targetDate: Date.UTC(2026, 8, 20) })],
      issuesByProject: new Map([['p1', [projectIssue({ id: 'a', cycle: other })]]]),
    })
    expect(built.cycleBands.map((band) => band.id)).toEqual(['c'])
    expect(built.rows[0]?.marks).toHaveLength(1)
  })

  it('states a passed target on the row, and never on a completed project', () => {
    const built = axis({
      projects: [
        project({ id: 'late', name: 'Late', status: 'active', targetDate: TODAY - 6 * DAY }),
        project({
          id: 'shipped',
          name: 'Shipped',
          status: 'completed',
          targetDate: TODAY - 6 * DAY,
        }),
      ],
    })
    expect(built.rows.find((row) => row.project.id === 'late')?.targetPassed).toBe(true)
    expect(built.rows.find((row) => row.project.id === 'shipped')?.targetPassed).toBe(false)
  })

  // The structural refusal, asserted over the returned shapes rather than by reading the source:
  // a project stores no start, so nothing on a row may carry one, or a span, or a width.
  it('returns no start, span, duration or width on any row', () => {
    const built = axis({
      cycles: [cycle({})],
      projects: [project({ id: 'p1', targetDate: TODAY + 3 * DAY })],
      issuesByProject: new Map([['p1', [projectIssue({ id: 'a', cycle: cycle({}) })]]]),
    })
    const forbidden = /start|span|duration|width|length|left|end/i
    for (const row of built.rows) {
      expect(Object.keys(row).filter((key) => forbidden.test(key))).toEqual([])
      for (const mark of row.marks) {
        expect(Object.keys(mark).filter((key) => forbidden.test(key))).toEqual([])
      }
    }
  })
})
