import { describe, expect, it } from 'vitest'
import { collectKeys, FORBIDDEN_IDENTITY_KEYS } from './blameless.js'

// The walker is the instrument every blamelessness assertion in this repository is read through:
// `metrics/window.test.ts` and `delivery/window-model.test.ts` both prove their entry point carries
// no identity by asking it for a key set and finding nothing forbidden in it. A walker that silently
// returned nothing would make BOTH of those pass while measuring nothing at all — so the instrument
// is calibrated here, against inputs that are known to be dirty.

describe('collectKeys reaches every place a leak could hide', () => {
  it('finds a key nested at depth, through arrays and objects alike', () => {
    const keys = collectKeys({
      sections: [{ metrics: [{ meta: { deep: { author: 'octocat' } } }] }],
    })

    expect(keys.has('author')).toBe(true)
    expect(keys.has('sections')).toBe(true)
    expect(keys.has('deep')).toBe(true)
  })

  // The exact shape a `DeliveryWindow` has, with one identity planted where a careless builder would
  // put it: on the row a metric was computed from. Both entry-point tests would be worthless if this
  // came back clean.
  it('catches an identity planted in the shape the delivery model actually has', () => {
    const leaky = {
      label: 'Last 6 completed cycles',
      cycleCount: 6,
      sections: [
        {
          key: 'flow',
          state: 'ready',
          metrics: [
            { key: 'review_rounds', value: 2, trend: [1, 2], source: { author: 'octocat' } },
          ],
        },
      ],
    }

    const found = FORBIDDEN_IDENTITY_KEYS.filter((key) => collectKeys(leaky).has(key))
    expect(found).toEqual(['author'])
  })

  it('reports nothing for a value that has no keys, which is why call sites assert non-null first', () => {
    expect(collectKeys(null).size).toBe(0)
    expect(collectKeys(undefined).size).toBe(0)
    expect(collectKeys('octocat').size).toBe(0)
    expect(collectKeys(12).size).toBe(0)
  })

  it('accumulates into a caller-supplied set rather than resetting it', () => {
    const keys = new Set(['already-here'])
    collectKeys({ author: 1 }, keys)

    expect([...keys].toSorted()).toEqual(['already-here', 'author'])
  })
})

describe('FORBIDDEN_IDENTITY_KEYS names the columns that are actually radioactive', () => {
  // `review.author` is a real GitHub login sitting in a synced table, and issues carry an assignee
  // and a creator. If the list ever loses one of these, every assertion built on it keeps passing.
  it('covers the identity-bearing columns of the synced work graph', () => {
    for (const key of ['author', 'assignee', 'assigneeId', 'creator', 'login', 'email']) {
      expect(FORBIDDEN_IDENTITY_KEYS).toContain(key)
    }
  })

  it('lists each key once, so a filter over it cannot double-report', () => {
    expect(new Set(FORBIDDEN_IDENTITY_KEYS).size).toBe(FORBIDDEN_IDENTITY_KEYS.length)
  })
})
