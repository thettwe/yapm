import type { CycleDigestStatus, CycleStatus, IssueStatus } from './context.js'
import { compareCycles, cycleKeyOf, hasCycleReport, isCycleWrapped } from './cycles.js'
import { plural } from './metrics/scope.js'
import { buildScopeBand } from './team-home.js'

// THE REGISTER — the history of cycles and the work that persists between them, computed in one
// place over rows the page already syncs (design §D1). Pure and deterministic: no ZQL, no React,
// no clock (every fact here is a stored status or a stored count; see §"Decisions made during
// implementation" for why no `now` is taken).
//
// What this file refuses to derive is as load-bearing as what it derives: there is no issue
// status-history table, so nothing here can be a series over time.

// ---------------------------------------------------------------------------
// Input rows — structural, satisfied by `cycles.byTeam`, `issues.byTeam`, `retros.byTeam` and
// `digests.byTeam`, which the page already holds.
// ---------------------------------------------------------------------------

export interface CycleRegisterCycleRow {
  readonly id: string
  readonly number?: number | null
  readonly name: string
  readonly status: CycleStatus
  readonly startDate: number
  readonly endDate: number
}

export interface CycleRegisterIssueRow {
  readonly id: string
  readonly number?: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly cycleId?: string | null
  readonly cycleAssignedAt?: number | null
  readonly carryoverCount?: number | null
  readonly rolledOverFromCycleId?: string | null
}

export interface CycleRegisterRetroRow {
  readonly cycleId?: string | null
  readonly closedAt?: number | null
}

export interface CycleRegisterDigestRow {
  readonly cycleId?: string | null
  readonly status: CycleDigestStatus
  readonly content?: unknown
}

export interface CycleRegisterInput {
  readonly teamKey: string
  readonly cycles: readonly CycleRegisterCycleRow[]
  readonly issues: readonly CycleRegisterIssueRow[]
  readonly retros: readonly CycleRegisterRetroRow[]
  readonly digests: readonly CycleRegisterDigestRow[]
}

// ---------------------------------------------------------------------------
// Output model.
// ---------------------------------------------------------------------------

export type CycleGlyphKind = 'upcoming' | 'active' | 'completed'

export type ScopeBlockKind = 'landed' | 'open' | 'added'

export interface CycleLedger {
  // False once the committed total stops being reconstructible — see `latestCompletedId` below.
  // The row then draws no open remainder and reads `N landed` rather than `N/M`.
  readonly denominatorKnown: boolean
  readonly committed: number
  readonly landed: number
  readonly added: number
  readonly band: readonly ScopeBlockKind[]
  // The mono reading beside the band: `8/12`, or `10 landed` where the denominator is gone.
  readonly reading: string
  // What the drawing announces. Nothing on the row is carried by colour alone.
  readonly label: string
}

export interface CycleRegisterRow {
  readonly cycleId: string
  readonly key: string
  readonly name: string
  readonly status: CycleStatus
  readonly glyph: CycleGlyphKind
  readonly startDate: number
  readonly endDate: number
  // Null for a cycle no issue ever touched: the cell folds rather than drawing an empty rail.
  readonly ledger: CycleLedger | null
  // How many issues this cycle handed forward. Published only where the carried set is still
  // addressable; 0 folds rather than drawing a zero.
  readonly carriedForward: number
  readonly chips: { readonly cycleReport: boolean; readonly wrapped: boolean }
}

export type CycleCarryNodeKind = 'unnamed' | 'origin' | 'now'

export interface CycleCarryChain {
  readonly nodes: readonly CycleCarryNodeKind[]
  // The dotted lead-in standing for the part of the chain before the record begins.
  readonly leadIn: boolean
}

export interface CycleCarriedRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  readonly status: IssueStatus
  readonly depth: number
  readonly originCycleId: string | null
  readonly originCycleName: string | null
  readonly chain: CycleCarryChain
  // The row's fact in text — the chain is a drawing and announces nothing.
  readonly fact: string
  readonly say: string
  readonly deep: boolean
}

export interface CycleCarriedIn {
  readonly count: number
  // Named only when every carried row left the SAME cycle; otherwise the band header says nothing.
  readonly originName: string | null
  readonly rows: readonly CycleCarriedRow[]
}

export interface CycleRegister {
  // Newest first: the canonical cycle order, reversed.
  readonly rows: readonly CycleRegisterRow[]
  readonly carriedIn: (cycleId: string | null) => CycleCarriedIn | null
}

// A row is drawn in the amber wash from this depth up. Not a badge and not urgent ink: a carried
// issue is not one of the four attention classes, so it may not add a second attention number.
export const CARRY_DEEP_DEPTH = 3

const GLYPH_OF: Record<CycleStatus, CycleGlyphKind> = {
  upcoming: 'upcoming',
  active: 'active',
  completed: 'completed',
}

function issueKeyOf(teamKey: string, issue: { readonly number?: number | null }): string {
  return issue.number == null ? `${teamKey}‑…` : `${teamKey}-${issue.number}`
}

