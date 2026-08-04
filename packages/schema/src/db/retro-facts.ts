import type { Kysely } from 'kysely'
import type { IssueStatus } from '../zero/context.js'
import { buildCycleFacts, type CycleFacts, type CycleFactsIssueInput } from '../zero/cycle-facts.js'
import {
  buildRetroSeed,
  RETRO_ACTION_OUTCOMES,
  type RetroActionOutcome,
  type RetroActionOutcomeTotals,
  type RetroSeed,
  type RetroSeedCycleInput,
  type RetroSeedIssueInput,
  type RetroSeedPrInput,
  retroActionOutcome,
  retroActionOutcomeKey,
  retroActionOutcomeTotals,
} from '../zero/retro/seed.js'
import type { DB } from './types.js'

// The DB read behind the retro AI draft — a sibling of `cycleFactsForTeam`, and the ONLY new server
// read this change adds. What it does NOT read is the whole point (design §D2):
//
//   cycle, team, issue, issue_link, pull_request, ci_check, review, retro, retro_action
//
// and nothing else. It never names `retro_draft`, `retro_card`, `retro_card_author`, `retro_vote`,
// `retro_vote_tally`, `retro_presence`, `retro_ai_proposal` or `comment`, so the model has neither an
// identity dimension nor a single card body and cannot reconstruct an anonymous card's author from
// what it reads. `retro-facts.pg.test.ts` records every `selectFrom` and asserts the set EQUALS that
// allowlist.
//
// `retro` and `retro_action` cross that line and nothing else does (change 22, design §D1). A CARD is
// one person's testimony, written privately and published anonymously with its author binding held in
// a table absent from the Zero schema. A retro ACTION is the opposite artifact in every respect: made
// in the open during `discuss`/`close` as the team's agreed output, carrying no author column at all,
// and already readable by every member through an ordinary team-scoped query. Reading it discloses
// nothing that reading the retro board does not — and `retro_action.card_id`/`.group_id`, the join
// back to the anonymous card, are NEVER selected, so the pipeline holds no edge into the
// anonymity-critical subtree even in principle.
//
// EVERY SELECT IS AN EXPLICIT COLUMN LIST. A `selectAll()` here would be a silent regression rather
// than a visible one: several of these tables carry a provider handle or a user id one column over.
//
// The metrics themselves are computed by `buildRetroSeed` and `buildCycleFacts` — the two existing
// PURE builders, called, never reimplemented, so a metric has exactly one definition in the codebase
// and the panel a human reads and the facts a model reads cannot disagree.

// How many prior completed cycles the seed's sparkline reads. `buildRetroSeed` also clamps to three;
// bounding the query as well keeps the read proportional for a team with years of history.
const MAX_PRIOR_CYCLES = 3

// The issue an agreed action became, as the loop-close needs it. FOUR COLUMNS, and `assignee_id` is
// not one of them: the TYPE is the first line of the strip, before any select list.
export interface PriorRetroActionIssue {
  readonly id: string
  // Nullable in the schema (the sequence stamps it), so the model is told "issue #12" or nothing at
  // all rather than "issue #null".
  readonly number: number | null
  readonly title: string
  readonly status: IssueStatus
}

export interface PriorRetroAction {
  readonly id: string
  readonly body: string
  // Computed by yapm from the converted issue's live status — never a phrase a model chose.
  readonly outcome: RetroActionOutcome
  readonly issue: PriorRetroActionIssue | null
}

export interface PriorRetroFacts {
  readonly cycleId: string
  // Named so a proposal can never imply the actions were agreed more recently than they were: the
  // prior retro can be up to `MAX_PRIOR_CYCLES` cycles back (design §D7).
  readonly cycleName: string
  readonly actions: readonly PriorRetroAction[]
  readonly totals: RetroActionOutcomeTotals
}

