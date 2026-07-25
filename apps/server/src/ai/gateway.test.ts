import type { DB, SecretCodec } from '@yapm/schema/db'
import { MockLanguageModelV4 } from 'ai/test'
import type { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AiEnv } from '../config/env.js'
import { AiSpendCapError, createAiGateway, type ModelFactory } from './gateway.js'

interface FakeTables {
  connector_config?: Record<string, unknown>[]
  connector_secret?: Record<string, unknown>[]
}

// A minimal Kysely double that answers exactly the read chains the AI config accessors issue:
// `selectFrom(table).selectAll()/.select().where(col,'=',val)...executeTakeFirst()`.
function fakeDb(tables: FakeTables): Kysely<DB> {
  return {
    selectFrom(table: keyof FakeTables) {
      const rows = tables[table] ?? []
      const filters: [string, unknown][] = []
      const builder = {
        selectAll: () => builder,
        select: () => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters.push([col, val])
          return builder
        },
        executeTakeFirst: () =>
          Promise.resolve(rows.find((row) => filters.every(([col, val]) => row[col] === val))),
      }
      return builder
    },
  } as unknown as Kysely<DB>
}

// Identity codec: the stored "ciphertext" is the plaintext key for the test.
const identityCodec: SecretCodec = { encrypt: (v) => v, decrypt: (v) => v }

// A model factory that records what it was asked to build instead of hitting a network.
function recordingFactory(): {
  factory: ModelFactory
  calls: { provider: string; apiKey: string; modelId: string }[]
} {
  const calls: { provider: string; apiKey: string; modelId: string }[] = []
  const factory: ModelFactory = (provider, apiKey) => (modelId) => {
    calls.push({ provider, apiKey, modelId })
    return { provider, modelId } as never
  }
  return { factory, calls }
}

const noEnv: AiEnv = { keys: {}, defaultProvider: null }
const WS = 'ws-1'

function aiConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    workspace_id: WS,
    provider: 'ai',
    enabled: true,
    config: { defaultProvider: 'anthropic', models: { anthropic: 'claude-x' } },
    ...overrides,
  }
}

function secretRow(key: string, ciphertext: string) {
  return { connector_config_id: 'cfg-1', key, ciphertext }
}

