import { expect, test } from 'vitest'
import {
  atBackoffCeiling,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  backoffCeiling,
  backoffDelay,
} from './backoff'

test('the ceiling doubles from the base and then stops at the cap', () => {
  expect(backoffCeiling(0)).toBe(BACKOFF_BASE_MS)
  expect(backoffCeiling(1)).toBe(2_000)
  expect(backoffCeiling(2)).toBe(4_000)
  expect(backoffCeiling(3)).toBe(8_000)
  expect(backoffCeiling(4)).toBe(16_000)
  expect(backoffCeiling(5)).toBe(BACKOFF_CAP_MS)
})

test('the ceiling never exceeds the cap, however long the outage lasts', () => {
  for (const attempt of [6, 12, 40, 1_000, 10_000]) {
    expect(backoffCeiling(attempt)).toBe(BACKOFF_CAP_MS)
  }
})

test('the ceiling is monotonic', () => {
  let previous = 0
  for (let attempt = 0; attempt < 20; attempt++) {
    const ceiling = backoffCeiling(attempt)
    expect(ceiling).toBeGreaterThanOrEqual(previous)
    previous = ceiling
  }
})

test('every jittered delay stays within [0, ceiling]', () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    for (const roll of [0, 0.25, 0.5, 0.999_999]) {
      const delay = backoffDelay(attempt, () => roll)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(backoffCeiling(attempt))
      expect(delay).toBeLessThanOrEqual(BACKOFF_CAP_MS)
    }
  }
})

test('full jitter spreads the delay across the whole window', () => {
  expect(backoffDelay(3, () => 0)).toBe(0)
  expect(backoffDelay(3, () => 0.5)).toBe(4_000)
})

test('a real random source stays inside the cap for a long outage', () => {
  for (let attempt = 0; attempt < 200; attempt++) {
    expect(backoffDelay(attempt)).toBeLessThanOrEqual(BACKOFF_CAP_MS)
  }
})

test('resetting to attempt zero returns to the base window', () => {
  expect(backoffCeiling(9)).toBe(BACKOFF_CAP_MS)
  expect(backoffCeiling(0)).toBe(BACKOFF_BASE_MS)
})

test('the manual retry offer opens once the window reaches the cap', () => {
  expect(atBackoffCeiling(0)).toBe(false)
  expect(atBackoffCeiling(4)).toBe(false)
  expect(atBackoffCeiling(5)).toBe(true)
  expect(atBackoffCeiling(50)).toBe(true)
})

test('a negative or fractional attempt cannot produce a shorter-than-base window', () => {
  expect(backoffCeiling(-3)).toBe(BACKOFF_BASE_MS)
  expect(backoffCeiling(1.9)).toBe(2_000)
})
