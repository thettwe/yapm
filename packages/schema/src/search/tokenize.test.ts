import { describe, expect, it } from 'vitest'
import {
  isServerSearchable,
  MIN_SERVER_QUERY_LENGTH,
  normalizeQuery,
  queryLength,
  tokenizeQuery,
} from './tokenize.js'

describe('tokenizeQuery', () => {
  it('lowercases, trims and splits on whitespace runs', () => {
    expect(tokenizeQuery('  Ship   The   Thing \n')).toEqual(['ship', 'the', 'thing'])
  })

  it('yields no tokens for a blank or whitespace-only query', () => {
    expect(tokenizeQuery('')).toEqual([])
    expect(tokenizeQuery('   \t\n ')).toEqual([])
  })

  it('keeps punctuation inside a token so an issue key survives', () => {
    expect(tokenizeQuery('ENG-12')).toEqual(['eng-12'])
  })
})

describe('queryLength', () => {
  it('counts non-whitespace characters only', () => {
    expect(queryLength(' a b ')).toBe(2)
    expect(queryLength('     ')).toBe(0)
  })

  it('counts code points, so a query outside the BMP is not inflated', () => {
    expect(queryLength('𝔞𝔟')).toBe(2)
  })

  it('is unaffected by case folding that changes string length', () => {
    expect(queryLength('İ')).toBe(1)
    expect('İ'.toLowerCase().length).toBeGreaterThan(1)
  })
})

describe('MIN_SERVER_QUERY_LENGTH', () => {
  it('is the single rule both the client and the route read', () => {
    expect(MIN_SERVER_QUERY_LENGTH).toBe(2)
  })

  it('gates the server pass on length alone, never on whether anything matched', () => {
    expect(isServerSearchable('')).toBe(false)
    expect(isServerSearchable(' a ')).toBe(false)
    expect(isServerSearchable('a b')).toBe(true)
    expect(isServerSearchable('ab')).toBe(true)
  })
})

describe('normalizeQuery', () => {
  it('is idempotent', () => {
    const once = normalizeQuery('  Mixed Case  ')
    expect(normalizeQuery(once)).toBe(once)
    expect(once).toBe('mixed case')
  })
})
