import { areaCatalogFromRules, areasForPaths, type CycleFacts, withCycleAreas } from '@yapm/schema'
import { type DB, getAiConfig, pullRequestSourcesForCycleFacts } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import {
  type ChangedFilesReader,
  MAX_PR_FILE_CALLS,
  RATE_LIMIT_FLOOR,
} from '../connectors/github/files.js'
import type { Logger } from '../logger.js'

// The transient area-enrichment step, run inside the EXISTING cycle-digest worker immediately
// before `runCycleDigest`. It reads which files each merged PR touched, converts every path into an
// admin-authored area label, and DISCARDS the file metadata — nothing from the provider response is
// persisted anywhere: no column, no cache table, no derived value.
//
// The no-egress property of the AI step is intact: this read is yapm-initiated, completes BEFORE
// the request is assembled, is never mounted as a tool, and the model has no way to cause it, steer
// it, or see what was fetched. What it sees is labels yapm computed from a map an admin wrote.
//
// Best-effort by construction. Any failure logs and returns the un-enriched facts, so the digest
// still ends `ready` and degrades to exactly the content it produced before this capability existed.

export interface EnrichCycleFactsDeps {
  db: Kysely<DB>
  // Null when the GitHub connector is disabled. The digest then runs un-enriched.
  changedFilesReader: ChangedFilesReader | null
  logger?: Logger
}

export interface EnrichCycleFactsInput {
  workspaceId: string
  facts: CycleFacts
}

function pullRequestIds(facts: CycleFacts): string[] {
  return [
    ...new Set(
      facts.issues.flatMap((issue) =>
        issue.evidenceRefs.filter((ref) => ref.kind === 'pull_request').map((ref) => ref.id),
      ),
    ),
  ]
}

export async function enrichCycleFactsWithAreas(
  deps: EnrichCycleFactsDeps,
  input: EnrichCycleFactsInput,
): Promise<CycleFacts> {
  const { facts, workspaceId } = input
  const reader = deps.changedFilesReader
  if (!reader) return facts

  try {
    const config = await getAiConfig(deps.db, workspaceId)
    const rules = config?.data.areas ?? []
    // ZERO provider calls until an admin opts in. The feature costs nothing against the shared
    // installation rate budget until the workspace decides it is worth something.
    if (rules.length === 0) return facts

    const prIds = pullRequestIds(facts)
    if (prIds.length === 0) return facts

    const sources = await pullRequestSourcesForCycleFacts(deps.db, facts.teamId, prIds)
    if (sources.length === 0) return facts

    const prAreas = new Map<string, { areas: readonly string[]; changedLines: number }>()
    let enriched = 0
    let skipped = 0

    for (const [index, source] of sources.entries()) {
      if (enriched >= MAX_PR_FILE_CALLS) {
        skipped += 1
        continue
      }
      // SERIALLY, never concurrently — GitHub's own guidance, quoted verbatim in
      // `reference/connectors.md` §3.3, and the same discipline reconciliation already follows.
      const result = await reader({
        externalInstallationId: source.externalInstallationId,
        repoFullName: source.repo,
        number: source.number,
      })
      const { areas } = areasForPaths(
        rules,
        result.files.map((file) => file.path),
      )
      prAreas.set(source.id, {
        areas,
        changedLines: result.files.reduce((total, file) => total + file.changes, 0),
      })
      enriched += 1

      if (result.rateLimitRemaining !== null && result.rateLimitRemaining < RATE_LIMIT_FLOOR) {
        skipped += sources.length - index - 1
        deps.logger?.warn(
          { cycleId: facts.cycleId, remaining: result.rateLimitRemaining, enriched, skipped },
          'area enrichment stopped: installation rate-limit quota below the floor',
        )
        break
      }
    }

    return withCycleAreas(facts, {
      prAreas,
      catalog: areaCatalogFromRules(rules),
      coverage: { enriched, skipped },
    })
  } catch (error) {
    deps.logger?.error(
      { err: error, cycleId: facts.cycleId },
      'area enrichment failed; producing the digest from un-enriched facts',
    )
    return facts
  }
}
