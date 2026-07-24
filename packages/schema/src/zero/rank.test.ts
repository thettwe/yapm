import { describe, expect, it } from 'vitest'
import { initialRanks, rankBetween } from './rank.js'

describe('rankBetween', () => {
  it('mints a key that sorts strictly between two neighbours', () => {
    const a = rankBetween(null, null)
    const c = rankBetween(a, null)
    const b = rankBetween(a, c)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('prepends before a key when the lower bound is null', () => {
    const a = rankBetween(null, null)
    const before = rankBetween(null, a)
    expect(before < a).toBe(true)
  })

  it('appends after a key when the upper bound is null', () => {
    const a = rankBetween(null, null)
    const after = rankBetween(a, null)
    expect(a < after).toBe(true)
  })

  it('is stable: the same neighbours yield the same key', () => {
    const a = rankBetween(null, null)
    const c = rankBetween(a, null)
    expect(rankBetween(a, c)).toBe(rankBetween(a, c))
  })
})

describe('initialRanks', () => {
  it('returns an empty list for non-positive counts', () => {
    expect(initialRanks(0)).toEqual([])
    expect(initialRanks(-3)).toEqual([])
  })

  it('mints n keys in strictly ascending byte order', () => {
    const ranks = initialRanks(50)
    expect(ranks).toHaveLength(50)
    const sorted = [...ranks].sort()
    expect(ranks).toEqual(sorted)
    expect(new Set(ranks).size).toBe(50)
  })

  it('produces keys a later move can slot between', () => {
    const [first, second] = initialRanks(2)
    if (first === undefined || second === undefined) throw new Error('expected two ranks')
    const between = rankBetween(first, second)
    expect(first < between).toBe(true)
    expect(between < second).toBe(true)
  })
})
