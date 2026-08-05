import * as z from 'zod'
import type { IssueStatus } from '../context.js'
import {
  buildMetrics,
  CYCLE_PERIOD,
  DELIVERED_METRICS,
  type DeliveryEmptyState,
  type DeliveryMetric,
  type DeliverySection,
  type DeliveryUnit,
  deliverySections,
  FLOW_METRICS,
  fromHistory,
} from '../metrics/descriptors.js'
import {
  type DeliveryCycleInput,
  type DeliveryIssueInput,
  type DeliveryPrInput,
  deliveredCounts,
  flowMeasures,
  scopeOfCycle,
} from '../metrics/scope.js'

// The differentiator, as one pure function: the retro's "Gather data" phase, pre-filled from the
// work graph. Every other retro tool asks the team what happened; this computes it.
//
// Two guarantees are STRUCTURAL here, not editorial:
//   1. No identity dimension at any depth. Neither the input nor the output carries an assignee,
//      author, reviewer, creator or user id, so a per-person number is not renderable. A unit test
//      walks the produced object graph and fails on any identity-shaped key.
//   2. Degrades to the data that exists. Delivered is fully populated from CYCLES ALONE (day one,
//      no connectors). Flow appears only when linked delivery data exists and otherwise renders one
//      quiet empty state naming what would light it up — never zeros, never hollow charts.
// Health (DORA/MTTR) is Phase 3: this function produces no health section and `RetroSeed` carries
// no health field. The seam is the section list being open for extension.

// The evidence link a panel widget attaches to the draft it seeds — the join no whiteboard tool can
// make. A superset of `DigestEvidenceRef` (a digest ref is assignable here), plus `widget` for "this
// number itself", so the later AI change's cite-or-omit validator reuses one grounding contract.
// `retro_action` is the loop-closing kind: a proposal that points at an improvement the team agreed
// in its PREVIOUS retro. It costs no DDL — `refs` is jsonb with no CHECK — and `buildRetroSeed` never
// emits one; only the AI draft's proposals cite it.
export const RETRO_SEED_REF_KINDS = [
  'issue',
  'pull_request',
  'ci_check',
  'deployment',
  'widget',
  'retro_action',
] as const

export type RetroSeedRefKind = (typeof RETRO_SEED_REF_KINDS)[number]

// What the LIVE STATUS of the issue an agreed action became says about that action. A yapm-computed
// enum, never a phrase a model chose. `shipped` is `done` AND NOTHING ELSE: `canceled` is reported as
// its own outcome rather than folded into "not shipped", and `not_converted` ("we agreed it and never
// tracked it") is kept apart from `in_flight` ("we tracked it and it is still open") because those
// are different failures and a retro should be able to tell them apart.
export const RETRO_ACTION_OUTCOMES = ['shipped', 'canceled', 'in_flight', 'not_converted'] as const

export type RetroActionOutcome = (typeof RETRO_ACTION_OUTCOMES)[number]

export function retroActionOutcome(
  issueStatus: IssueStatus | null | undefined,
): RetroActionOutcome {
  if (issueStatus == null) return 'not_converted'
  if (issueStatus === 'done') return 'shipped'
  if (issueStatus === 'canceled') return 'canceled'
  return 'in_flight'
}

// Yapm's words for a yapm-computed outcome, in ONE place: the server bakes them into a reference's
// label, the panel marks the chip with them, and neither can drift from the other.
export const RETRO_ACTION_OUTCOME_LABEL: Readonly<Record<RetroActionOutcome, string>> = {
  shipped: 'shipped',
  canceled: 'canceled',
  in_flight: 'still open',
  not_converted: 'never tracked',
}

// The citable key a follow-up proposal points at instead of typing a count. One per outcome, in the
// `widget` namespace the seed metrics already occupy, so the cite-or-omit validator narrows an
// invented count exactly as it narrows an invented metric key.
export function retroActionOutcomeKey(outcome: RetroActionOutcome): string {
  return `prior_retro_${outcome}`
}

const OUTCOME_BY_KEY: ReadonlyMap<string, RetroActionOutcome> = new Map(
  RETRO_ACTION_OUTCOMES.map((outcome) => [retroActionOutcomeKey(outcome), outcome]),
)

