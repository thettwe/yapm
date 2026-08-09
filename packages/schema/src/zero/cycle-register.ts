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

export function buildCycleRegister(input: CycleRegisterInput): CycleRegister {
  const ordered = [...input.cycles].sort(compareCycles)
  const byId = new Map(ordered.map((cycle) => [cycle.id, cycle]))

  // WHY THE DENOMINATOR DEGRADES: `cycle.complete` re-points each unfinished issue at the
  // successor and stamps `rolled_over_from_cycle_id` with the cycle it left — and that column is
  // OVERWRITTEN the next time the issue carries. So a completed cycle's carried set, and with it
  // its committed total, is reconstructible only while no completed cycle follows it.
  const latestCompletedId =
    ordered.filter((cycle) => cycle.status === 'completed').at(-1)?.id ?? null

  const rows = ordered.map((cycle) => buildRow(cycle, input, latestCompletedId)).reverse()

  return {
    rows,
    carriedIn: (cycleId) => buildCarriedIn(cycleId, input, byId),
  }
}

function buildRow(
  cycle: CycleRegisterCycleRow,
  input: CycleRegisterInput,
  latestCompletedId: string | null,
): CycleRegisterRow {
  const pointing = input.issues.filter((issue) => (issue.cycleId ?? null) === cycle.id)
  const carriedOut = input.issues.filter(
    (issue) => (issue.rolledOverFromCycleId ?? null) === cycle.id,
  )
  const denominatorKnown = cycle.status !== 'completed' || cycle.id === latestCompletedId

  const pointingIds = new Set(pointing.map((issue) => issue.id))
  const ledgerIssues =
    denominatorKnown && cycle.status === 'completed'
      ? [...pointing, ...carriedOut.filter((issue) => !pointingIds.has(issue.id))]
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

  return {
    denominatorKnown,
    committed: scope.committed,
    landed: scope.landed,
    added: scope.added,
    band,
    reading: denominatorKnown ? `${scope.landed}/${scope.committed}` : `${scope.landed} landed`,
    label: denominatorKnown
      ? `${scope.landed} landed of ${scope.committed} committed${addedClause}`
      : `${scope.landed} landed; the committed total is no longer reconstructible`,
  }
}

function buildCarriedIn(
  cycleId: string | null,
  input: CycleRegisterInput,
  byId: ReadonlyMap<string, CycleRegisterCycleRow>,
): CycleCarriedIn | null {
  if (cycleId === null) return null

  const rows = input.issues
    .filter((issue) => (issue.cycleId ?? null) === cycleId && (issue.carryoverCount ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.carryoverCount ?? 0) - (a.carryoverCount ?? 0) ||
        (a.number ?? 0) - (b.number ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((issue) => buildCarriedRow(issue, input.teamKey, byId))

  if (rows.length === 0) return null

  const origins = new Set(
    rows.flatMap((row) => (row.originCycleName === null ? [] : [row.originCycleName])),
  )

  return {
    count: rows.length,
    originName: origins.size === 1 ? ([...origins][0] as string) : null,
    rows,
  }
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
