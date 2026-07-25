import type { ConnectionState } from '@rocicorp/zero'
import { expect, test } from 'vitest'
import { DISCONNECTED_GRACE_MS, recoveryPlan } from './recovery'

const NAMES: ConnectionState['name'][] = [
  'connected',
  'connecting',
  'disconnected',
  'needs-auth',
  'error',
  'closed',
]

test('a live connection resets the schedule', () => {
  expect(recoveryPlan('connected')).toEqual({ kind: 'reset' })
})

test('Zero is already retrying while connecting, so we stay out of the way', () => {
  expect(recoveryPlan('connecting')).toEqual({ kind: 'none' })
})

test('a closed client is terminal — only a new instance can recover it', () => {
  expect(recoveryPlan('closed')).toEqual({ kind: 'none' })
})

test('the two states Zero never retries out of get a re-mint and a reconnect', () => {
  for (const name of ['needs-auth', 'error'] as const) {
    expect(recoveryPlan(name)).toEqual({ kind: 'remint', reconnect: true, graceMs: 0 })
  }
})

test('disconnected re-mints after a grace and never calls connect, which is a no-op there', () => {
  expect(recoveryPlan('disconnected')).toEqual({
    kind: 'remint',
    reconnect: false,
    graceMs: DISCONNECTED_GRACE_MS,
  })
})

test('a hidden tab is disconnected on purpose, so there is nothing to recover', () => {
  expect(recoveryPlan('disconnected', { hidden: true })).toEqual({ kind: 'none' })
})

test('visibility changes nothing for the states Zero never retries out of', () => {
  for (const name of ['needs-auth', 'error'] as const) {
    expect(recoveryPlan(name, { hidden: true })).toEqual({
      kind: 'remint',
      reconnect: true,
      graceMs: 0,
    })
  }
})

test('every Zero connection state has a plan', () => {
  for (const name of NAMES) {
    expect(['none', 'reset', 'remint']).toContain(recoveryPlan(name).kind)
  }
})
