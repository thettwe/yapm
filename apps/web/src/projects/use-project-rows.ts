import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { useMemo } from 'react'
import type { ProjectCycleRow, ProjectIssueRow, ProjectRowData } from '@/projects/model'

interface RawCycle {
  readonly id: string
  readonly name: string
  readonly startDate: number
  readonly endDate: number
}

// The one read behind both the index and the roadmap: `projects.all` is workspace-scoped, and its
// related issues carry the team-scoped predicate, so every count on either surface is over exactly
// the issues the reader may see.
export function useProjectRows(): {
  readonly projects: readonly ProjectRowData[]
  readonly issuesByProject: ReadonlyMap<string, readonly ProjectIssueRow[]>
  readonly complete: boolean
} {
  const [raw, result] = useQuery(queries.projects.all())

  const projects = useMemo<ProjectRowData[]>(
    () =>
      raw.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        leadId: project.leadId ?? null,
        targetDate: project.targetDate ?? null,
        createdAt: project.createdAt,
      })),
    [raw],
  )

  const issuesByProject = useMemo(() => {
    const map = new Map<string, ProjectIssueRow[]>()
    for (const project of raw) {
      const issues = (project.issues ?? []) as readonly (ProjectIssueRow & {
        readonly cycle?: RawCycle | null
      })[]
      map.set(
        project.id,
        issues.map((issue) => ({
          id: issue.id,
          number: issue.number ?? null,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          assigneeId: issue.assigneeId ?? null,
          cycleId: issue.cycleId ?? null,
          teamId: issue.teamId,
          updatedAt: issue.updatedAt,
          createdAt: issue.createdAt,
          cycle: toCycle(issue.cycle),
        })),
      )
    }
    return map
  }, [raw])

  return { projects, issuesByProject, complete: result.type === 'complete' }
}

function toCycle(cycle: RawCycle | null | undefined): ProjectCycleRow | null {
  if (!cycle) return null
  return { id: cycle.id, name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate }
}
