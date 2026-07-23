import { type Logger as PinoLogger, pino } from 'pino'
import type { Env } from './config/env.js'

export type Logger = PinoLogger

export interface SerializedError {
  type: string
  message: string
  code?: string
  errors?: unknown[]
  stack?: string
}

export function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error

  const code = (error as { code?: unknown }).code
  const serialized: SerializedError = {
    type: error.name,
    message: error.message,
    ...(code === undefined ? {} : { code: String(code) }),
    ...(error instanceof AggregateError ? { errors: error.errors.map(serializeError) } : {}),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  }

  return serialized
}

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const pretty = env.NODE_ENV === 'development'

  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'yapm-server' },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: { err: serializeError },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } } }
      : {}),
  })
}
