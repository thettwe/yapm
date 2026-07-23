import { describe, expect, it } from 'vitest'
import { createLogger, type SerializedError, serializeError } from './logger.js'

describe('serializeError', () => {
  it('keeps the useful fields and drops driver internals', () => {
    const error = Object.assign(new Error('terminating connection'), {
      code: '57P01',
      client: { connectionParameters: { password: 'hunter2' } },
    })

    const serialized = serializeError(error) as SerializedError

    expect(serialized.type).toBe('Error')
    expect(serialized.message).toBe('terminating connection')
    expect(serialized.code).toBe('57P01')
    expect(serialized.stack).toBeTypeOf('string')
    expect(Object.keys(serialized)).toEqual(['type', 'message', 'code', 'stack'])
  })

  it('flattens the causes of an AggregateError', () => {
    const serialized = serializeError(
      new AggregateError([new Error('ipv4 refused'), new Error('ipv6 refused')]),
    ) as SerializedError

    expect(serialized.type).toBe('AggregateError')
    expect((serialized.errors as SerializedError[]).map((child) => child.message)).toEqual([
      'ipv4 refused',
      'ipv6 refused',
    ])
  })

  it('passes non-errors through untouched', () => {
    expect(serializeError('boom')).toBe('boom')
  })
})

describe('createLogger', () => {
  it('honours the configured level', () => {
    expect(createLogger({ LOG_LEVEL: 'warn', NODE_ENV: 'test' }).level).toBe('warn')
  })
})