function cycleNameOf(cycle: CycleRegisterCycleRow): string {
  return cycle.name.trim() === '' ? cycleKeyOf(cycle) : cycle.name
}

type IssueIndex = ReadonlyMap<string, readonly CycleRegisterIssueRow[]>

function bucket(
  map: Map<string, CycleRegisterIssueRow[]>,
  key: string,
  row: CycleRegisterIssueRow,
) {
  const existing = map.get(key)
  if (existing === undefined) map.set(key, [row])
  else existing.push(row)
}

export function buildCycleRegister(input: CycleRegisterInput): CycleRegister {
  const ordered = [...input.cycles].sort(compareCycles)
  const byId = new Map(ordered.map((cycle) => [cycle.id, cycle]))

  // ONE PASS over the team's issue set builds both indexes every row reads. Filtering per cycle
  // instead would make the page O(cycles × issues) where the surface it replaces was O(issues),
  // and this whole derivation re-runs on every synced issue change.
  const pointingBy = new Map<string, CycleRegisterIssueRow[]>()
  const carriedOutBy = new Map<string, CycleRegisterIssueRow[]>()
  for (const issue of input.issues) {
    const cycleId = issue.cycleId ?? null
    if (cycleId !== null) bucket(pointingBy, cycleId, issue)
    const leftCycleId = issue.rolledOverFromCycleId ?? null
    if (leftCycleId !== null) bucket(carriedOutBy, leftCycleId, issue)
  }

  // WHY THE DENOMINATOR DEGRADES: `cycle.complete` re-points each unfinished issue at the
  // successor and stamps `rolled_over_from_cycle_id` with the cycle it left — and that column is
  // OVERWRITTEN the next time the issue carries. So a completed cycle's carried set, and with it
  // its committed total, is reconstructible only while no completed cycle follows it.
  const latestCompletedId =
    ordered.filter((cycle) => cycle.status === 'completed').at(-1)?.id ?? null

  const rows = ordered
    .map((cycle) => buildRow(cycle, input, latestCompletedId, pointingBy, carriedOutBy))
    .reverse()

  return {
    rows,
    carriedIn: (cycleId) => buildCarriedIn(cycleId, input.teamKey, pointingBy, byId),
  }
}

function buildRow(
  cycle: CycleRegisterCycleRow,
  input: CycleRegisterInput,
  latestCompletedId: string | null,
  pointingBy: IssueIndex,
  carriedOutBy: IssueIndex,
): CycleRegisterRow {
  const pointing = pointingBy.get(cycle.id) ?? []
  const carriedOut = carriedOutBy.get(cycle.id) ?? []
  const denominatorKnown = cycle.status !== 'completed' || cycle.id === latestCompletedId

  const pointingIds = new Set(pointing.map((issue) => issue.id))
  const ledgerIssues =
    denominatorKnown && cycle.status === 'completed'
      ? [
          ...pointing,
          ...carriedOut.filter((issue) => !pointingIds.has(issue.id)).map(asCommittedCarryOut),
        ]
      : pointing

  const digest = input.digests.find((row) => (row.cycleId ?? null) === cycle.id) ?? null

  return {
    cycleId: cycle.id,
    key: cycleKeyOf(cycle),
    name: cycleNameOf(cycle),
    status: cycle.status,
    glyph: GLYPH_OF[cycle.status],
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    ledger: buildLedger(ledgerIssues, cycle.startDate, denominatorKnown),
    carriedForward: denominatorKnown ? carriedOut.length : 0,
    chips: {
      cycleReport: hasCycleReport(digest),
      wrapped: isCycleWrapped(input.retros, cycle.id),
    },
  }
}

// TWO STAMPS ON A CARRIED-OUT ISSUE DESCRIBE WHERE IT WENT, NOT WHAT THE CYCLE DELIVERED, and both
// have to be normalised for the same reason.
//
// `cycle.complete` re-stamps `cycle_assigned_at` with the moment the issue LEFT, so read against
// the cycle it left, every carried-out issue would classify as "added after the cycle started" —
// the exact inverse of the truth, and a ledger where `landed` can exceed `committed`. Whether it
// was committed to that cycle or added to it mid-flight is a distinction the overwrite destroyed;
// committed is the honest reading of the pair, and it is the same call `metrics/scope.ts` makes by
// excluding carried-out issues from `addedMidCycle` entirely.
//
// `status` is the LIVE status of an issue that is now somewhere else. An issue the rollover moved
// out of C did not land in C, by construction — that is what being rolled forward means — so
// reading its current status would retroactively credit C with work that landed in a later cycle,
// and print a fully-delivered ratio beside "1 carried forward". `metrics/scope.ts` makes the same
// call: `deliveredCounts.shipped` counts `within` only and never `carriedOut`. Normalised to the
// one status that says "open at the boundary", so the issue counts toward `committed` and the
// hollow remainder and never toward `landed`.
function asCommittedCarryOut(issue: CycleRegisterIssueRow): CycleRegisterIssueRow {
  return { ...issue, cycleAssignedAt: null, status: 'todo' }
}

