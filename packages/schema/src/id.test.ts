import { describe, expect, it } from 'vitest'
import { newId, newKey } from './id.js'

describe('newId', () => {
  it('mints sortable UUIDv7 values', () => {
    const first = newId()
    const second = newId()

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second > first).toBe(true)
  })

  it('repeats its own prefix inside one time bucket, which is why newKey exists', () => {
    const prefixes = new Set(Array.from({ length: 500 }, () => newId().slice(0, 8)))

    expect(prefixes.size).toBe(1)
  })
})

describe('newKey', () => {
  it('mints distinct values in rapid succession', () => {
    const keys = Array.from({ length: 2000 }, () => newKey())

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((key) => /^[0-9a-f]{8}$/.test(key))).toBe(true)
  })

  it('honours the requested length', () => {
    expect(newKey(4)).toMatch(/^[0-9a-f]{4}$/)
    expect(newKey(1)).toMatch(/^[0-9a-f]$/)
    expect(newKey(12)).toMatch(/^[0-9a-f]{12}$/)
  })
})