export interface RetroFacts {
  readonly teamId: string
  readonly cycleId: string
  readonly cycleName: string
  readonly seed: RetroSeed
  readonly issues: CycleFacts['issues']
  readonly evidenceIds: readonly string[]
  // ABSENT, NOT EMPTY: null when no prior cycle in the window carries a retro with at least one
  // action. A team's first retro takes this path, and the prompt then omits the block entirely rather
  // than telling the model there is "none" — so no follow-up proposal can survive cite-or-omit.
  readonly priorRetro: PriorRetroFacts | null
  // The model's ENTIRE vocabulary of things it may point at: every evidence id yapm computed for the
  // cycle, plus every computed seed metric key across both seed sections, plus every prior action id
  // and the four prior-retro outcome-total keys. The cite-or-omit validator narrows each ref to this
  // set, so a hallucinated issue id, an invented metric key and a fabricated action id die the same
  // death.
  readonly citableIds: readonly string[]
}

interface CycleRow {
  readonly id: string
  readonly name: string
  readonly startDate: Date
}

// The prior retro, and the ONLY read in this module that touches a table carrying an identity column.
// EVERY SELECT HERE IS AN EXPLICIT COLUMN LIST AND EVERY ONE OF THEM IS SHORT:
//
//   retro        -> id, cycle_id                  (never facilitator_id, never created_by)
//   retro_action -> id, retro_id, body, issue_id  (never assignee_id, never card_id, never group_id)
//   issue        -> id, number, title, status     (never assignee_id)
//
// The strip is the column list, not a post-filter: a value that is never read cannot be forgotten
// about downstream. `retro-facts.pg.test.ts` asserts this twice at two altitudes — on the recorded
// column tokens (the read) and on the returned object (the shape) — with rows that really do carry
// two different non-null assignees, so neither assertion can pass vacuously.
//
// Which retro: the newest prior cycle in the already-bounded window that has a retro with at least
// one action (design §D7). Walking past the immediately-preceding cycle is deliberate — a team that
// skipped a retro should still be reminded of the actions it last agreed — and the window is capped
// at `MAX_PRIOR_CYCLES`, so this adds no unbounded scan.
async function loadPriorRetro(
  db: Kysely<DB>,
  teamId: string,
  priorCyclesNewestFirst: readonly CycleRow[],
): Promise<PriorRetroFacts | null> {
  if (priorCyclesNewestFirst.length === 0) return null

  const retros = await db
    .selectFrom('retro')
    .select(['id', 'cycle_id'])
    .where('team_id', '=', teamId)
    .where(
      'cycle_id',
      'in',
      priorCyclesNewestFirst.map((cycle) => cycle.id),
    )
    .execute()
  if (retros.length === 0) return null

  const actions = await db
    .selectFrom('retro_action')
    .select(['id', 'retro_id', 'body', 'issue_id'])
    .where('team_id', '=', teamId)
    .where(
      'retro_id',
      'in',
      retros.map((retro) => retro.id),
    )
    .execute()
  if (actions.length === 0) return null

  const cycleOfRetro = new Map(retros.map((retro) => [retro.id, retro.cycle_id]))
  const chosen = priorCyclesNewestFirst
    .map((cycle) => ({
      cycle,
      rows: actions.filter((action) => cycleOfRetro.get(action.retro_id) === cycle.id),
    }))
    .find((candidate) => candidate.rows.length > 0)
  if (chosen === undefined) return null

  const issueIds = [
    ...new Set(chosen.rows.map((action) => action.issue_id).filter((id) => id !== null)),
  ]
  const issues = issueIds.length
    ? await db
        .selectFrom('issue')
        .select(['id', 'number', 'title', 'status'])
        .where('team_id', '=', teamId)
        .where('id', 'in', issueIds)
        .execute()
    : []
  const issueById = new Map(issues.map((issue) => [issue.id, issue]))

  const items: PriorRetroAction[] = chosen.rows.map((action) => {
    const issue = action.issue_id === null ? undefined : issueById.get(action.issue_id)
    return {
      id: action.id,
      body: action.body,
      outcome: retroActionOutcome(issue?.status ?? null),
      issue:
        issue === undefined
          ? null
          : { id: issue.id, number: issue.number, title: issue.title, status: issue.status },
    }
  })

  return {
    cycleId: chosen.cycle.id,
    cycleName: chosen.cycle.name,
    actions: items,
    totals: retroActionOutcomeTotals(items.map((action) => action.outcome)),
  }
}