describe('resolveModel — selection + disabled/unconfigured returns null', () => {
  it('returns null when AI was never configured and no env default exists', async () => {
    const { factory } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({}),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    expect(await gw.resolveModel(WS)).toBeNull()
  })

  it('returns null when the master toggle is off', async () => {
    const { factory } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({ connector_config: [aiConfigRow({ enabled: false })] }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    expect(await gw.resolveModel(WS)).toBeNull()
  })

  it('keeps an explicitly toggled-off workspace off even when an env default exists', async () => {
    const { factory } = recordingFactory()
    const env: AiEnv = { keys: { anthropic: 'env-key' }, defaultProvider: 'anthropic' }
    const gw = createAiGateway({
      db: fakeDb({ connector_config: [aiConfigRow({ enabled: false })] }),
      codec: identityCodec,
      env,
      modelFactory: factory,
    })
    expect(await gw.resolveModel(WS)).toBeNull()
  })

  it('returns null when enabled but no key is stored for the provider', async () => {
    const { factory } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({ connector_config: [aiConfigRow()] }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    expect(await gw.resolveModel(WS)).toBeNull()
  })

  it('resolves the workspace default provider + model from a UI key', async () => {
    const { factory, calls } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [aiConfigRow()],
        connector_secret: [secretRow('anthropic', 'sk-ant')],
      }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    const resolved = await gw.resolveModel(WS)
    expect(resolved).not.toBeNull()
    expect(resolved?.provider).toBe('anthropic')
    expect(resolved?.modelId).toBe('claude-x')
    expect(calls[0]).toEqual({ provider: 'anthropic', apiKey: 'sk-ant', modelId: 'claude-x' })
  })

  it('honors an explicit provider arg and falls back to the default model', async () => {
    const { factory, calls } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [aiConfigRow({ config: { models: {} } })],
        connector_secret: [secretRow('openai', 'sk-oai')],
      }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    const resolved = await gw.resolveModel(WS, 'openai')
    expect(resolved?.provider).toBe('openai')
    // No model chosen for openai ⇒ the cheap/fast default.
    expect(resolved?.modelId).toBe('gpt-5.4-nano')
    expect(calls[0]?.apiKey).toBe('sk-oai')
  })

  it('enables via an env instance-default key with no DB row', async () => {
    const { factory } = recordingFactory()
    const env: AiEnv = { keys: { google: 'sk-goog' }, defaultProvider: 'google' }
    const gw = createAiGateway({ db: fakeDb({}), codec: identityCodec, env, modelFactory: factory })
    const resolved = await gw.resolveModel(WS)
    expect(resolved?.provider).toBe('google')
  })

  it('prefers a UI key over the env key for the same provider', async () => {
    const { factory, calls } = recordingFactory()
    const env: AiEnv = { keys: { anthropic: 'env-key' }, defaultProvider: null }
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [aiConfigRow()],
        connector_secret: [secretRow('anthropic', 'ui-key')],
      }),
      codec: identityCodec,
      env,
      modelFactory: factory,
    })
    await gw.resolveModel(WS)
    expect(calls[0]?.apiKey).toBe('ui-key')
  })

  it('cannot read UI keys without a codec, but still uses env keys', async () => {
    const { factory, calls } = recordingFactory()
    const env: AiEnv = { keys: { anthropic: 'env-key' }, defaultProvider: null }
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [aiConfigRow()],
        connector_secret: [secretRow('anthropic', 'ui-key')],
      }),
      codec: null,
      env,
      modelFactory: factory,
    })
    await gw.resolveModel(WS)
    expect(calls[0]?.apiKey).toBe('env-key')
  })
})

describe('generateStructured — spend cap refusal', () => {
  it('refuses to start a run once the estimated spend has hit the cap', async () => {
    const { factory } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [
          aiConfigRow({ config: { defaultProvider: 'anthropic', models: {}, spendCapUsd: 5 } }),
        ],
        connector_secret: [secretRow('anthropic', 'sk-ant')],
      }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    await expect(
      gw.generateStructured(
        WS,
        { userID: 'u', role: 'member' },
        { system: 's', input: 'i', schema: {} as never, spendSoFarUsd: 6 },
      ),
    ).rejects.toBeInstanceOf(AiSpendCapError)
  })

  it('returns null (AI-off path) when AI is disabled', async () => {
    const { factory } = recordingFactory()
    const gw = createAiGateway({
      db: fakeDb({}),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    const result = await gw.generateStructured(
      WS,
      { userID: 'u', role: 'member' },
      { system: 's', input: 'i', schema: {} as never },
    )
    expect(result).toBeNull()
  })
})

describe('generateStructured — typed output via the SDK mock provider (no network, no key)', () => {
  it('returns the schema-typed object plus normalized usage', async () => {
    const mock = new MockLanguageModelV4({
      doGenerate: async () => ({
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        content: [{ type: 'text', text: JSON.stringify({ shipped: 3 }) }],
        warnings: [],
      }),
    } as never)
    const factory: ModelFactory = () => () => mock as never
    const gw = createAiGateway({
      db: fakeDb({
        connector_config: [aiConfigRow()],
        connector_secret: [secretRow('anthropic', 'sk-ant')],
      }),
      codec: identityCodec,
      env: noEnv,
      modelFactory: factory,
    })
    const result = await gw.generateStructured(
      WS,
      { userID: 'u', role: 'member' },
      { system: 'summarize', input: 'facts', schema: z.object({ shipped: z.number() }) },
    )
    expect(result?.object).toEqual({ shipped: 3 })
    expect(result?.usage).toBeDefined()
    expect(result?.provider).toBe('anthropic')
    expect(result?.modelId).toBe('claude-x')
  })
})
