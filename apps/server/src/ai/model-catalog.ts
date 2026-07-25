import type { AiProvider } from '@yapm/schema'

// Model IDs and prices are VOLATILE (reference/ai-providers.md §1) — this is a small, easy-to-
// update, checked-in table, NEVER a hardcoded constant in the call path. `resolveModel` reads the
// admin-chosen model string as runtime config; this table only drives ESTIMATED spend (usage ×
// price) and provides a cheap/fast default per provider. Update it per release when prices move.
export interface ModelPrice {
  // USD per 1M input tokens.
  readonly inputPerMTok: number
  // USD per 1M output tokens.
  readonly outputPerMTok: number
}

export type ModelCatalog = Record<AiProvider, Record<string, ModelPrice>>

// Snapshot from reference/ai-providers.md §1 (2026-07-24, VOLATILE). Absent entries simply yield
// an unknown (null) cost estimate — the run still proceeds; the UI shows the tokens without a
// dollar figure. Add rows here as providers ship models; never treat these as authoritative.
export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  anthropic: {
    'claude-opus-4-8': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
    'claude-sonnet-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  },
  google: {
    'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10.0 },
    'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
    'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  },
  openai: {
    'gpt-5.4': { inputPerMTok: 2.5, outputPerMTok: 15.0 },
    'gpt-5.4-mini': { inputPerMTok: 0.75, outputPerMTok: 4.5 },
    'gpt-5.4-nano': { inputPerMTok: 0.2, outputPerMTok: 1.25 },
  },
}

// A cheap/fast default model per provider (digest drafting is a bounded summarize-and-structure
// task). Used only when the admin has not chosen a model for the resolved provider. Runtime
// config still overrides this — it is a fallback, not a hardcoded call-path constant.
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash-lite',
  openai: 'gpt-5.4-nano',
}

export interface TokenUsage {
  readonly inputTokens: number | undefined
  readonly outputTokens: number | undefined
}

// ESTIMATED cost of one run: usage × the (volatile) per-model price. Returns null when the model
// is not in the table (price unknown) so callers can label it honestly rather than show $0.
export function estimateCostUsd(
  catalog: ModelCatalog,
  provider: AiProvider,
  modelId: string,
  usage: TokenUsage,
): number | null {
  const price = catalog[provider]?.[modelId]
  if (!price) return null
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  return (input / 1_000_000) * price.inputPerMTok + (output / 1_000_000) * price.outputPerMTok
}

// Whether a workspace's accumulated estimated spend has reached its optional cap. The gateway
// refuses to START a run once this is true, so a runaway key never surprises the user.
export function exceedsSpendCap(
  runningTotalUsd: number,
  capUsd: number | null | undefined,
): boolean {
  if (capUsd === undefined || capUsd === null) return false
  return runningTotalUsd >= capUsd
}