// The inverse, and the reason it exists: these four keys live in the `widget` namespace beside the
// seed's metric keys, but NO seed metric carries them — they are computed from a retro this view
// does not sync. Anything resolving a `widget` reference has to be able to tell the two apart, or a
// cited total resolves to nothing and the count the proposal points at is never drawn.
export function retroActionOutcomeFromKey(key: string): RetroActionOutcome | null {
  return OUTCOME_BY_KEY.get(key) ?? null
}

export type RetroActionOutcomeTotals = Readonly<Record<RetroActionOutcome, number>>

export function retroActionOutcomeTotals(
  outcomes: readonly RetroActionOutcome[],
): RetroActionOutcomeTotals {
  const totals: Record<RetroActionOutcome, number> = {
    shipped: 0,
    canceled: 0,
    in_flight: 0,
    not_converted: 0,
  }
  for (const outcome of outcomes) totals[outcome] += 1
  return totals
}

// `outcome` and `origin` are YAPM-BAKED and exist for the TWO references the client cannot resolve
// from its own synced rows: a `retro_action` id (the prior retro's actions are not in this retro's
// sync scope, and adding a cross-retro query for a caption would be a new permission surface for a
// string) and a `widget` reference carrying a `prior_retro_*` outcome key (no seed metric carries
// one). The server overwrites `label` on both after validation, writes `outcome` on both and `origin`
// on the `retro_action` alone, and strips `outcome`/`origin` from every other reference — so a model
// never writes any of the three. See `bakeRetroActionRefs`.
export const retroSeedRefSchema = z.object({
  kind: z.enum(RETRO_SEED_REF_KINDS),
  id: z.string().min(1),
  label: z.string().optional(),
  outcome: z.enum(RETRO_ACTION_OUTCOMES).optional(),
  origin: z.string().optional(),
})

export type RetroSeedRef = z.infer<typeof retroSeedRefSchema>

// The retro's input shapes are the measurement scope's shapes under the names the rest of the
// codebase already imports (~15 call sites across the panel, the AI draft and ratification). The
// formulas themselves live in `../metrics/`, shared with the team Delivery view; this file is only
// the cycle-scoped adapter.
export type RetroSeedPrInput = DeliveryPrInput
export type RetroSeedIssueInput = DeliveryIssueInput
export type RetroSeedCycleInput = DeliveryCycleInput

export interface RetroSeedInput {
  readonly cycle: RetroSeedCycleInput
  // Up to three prior completed cycles of the same team, oldest first — the sparkline's history.
  readonly priorCycles?: readonly RetroSeedCycleInput[]
}

export type RetroSeedUnit = DeliveryUnit
export type RetroSeedMetric = DeliveryMetric
export type RetroSeedEmptyState = DeliveryEmptyState
export type RetroSeedSection = DeliverySection

export interface RetroSeed {
  readonly cycleId: string
  readonly cycleName: string
  readonly sections: readonly RetroSeedSection[]
}

const MAX_PRIOR_CYCLES = 3

function priors(input: RetroSeedInput): readonly RetroSeedCycleInput[] {
  return (input.priorCycles ?? []).slice(-MAX_PRIOR_CYCLES)
}

export function buildRetroSeed(input: RetroSeedInput): RetroSeed {
  const history = priors(input)
  const scope = scopeOfCycle(input.cycle)

  const counts = deliveredCounts(scope)
  const priorCounts = history.map((cycle) => deliveredCounts(scopeOfCycle(cycle)))
  const delivered = buildMetrics(
    DELIVERED_METRICS,
    (read) => fromHistory(read(counts), priorCounts.map(read)),
    { period: CYCLE_PERIOD, counts },
  )

  const measures = flowMeasures(scope)
  const priorMeasures = history.map((cycle) => flowMeasures(scopeOfCycle(cycle)))
  const flow = buildMetrics(
    FLOW_METRICS,
    (read) => fromHistory(read(measures), priorMeasures.map(read)),
    { period: CYCLE_PERIOD, measures },
  )

  return {
    cycleId: input.cycle.id,
    cycleName: input.cycle.name,
    sections: deliverySections({ period: CYCLE_PERIOD, delivered, flow }),
  }
}
