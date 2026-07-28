import {
  areaCatalogFromRules,
  areasForPaths,
  type CycleFacts,
  withCycleAreas,
  XL_CHANGE_THRESHOLD,
} from '@yapm/schema'
import {
  type DB,
  getAiConfig,
  getWorkspaceAiSpendUsd,
  pullRequestSourcesForCycleFacts,
} from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import {
  type ChangedFilesReader,
  MAX_PR_FILE_CALLS,
  RATE_LIMIT_FLOOR,
} from '../connectors/github/files.js'
import type { Logger } from '../logger.js'
import type { AiGateway } from './gateway.js'
import { exceedsSpendCap } from './model-catalog.js'

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
  // The SAME gateway `runCycleDigest` will be handed. Only `resolveModel` is used, and only as the
  // one predicate that decides whether the digest can run at all — see the gate below.
  gateway: Pick<AiGateway, 'resolveModel'>
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

    // A run that will end `ai_off` spends someone else's rate budget for nothing. The condition for
    // that is master toggle AND provider AND resolvable key, and `resolveModel` IS that condition —
    // asking it, rather than re-deriving a subset here, is what keeps this gate from drifting away
    // from `gateway.ts` the next time the resolution rules change.
    if ((await deps.gateway.resolveModel(workspaceId)) === null) return facts

    // The one condition `resolveModel` does not cover: past the cap the run is refused before the
    // model is called, so the enrichment that would have fed it is pure waste.
    const spendSoFarUsd = await getWorkspaceAiSpendUsd(deps.db, workspaceId)
    if (exceedsSpendCap(spendSoFarUsd, config?.data.spendCapUsd ?? null)) return facts

    const sources = await pullRequestSourcesForCycleFacts(deps.db, facts.teamId, prIds)
    if (sources.length === 0) return facts

    const prAreas = new Map<
      string,
      { areas: readonly string[]; changedLines: number; truncated?: boolean }
    >()
    let enriched = 0
    let skipped = 0
    let partial = 0

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
      const changedLines = result.files.reduce((total, file) => total + file.changes, 0)
      prAreas.set(source.id, {
        areas,
        // A truncated file list is banded by what truncation already proves — more than a page of
        // files is "big and everywhere" — rather than by the prefix that happened to be read.
        changedLines: result.truncated ? Math.max(changedLines, XL_CHANGE_THRESHOLD) : changedLines,
        // The signal itself travels with the labels: the area set is a PREFIX, so downstream
        // aggregates that read "these are all the areas it touched" must not be computed from it.
        ...(result.truncated ? { truncated: true } : {}),
      })
      if (result.truncated) partial += 1
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
      coverage: { enriched, skipped, ...(partial > 0 ? { partial } : {}) },
    })
  } catch (error) {
    deps.logger?.error(
      { err: error, cycleId: facts.cycleId },
      'area enrichment failed; producing the digest from un-enriched facts',
    )
    return facts
  }
}
