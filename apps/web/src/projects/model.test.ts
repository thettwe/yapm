import { describe, expect, it } from 'vitest'
import type { IssueRowData } from '@/issues/model'
import {
  compareProjects,
  type ProjectRowData,
  projectProgress,
  roadmapTimeline,
  sortProjects,
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

  it('rounds the percentage', () => {
    const issues = [
      issue({ id: '1', status: 'done' }),
      issue({ id: '2', status: 'todo' }),
      issue({ id: '3', status: 'todo' }),
    ]
    expect(projectProgress(issues).percent).toBe(33)
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

  it('within a status, earlier target dates sort first and missing targets last', () => {
    const projects = [
      project({ id: 'late', status: 'active', targetDate: 3_000 }),
      project({ id: 'none', status: 'active', targetDate: null }),
      project({ id: 'early', status: 'active', targetDate: 1_000 }),
    ]
    expect(sortProjects(projects).map((p) => p.id)).toEqual(['early', 'late', 'none'])
  })

  it('is a total order (stable on name tiebreak)', () => {
    const a = project({ id: 'a', name: 'Zebra', status: 'active', targetDate: 1 })
    const b = project({ id: 'b', name: 'Apple', status: 'active', targetDate: 1 })
    expect(compareProjects(a, b)).toBeGreaterThan(0)
  })
})

describe('roadmapTimeline', () => {
  const jan = Date.UTC(2026, 0, 15)
  const feb = Date.UTC(2026, 1, 20)
  const apr = Date.UTC(2026, 3, 10)

  it('splits dated projects onto a month axis and holds undated ones aside', () => {
    const projects = [
      project({ id: 'a', targetDate: feb, status: 'active' }),
      project({ id: 'b', targetDate: apr, status: 'planned' }),
      project({ id: 'c', targetDate: null }),
    ]
    const timeline = roadmapTimeline(projects, jan)
    expect(timeline.scheduled.map((m) => m.project.id)).toEqual(['a', 'b'])
    expect(timeline.unscheduled.map((p) => p.id)).toEqual(['c'])
    expect(timeline.months.length).toBeGreaterThanOrEqual(3)
  })

  it('positions every marker within 0..100 percent, earlier dates further left', () => {
    const projects = [
      project({ id: 'early', targetDate: feb }),
      project({ id: 'late', targetDate: apr }),
    ]
    const timeline = roadmapTimeline(projects, jan)
    for (const marker of timeline.scheduled) {
      expect(marker.leftPercent).toBeGreaterThanOrEqual(0)
      expect(marker.leftPercent).toBeLessThanOrEqual(100)
    }
    const early = timeline.scheduled.find((m) => m.project.id === 'early')
    const late = timeline.scheduled.find((m) => m.project.id === 'late')
    expect(early?.leftPercent).toBeLessThan(late?.leftPercent ?? 0)
  })

  it('shows a now-marker within the range and at least three months of runway', () => {
    const timeline = roadmapTimeline([project({ id: 'a', targetDate: feb })], jan)
    expect(timeline.nowPercent).not.toBeNull()
    expect(timeline.months.length).toBeGreaterThanOrEqual(3)
  })

  it('handles a workspace with no dated projects without crashing', () => {
    const timeline = roadmapTimeline([project({ id: 'a', targetDate: null })], jan)
    expect(timeline.scheduled).toEqual([])
    expect(timeline.unscheduled.map((p) => p.id)).toEqual(['a'])
    expect(timeline.months.length).toBeGreaterThanOrEqual(3)
  })
})
