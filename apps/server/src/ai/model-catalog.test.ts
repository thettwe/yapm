import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_MODELS,
  estimateCostUsd,
  exceedsSpendCap,
  type ModelCatalog,
} from './model-catalog.js'

const catalog: ModelCatalog = {
  anthropic: { 'claude-x': { inputPerMTok: 3, outputPerMTok: 15 } },
  google: {},
  openai: {},
}

describe('estimateCostUsd — usage × the volatile price table', () => {
  it('computes input + output cost per 1M tokens', () => {
    const cost = estimateCostUsd(catalog, 'anthropic', 'claude-x', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    })
    // 1M in × $3 + 0.5M out × $15 = 3 + 7.5
    expect(cost).toBeCloseTo(10.5, 6)
  })

  it('treats missing token counts as zero', () => {
    const cost = estimateCostUsd(catalog, 'anthropic', 'claude-x', {
      inputTokens: undefined,
      outputTokens: undefined,
    })
    expect(cost).toBe(0)
  })

  it('returns null (unknown, never $0) when the model is not in the table', () => {
    const cost = estimateCostUsd(catalog, 'openai', 'gpt-unknown', {
      inputTokens: 100,
      outputTokens: 100,
    })
    expect(cost).toBeNull()
  })

  it('prices every default model against the shipped catalog', () => {
    for (const [provider, modelId] of Object.entries(DEFAULT_MODELS)) {
      const cost = estimateCostUsd(
        DEFAULT_MODEL_CATALOG,
        provider as keyof typeof DEFAULT_MODELS,
        modelId,
        { inputTokens: 1000, outputTokens: 1000 },
      )
      expect(cost).not.toBeNull()
    }
  })
})

describe('exceedsSpendCap — refuse to start a run past the cap', () => {
  it('is false when no cap is set', () => {
    expect(exceedsSpendCap(1000, null)).toBe(false)
    expect(exceedsSpendCap(1000, undefined)).toBe(false)
  })

  it('is true once the running total reaches the cap', () => {
    expect(exceedsSpendCap(4.99, 5)).toBe(false)
    expect(exceedsSpendCap(5, 5)).toBe(true)
    expect(exceedsSpendCap(6, 5)).toBe(true)
  })
})