export async function retroFactsForCycle(
  db: Kysely<DB>,
  teamId: string,
  cycleId: string,
): Promise<RetroFacts | null> {
  const cycle = await db
    .selectFrom('cycle')
    .select(['id', 'team_id', 'name', 'start_date'])
    .where('id', '=', cycleId)
    .where('team_id', '=', teamId)
    .executeTakeFirst()
  if (!cycle) return null

  const team = await db.selectFrom('team').select('key').where('id', '=', teamId).executeTakeFirst()

  // The sparkline's history: the team's most recent completed cycles that STARTED before this one,
  // oldest-first once reversed, so a re-run for an older cycle never reads the future.
  const priorRows = await db
    .selectFrom('cycle')
    .select(['id', 'name', 'start_date'])
    .where('team_id', '=', teamId)
    .where('status', '=', 'completed')
    .where('id', '!=', cycleId)
    .where('start_date', '<', cycle.start_date)
    .orderBy('start_date', 'desc')
    .limit(MAX_PRIOR_CYCLES)
    .execute()

  const priorCycles: CycleRow[] = priorRows.map((row) => ({
    id: row.id,
    name: row.name,
    startDate: row.start_date,
  }))

  const cycles: CycleRow[] = [
    ...[...priorCycles].reverse(),
    { id: cycle.id, name: cycle.name, startDate: cycle.start_date },
  ]
  const cycleIds = cycles.map((row) => row.id)

  // Match by BOTH the live pointer and the rollover-origin marker, the same dual predicate
  // `cycleFactsForTeam` uses and for the same pre-/post-rollover reason: a carried issue no longer
  // points at the cycle it left but still carries `rolled_over_from_cycle_id`.
  const issues = await db
    .selectFrom('issue')
    .select([
      'id',
      'number',
      'title',
      'status',
      'cycle_id',
      'rolled_over_from_cycle_id',
      'carryover_count',
      'cycle_assigned_at',
    ])
    .where('team_id', '=', teamId)
    .where((eb) =>
      eb.or([eb('cycle_id', 'in', cycleIds), eb('rolled_over_from_cycle_id', 'in', cycleIds)]),
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
          'pull_request.opened_at as prOpenedAt',
          'pull_request.merged_at as prMergedAt',
        ])
        .where('issue_link.team_id', '=', teamId)
        .where('issue_link.issue_id', 'in', issueIds)
        .execute()
    : []

  const prIds = [...new Set(links.map((link) => link.prId))]

  const checks = prIds.length
    ? await db
        .selectFrom('ci_check')
        .select(['id', 'pull_request_id', 'conclusion'])
        .where('pull_request_id', 'in', prIds)
        .execute()
    : []

  // `review.author` IS THE PROVIDER HANDLE (`0009_connectors.ts`) — a real identity, one column over
  // from what this read needs. Only the two columns below are ever selected here: the PR key and the
  // submission instant that time-to-first-review and review-rounds are computed from. Never
  // `selectAll()`, never `author`, and the pg test asserts the recorded column tokens prove it.
  const reviews = prIds.length
    ? await db
        .selectFrom('review')
        .select(['pull_request_id', 'submitted_at'])
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

  const reviewsByPr = new Map<string, number[]>()
  for (const review of reviews) {
    const list = reviewsByPr.get(review.pull_request_id) ?? []
    list.push(review.submitted_at.getTime())
    reviewsByPr.set(review.pull_request_id, list)
  }

  const factsPrsByIssue = new Map<string, CycleFactsIssueInput['pullRequests'][number][]>()
  const seedPrsByIssue = new Map<string, RetroSeedPrInput[]>()
  for (const link of links) {
    const ciChecks = checksByPr.get(link.prId) ?? []
    const factsList = factsPrsByIssue.get(link.issueId) ?? []
    factsList.push({
      id: link.prId,
      number: link.prNumber,
      title: link.prTitle,
      state: link.prState,
      ciChecks,
    })
    factsPrsByIssue.set(link.issueId, factsList)

    const seedList = seedPrsByIssue.get(link.issueId) ?? []
    seedList.push({
      openedAt: link.prOpenedAt.getTime(),
      mergedAt: link.prMergedAt?.getTime() ?? null,
      reviewSubmittedAt: reviewsByPr.get(link.prId) ?? [],
      ciConclusions: ciChecks.map((check) => check.conclusion),
    })
    seedPrsByIssue.set(link.issueId, seedList)
  }

  const seedIssuesForCycle = (id: string): RetroSeedIssueInput[] =>
    issues
      .filter((issue) => issue.cycle_id === id || issue.rolled_over_from_cycle_id === id)
      .map((issue) => ({
        id: issue.id,
        status: issue.status,
        cycleId: issue.cycle_id,
        rolledOverFromCycleId: issue.rolled_over_from_cycle_id,
        carryoverCount: issue.carryover_count,
        cycleAssignedAt: issue.cycle_assigned_at?.getTime() ?? null,
        pullRequests: seedPrsByIssue.get(issue.id) ?? [],
      }))

  const seedCycle = (row: CycleRow): RetroSeedCycleInput => ({
    id: row.id,
    name: row.name,
    startDate: row.startDate.getTime(),
    issues: seedIssuesForCycle(row.id),
  })

  const seed = buildRetroSeed({
    cycle: seedCycle({ id: cycle.id, name: cycle.name, startDate: cycle.start_date }),
    priorCycles: cycles.slice(0, -1).map(seedCycle),
  })

  // The per-issue evidence bundles are the CLOSED cycle's issues only — the prior cycles exist for
  // the sparkline, not for the narrative.
  const facts = buildCycleFacts({
    cycle: { id: cycle.id, teamId: cycle.team_id, name: cycle.name },
    teamKey: team?.key ?? null,
    issues: issues
      .filter(
        (issue) => issue.cycle_id === cycle.id || issue.rolled_over_from_cycle_id === cycle.id,
      )
      .map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        status: issue.status,
        pullRequests: factsPrsByIssue.get(issue.id) ?? [],
      })),
  })

  const priorRetro = await loadPriorRetro(db, teamId, priorCycles)

  const metricKeys = seed.sections.flatMap((section) => section.metrics.map((metric) => metric.key))

  // `priorRetro === null` contributes NO id and NO key, which is what makes "a first retro produces
  // no follow-up proposal" a property of the shipped cite-or-omit validator rather than of a new
  // branch: a model that invents an action id has the reference narrowed away and the proposal
  // dropped. The prior actions' converted-issue ids are deliberately NOT added — a proposal may point
  // at an action, and at the cycle's own evidence, and at nothing else.
  const priorIds =
    priorRetro === null
      ? []
      : [
          ...priorRetro.actions.map((action) => action.id),
          ...RETRO_ACTION_OUTCOMES.map(retroActionOutcomeKey),
        ]

  return {
    teamId: cycle.team_id,
    cycleId: cycle.id,
    cycleName: cycle.name,
    seed,
    issues: facts.issues,
    evidenceIds: facts.evidenceIds,
    priorRetro,
    citableIds: [...new Set([...facts.evidenceIds, ...metricKeys, ...priorIds])],
  }
}
