import type { Kysely } from 'kysely'
import type { RetroProposalVerdict } from '../zero/context.js'
import type { RetroProposalCategory } from '../zero/retro/ai-draft.js'
import type { DB } from './types.js'

// The rejected-proposal log: what teams did with what the model drafted, read by an operator and by
// nobody else. It is the ONLY feedback signal the AI layer has about its own output quality — every
// other quality claim in this codebase is an assertion made at build time — so it exists to answer
// "are these drafts worth a team's attention", which no test can answer.
//
// Three properties are structural rather than editorial (design §D6):
//
//  1. **Team-level, and there is no per-person column to omit.** It reads `retro_ai_proposal`,
//     `retro`, `cycle` and `team`, and NEVER `retro_ai_reaction`. `agree_count`/`disagree_count` are
//     the aggregates change 19 stamps once at the `vote -> discuss` advance; who voted which way is
//     not readable by anyone, including an admin, including here.
//  2. **Out of the model's context, structurally.** `retro_ai_proposal` is absent from
//     `retro-facts.ts`'s allowlist and the pg test asserts that set by EQUALITY. A draft that steered
//     away from previously-rejected phrasing would be a model optimizing for approval, which is the
//     opposite of the signal the team is being asked for.
//  3. **A read.** No regenerate, no per-team quality knob, no prompt editor. What an operator does
//     with it is change the model or turn the feature off, and both already exist.
//
// Every select is an explicit column list, for the same reason the fact assembly's are: `retro`
// carries `facilitator_id` and `created_by` one column over from what this needs.

const RECENT_LIMIT = 20

// The two verdicts an operator can act on. An agreed proposal is not a signal about output quality.
const REPORTED_VERDICTS = ['rejected', 'contested'] as const

export interface RetroVerdictTotals {
  readonly teamId: string
  readonly teamName: string
  readonly teamKey: string
  readonly agreed: number
  readonly contested: number
  readonly rejected: number
  readonly unrated: number
  // Drafted but never ratified — the team never advanced past `vote`, so no verdict was stamped.
  // Distinct from `unrated` (ratified, and nobody responded): collapsing the two would read as
  // apathy that did not happen.
  readonly undecided: number
}

export interface RetroVerdictProposal {
  readonly id: string
  readonly teamId: string
  readonly teamName: string
  readonly summary: string
  // The stored category, `follow_up` included — the same value the panel groups on, so the log and
  // the board cannot disagree about which category a rejected proposal was in. The refs are
  // deliberately not carried: an operator is looking at what the team threw away, not at the
  // evidence it pointed at.
  readonly category: RetroProposalCategory
  readonly verdict: RetroProposalVerdict
  readonly agreeCount: number
  readonly disagreeCount: number
  readonly cycleName: string | null
}

export interface RetroVerdictLog {
  readonly totals: readonly RetroVerdictTotals[]
  // Rejected and contested only, newest first.
  readonly recent: readonly RetroVerdictProposal[]
}

export interface RetroVerdictLogOptions {
  readonly limit?: number
}

interface VerdictCounts {
  agreed: number
  contested: number
  rejected: number
  unrated: number
  undecided: number
}

export async function retroVerdictLogForWorkspace(
  db: Kysely<DB>,
  workspaceId: string,
  options: RetroVerdictLogOptions = {},
): Promise<RetroVerdictLog> {
  const counted = await db
    .selectFrom('retro_ai_proposal')
    .innerJoin('team', 'team.id', 'retro_ai_proposal.team_id')
    .select((eb) => [
      'retro_ai_proposal.team_id as teamId',
      'team.name as teamName',
      'team.key as teamKey',
      'retro_ai_proposal.verdict as verdict',
      eb.fn.countAll().as('count'),
    ])
    .where('team.workspace_id', '=', workspaceId)
    .groupBy(['retro_ai_proposal.team_id', 'team.name', 'team.key', 'retro_ai_proposal.verdict'])
    .execute()

  const teams = new Map<string, { name: string; key: string; counts: VerdictCounts }>()
  for (const row of counted) {
    const team = teams.get(row.teamId) ?? {
      name: row.teamName,
      key: row.teamKey,
      counts: { agreed: 0, contested: 0, rejected: 0, unrated: 0, undecided: 0 },
    }
    team.counts[row.verdict ?? 'undecided'] += Number(row.count)
    teams.set(row.teamId, team)
  }

  const totals: RetroVerdictTotals[] = [...teams.entries()]
    .map(([teamId, team]) => ({
      teamId,
      teamName: team.name,
      teamKey: team.key,
      ...team.counts,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName))

  const recent = await db
    .selectFrom('retro_ai_proposal')
    .innerJoin('team', 'team.id', 'retro_ai_proposal.team_id')
    .innerJoin('retro', 'retro.id', 'retro_ai_proposal.retro_id')
    .leftJoin('cycle', 'cycle.id', 'retro.cycle_id')
    .select([
      'retro_ai_proposal.id as id',
      'retro_ai_proposal.team_id as teamId',
      'team.name as teamName',
      'retro_ai_proposal.summary as summary',
      'retro_ai_proposal.category as category',
      'retro_ai_proposal.verdict as verdict',
      'retro_ai_proposal.agree_count as agreeCount',
      'retro_ai_proposal.disagree_count as disagreeCount',
      'cycle.name as cycleName',
    ])
    .where('team.workspace_id', '=', workspaceId)
    .where('retro_ai_proposal.verdict', 'in', REPORTED_VERDICTS)
    .orderBy('retro_ai_proposal.ratified_at', 'desc')
    .limit(options.limit ?? RECENT_LIMIT)
    .execute()

  return {
    totals,
    recent: recent.map((row) => ({
      id: row.id,
      teamId: row.teamId,
      teamName: row.teamName,
      summary: row.summary,
      category: row.category,
      verdict: row.verdict ?? 'unrated',
      agreeCount: row.agreeCount ?? 0,
      disagreeCount: row.disagreeCount ?? 0,
      cycleName: row.cycleName,
    })),
  }
}