function buildLedger(
  issues: readonly CycleRegisterIssueRow[],
  cycleStartDate: number,
  denominatorKnown: boolean,
): CycleLedger | null {
  if (issues.length === 0) return null
  const scope = buildScopeBand(issues, cycleStartDate)
  // A degraded row may not draw an open remainder: the blocks it can still see are not the whole
  // set, so a hollow block would be a claim about a total that no longer exists.
  const band = denominatorKnown ? scope.band : scope.band.filter((block) => block !== 'open')
  if (band.length === 0) return null

  const addedClause = scope.added === 0 ? '' : `, ${scope.added} added after the cycle started`

  if (!denominatorKnown) {
    return {
      denominatorKnown,
      committed: scope.committed,
      landed: scope.landed,
      added: scope.added,
      band,
      reading: `${scope.landed} landed`,
      label: `${scope.landed} landed${addedClause}; the committed total is no longer reconstructible`,
    }
  }

  // The ratio is over the COMMITTED set alone, numerator and denominator, which is what the mock's
  // `8/12` counts. Work added after the cycle started is drawn as its own blocks and named in the
  // label; folding it into the numerator would credit the cycle with landing work it never
  // committed to, and can print a fraction above 1.
  const open = band.filter((block) => block === 'open').length
  const committedLanded = scope.committed - open
  const addedLanded = scope.landed - committedLanded

  // A cycle every issue arrived at after it started has no committed set, and `0/0` beside a drawn
  // block is a ratio about nothing. The row reads the scope it actually has.
  if (scope.committed === 0) {
    return {
      denominatorKnown,
      committed: 0,
      landed: scope.landed,
      added: scope.added,
      band,
      reading: `${scope.added} added`,
      label: `${scope.added} added after the cycle started, ${scope.landed} of them landed`,
    }
  }

  return {
    denominatorKnown,
    committed: scope.committed,
    landed: scope.landed,
    added: scope.added,
    band,
    reading: `${committedLanded}/${scope.committed}`,
    label: `${committedLanded} landed of ${scope.committed} committed${addedClause}${
      addedLanded === 0 ? '' : `, of which ${addedLanded} landed`
    }`,
  }
}

function buildCarriedIn(
  cycleId: string | null,
  teamKey: string,
  pointingBy: IssueIndex,
  byId: ReadonlyMap<string, CycleRegisterCycleRow>,
): CycleCarriedIn | null {
  if (cycleId === null) return null

  const rows = (pointingBy.get(cycleId) ?? [])
    .filter((issue) => (issue.carryoverCount ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.carryoverCount ?? 0) - (a.carryoverCount ?? 0) ||
        (a.number ?? 0) - (b.number ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((issue) => buildCarriedRow(issue, teamKey, byId))

  if (rows.length === 0) return null

  const origins = new Set(
    rows.flatMap((row) => (row.originCycleName === null ? [] : [row.originCycleName])),
  )

  // The header names an origin only when EVERY carried row names that same one. A row whose
  // reference names nothing is not agreement with the rows that do — attributing the band to the
  // one cycle a single row happens to name would put issues under a heading their own record
  // cannot support.
  const named =
    origins.size === 1 && rows.every((row) => row.originCycleName !== null)
      ? ([...origins][0] as string)
      : null

  return { count: rows.length, originName: named, rows }
}

function buildCarriedRow(
  issue: CycleRegisterIssueRow,
  teamKey: string,
  byId: ReadonlyMap<string, CycleRegisterCycleRow>,
): CycleCarriedRow {
  const depth = issue.carryoverCount ?? 0
  const origin =
    issue.rolledOverFromCycleId == null ? null : (byId.get(issue.rolledOverFromCycleId) ?? null)
  const originName = origin === null ? null : cycleNameOf(origin)

  // THE CHAIN HAS ONE NAMEABLE HOP because `rolled_over_from_cycle_id` holds the LAST origin only
  // — every earlier one was overwritten. The nodes therefore come from the count alone: one per
  // boundary crossed plus the node for now, and nothing is inferred from cycle ordering.
  const nodes: CycleCarryNodeKind[] = Array.from({ length: depth }, (_, index) =>
    index === depth - 1 && originName !== null ? 'origin' : 'unnamed',
  )
  nodes.push('now')

  return {
    issueId: issue.id,
    issueKey: issueKeyOf(teamKey, issue),
    title: issue.title,
    status: issue.status,
    depth,
    originCycleId: origin?.id ?? null,
    originCycleName: originName,
    chain: { nodes, leadIn: depth > 1 },
    fact: `carried ${depth}×`,
    say:
      originName === null
        ? `Carried ${depth} ${plural(depth, 'time', 'times')}; the cycles it left are no longer named.`
        : `Carried ${depth} ${plural(depth, 'time', 'times')}; last left ${originName}.`,
    deep: depth >= CARRY_DEEP_DEPTH,
  }
}
