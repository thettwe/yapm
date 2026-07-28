import type { Kysely } from 'kysely'
import { buildCycleFacts, type CycleFacts, type CycleFactsIssueInput } from '../zero/cycle-facts.js'
import type { DB } from './types.js'

// The DB read behind the substrate's team-scoped narrowed query: assemble an identity-free,
// issue-first `CycleFacts` for one cycle. Deliberately selects NO `assignee_id`/`creator_id`/PR
// author/review dimension — the blameless guarantee is enforced by what this query does NOT read.
// Returns null when the cycle is absent for the team. The numbers are computed in `buildCycleFacts`,
// never by any model. This feeds the server-side pre-compute job (no client), so a plain Kysely read
// is the simplest shape; it stays in `packages/schema` with the rest of the read surface.
export async function cycleFactsForTeam(
  db: Kysely<DB>,
  teamId: string,
  cycleId: string,
): Promise<CycleFacts | null> {
  const cycle = await db
    .selectFrom('cycle')
    .select(['id', 'team_id', 'name'])
    .where('id', '=', cycleId)
    .where('team_id', '=', teamId)
    .executeTakeFirst()
  if (!cycle) return null

  const team = await db.selectFrom('team').select('key').where('id', '=', teamId).executeTakeFirst()

  // Match the cycle's issues by BOTH the live pointer and the rollover-origin marker, so the facts
  // are correct whether this runs BEFORE rollover (the scheduler's `onCycleClosing` — every issue
  // still points at `cycleId`, no marker set yet) or AFTER it (the maintenance sweep re-computing a
  // manually-completed cycle — done/canceled issues still point here, carried issues moved on but
  // carry `rolled_over_from_cycle_id = cycleId`). An issue never matches both branches.
  const issues = await db
    .selectFrom('issue')
    .select(['id', 'number', 'title', 'status'])
    .where('team_id', '=', teamId)
    .where((eb) =>
      eb.or([eb('cycle_id', '=', cycleId), eb('rolled_over_from_cycle_id', '=', cycleId)]),
    )
    .execute()

  const issueIds = issues.map((issue) => issue.id)

  const links = issueIds.length
    ? await db
        .selectFrom('issue_link')
        .innerJoin('pull_request', 'pull_request.id', 'issue_link.pull_request_id')
        .select([
          'issue_link.issue_id as issueId',
          'pull_request.id as prId',
          'pull_request.number as prNumber',
          'pull_request.title as prTitle',
          'pull_request.state as prState',
        ])
        .where('issue_link.team_id', '=', teamId)
        .where('issue_link.issue_id', 'in', issueIds)
        .execute()
    : []

  const prIds = links.map((link) => link.prId)
  const checks = prIds.length
    ? await db
        .selectFrom('ci_check')
        .select(['id', 'pull_request_id', 'conclusion'])
        .where('pull_request_id', 'in', prIds)
        .execute()
    : []

  const checksByPr = new Map<
    string,
    { id: string; conclusion: (typeof checks)[number]['conclusion'] }[]
  >()
  for (const check of checks) {
    const list = checksByPr.get(check.pull_request_id) ?? []
    list.push({ id: check.id, conclusion: check.conclusion })
    checksByPr.set(check.pull_request_id, list)
  }

  const prsByIssue = new Map<string, CycleFactsIssueInput['pullRequests'][number][]>()
  for (const link of links) {
    const list = prsByIssue.get(link.issueId) ?? []
    list.push({
      id: link.prId,
      number: link.prNumber,
      title: link.prTitle,
      state: link.prState,
      ciChecks: checksByPr.get(link.prId) ?? [],
    })
    prsByIssue.set(link.issueId, list)
  }

  return buildCycleFacts({
    cycle: { id: cycle.id, teamId: cycle.team_id, name: cycle.name },
    teamKey: team?.key ?? null,
    issues: issues.map((issue) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      status: issue.status,
      pullRequests: prsByIssue.get(issue.id) ?? [],
    })),
  })
}

// Where a pull request lives, and nothing else. The area-enrichment step needs `(repo, number,
// installation)` to ask the provider which files a PR touched, and `CycleFacts` deliberately does
// not carry them.
export interface PullRequestSource {
  readonly id: string
  readonly repo: string
  readonly number: number
  readonly installationId: string
  readonly externalInstallationId: string
}

// An EXPLICIT column list, never `selectAll()` — same discipline and same reason as
// `cycleFactsForTeam`: no identity-bearing column can be introduced by accident, and no PR title
// (attacker-influenceable free text) comes along for the ride. Ordered by id so a run truncated by
// the per-cycle call cap is reproducible.
export async function pullRequestSourcesForCycleFacts(
  db: Kysely<DB>,
  teamId: string,
  prIds: readonly string[],
): Promise<PullRequestSource[]> {
  if (prIds.length === 0) return []
  return db
    .selectFrom('pull_request')
    .innerJoin(
      'connector_installation',
      'connector_installation.id',
      'pull_request.installation_id',
    )
    .select([
      'pull_request.id as id',
      'pull_request.repo as repo',
      'pull_request.number as number',
      'pull_request.installation_id as installationId',
      'connector_installation.external_installation_id as externalInstallationId',
    ])
    .where('pull_request.team_id', '=', teamId)
    .where('pull_request.id', 'in', [...prIds])
    .orderBy('pull_request.id')
    .execute()
}
