import type { PgBoss, QueuePolicy } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'

// The tail's control flow, isolated from Postgres. The live-database suite (`retro-draft.pg.test.ts`)
// proves the SQL; what needs a deterministic harness is the ORDER of the claim relative to the
// provider call, because a claim issued after the call would still pass every live assertion while
// letting two replicas spend the same BYO key twice.
const seams = vi.hoisted(() => ({
  facts: vi.fn(),
  run: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@yapm/schema/db', () => ({
  retroFactsForCycle: seams.facts,
}))

vi.mock('@yapm/schema/server', () => ({
  upsertRetroAiDraft: seams.upsert,
}))

vi.mock('../ai/retro-draft.js', () => ({
  runRetroAiDraft: seams.run,
}))

import {
  RETRO_AI_DRAFT_INTERVAL_SECONDS,
  RETRO_AI_DRAFT_QUEUE,
  runRetroAiDraftTail,
} from './retro-draft.js'
import { startScheduler } from './scheduler.js'

const PENDING = {
  id: 'draft-1',
  retro_id: 'retro-1',
  team_id: 'team-1',
  cycle_id: 'cycle-1',
  workspace_id: 'ws-1',
  ai_retro_draft_since: new Date(),
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

// A minimal Kysely stand-in: the pending select is a fixed chain, and every raw `sql` template goes
// through `executeQuery`, which is where the claim lands. Each call is recorded in one ordered log
// shared with the faked provider run, so the ordering assertion is a plain index comparison.
function fakeDb(options: {
  pending: readonly unknown[]
  claims: readonly boolean[]
  events: string[]
}) {
  let claimIndex = 0
  const chain: Record<string, unknown> = {}
  for (const method of ['innerJoin', 'select', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  chain.execute = async () => options.pending

  // ONE recorder, reached through whichever of kysely's raw-`sql` entry points it uses. Duplicating
  // the body per entry point would let the ordering assertion pass against a path nobody takes.
  const executeClaim = async () => {
    options.events.push('claim')
    const granted = options.claims[claimIndex] ?? true
    claimIndex += 1
    return { rows: granted ? [{ id: PENDING.id }] : [] }
  }

  return {
    selectFrom: () => chain,
    executeQuery: executeClaim,
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery: executeClaim,
      provideConnection: async (fn: (c: unknown) => unknown) => fn({ executeQuery: executeClaim }),
      adapter: { supportsReturning: true },
      withPluginAtFront: () => ({}),
      plugins: [],
    }),
  } as never
}

function deps(options: {
  pending?: readonly unknown[]
  claims?: readonly boolean[]
  events?: string[]
}) {
  const events = options.events ?? []
  return {
    db: fakeDb({
      pending: options.pending ?? [PENDING],
      claims: options.claims ?? [true],
      events,
    }),
    dbProvider: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never,
    gateway: {} as never,
    logger: logger(),
    events,
  }
}

describe('runRetroAiDraftTail', () => {
  it('claims the row BEFORE the provider call', async () => {
    const events: string[] = []
    seams.facts.mockResolvedValue({ teamId: 'team-1', cycleId: 'cycle-1' })
    seams.run.mockImplementation(async () => {
      events.push('run')
      return { status: 'ready', proposals: 2 }
    })

    const options = deps({ events })
    const result = await runRetroAiDraftTail(options)

    expect(result.claimed).toBe(1)
    expect(result.ready).toBe(1)
    // Spelled as the full ordered log rather than an index comparison: `indexOf` on an absent event
    // returns -1, which would satisfy "claim before run" vacuously.
    expect(events).toEqual(['claim', 'run'])
  })

  it('skips a row whose claim was taken by another worker, with no provider call', async () => {
    const events: string[] = []
    seams.facts.mockReset()
    seams.run.mockReset()

    const result = await runRetroAiDraftTail(deps({ claims: [false], events }))

    expect(result).toEqual({ claimed: 0, ready: 0, aiOff: 0, failed: 0 })
    expect(seams.facts).not.toHaveBeenCalled()
    expect(seams.run).not.toHaveBeenCalled()
  })

  it('writes ai_off rather than leaving a retro with no cycle pending forever', async () => {
    seams.facts.mockReset()
    seams.run.mockReset()
    seams.upsert.mockReset()
    seams.upsert.mockResolvedValue({ id: PENDING.id, inserted: false })

    const result = await runRetroAiDraftTail(deps({ pending: [{ ...PENDING, cycle_id: null }] }))

    expect(result.aiOff).toBe(1)
    expect(seams.run).not.toHaveBeenCalled()
    expect(seams.upsert).toHaveBeenCalledWith(
      expect.anything(),
      // `updateOnly` is the half that matters: the row was claimed a moment ago, so if it is gone the
      // facilitator stepped back and deleted it, and this write must not bring it back.
      expect.objectContaining({
        status: 'ai_off',
        retroId: PENDING.retro_id,
        updateOnly: true,
      }),
    )
  })

  it('writes ai_off for a team that opted back out after the advance', async () => {
    seams.facts.mockReset()
    seams.run.mockReset()
    seams.upsert.mockReset()
    seams.upsert.mockResolvedValue({ id: PENDING.id, inserted: false })

    const result = await runRetroAiDraftTail(
      deps({ pending: [{ ...PENDING, ai_retro_draft_since: null }] }),
    )

    expect(result.aiOff).toBe(1)
    expect(seams.facts).not.toHaveBeenCalled()
    expect(seams.run).not.toHaveBeenCalled()
  })
})

interface RecordedQueue {
  name: string
  policy?: QueuePolicy
}
interface RecordedSchedule {
  name: string
  cron: string
}
interface RecordedSend {
  name: string
  startAfter: unknown
}

// The same recorder `search.test.ts` uses, and for the same reason: everything the block registers
// lands on ONE boss, so "no second PgBoss" is asserted by a block that registers nothing invisible.
function fakeBoss(existingPolicies: Record<string, QueuePolicy> = {}) {
  const queues: RecordedQueue[] = []
  const schedules: RecordedSchedule[] = []
  const sends: RecordedSend[] = []
  const deleted: string[] = []
  const workers = new Map<string, () => Promise<unknown>>()
  let started = 0
  const boss = {
    on: () => boss,
    start: () => {
      started += 1
      return Promise.resolve()
    },
    getQueue: (name: string) =>
      Promise.resolve(
        existingPolicies[name] === undefined ? null : { name, policy: existingPolicies[name] },
      ),
    deleteQueue: (name: string) => {
      deleted.push(name)
      return Promise.resolve()
    },
    createQueue: (name: string, options?: { policy?: QueuePolicy }) => {
      queues.push(options?.policy === undefined ? { name } : { name, policy: options.policy })
      return Promise.resolve()
    },
    work: (name: string, ...rest: unknown[]) => {
      workers.set(name, rest[rest.length - 1] as () => Promise<unknown>)
      return Promise.resolve('worker-id')
    },
    schedule: (name: string, cron: string) => {
      schedules.push({ name, cron })
      return Promise.resolve()
    },
    send: (name: string, _data?: unknown, options?: { startAfter?: unknown }) => {
      sends.push({ name, startAfter: options?.startAfter })
      return Promise.resolve('job-id')
    },
    stop: () => Promise.resolve(),
  }
  return {
    boss: boss as unknown as PgBoss,
    queues,
    schedules,
    sends,
    deleted,
    workers,
    startCount: () => started,
  }
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const RETRO_DRAFT = {
  gateway: {} as never,
  intervalSeconds: RETRO_AI_DRAFT_INTERVAL_SECONDS,
}

describe('startScheduler — retro AI draft queue topology', () => {
  it('creates the short-policy queue, the watchdog cron and the first link', async () => {
    const { boss, queues, schedules, sends, startCount } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      retroDraft: RETRO_DRAFT,
      boss,
    })

    // `short`, not `exclusive`: `exclusive` counts ACTIVE jobs, so the re-arm issued from inside the
    // running pass is rejected and the chain dies after one pass.
    expect(queues).toEqual([{ name: RETRO_AI_DRAFT_QUEUE, policy: 'short' }])
    expect(schedules).toEqual([{ name: RETRO_AI_DRAFT_QUEUE, cron: '* * * * *' }])
    expect(sends).toEqual([
      { name: RETRO_AI_DRAFT_QUEUE, startAfter: RETRO_AI_DRAFT_INTERVAL_SECONDS },
    ])
    expect(startCount()).toBe(0)
  })

  it('re-arms in a finally even when the pass throws', async () => {
    const { boss, workers, sends } = fakeBoss()
    seams.facts.mockReset()
    seams.run.mockReset()

    await startScheduler({
      db: {
        selectFrom: () => {
          throw new Error('the pass exploded')
        },
      } as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      retroDraft: RETRO_DRAFT,
      boss,
    })

    const worker = workers.get(RETRO_AI_DRAFT_QUEUE)
    expect(worker).toBeDefined()
    await expect(worker?.()).rejects.toThrow('the pass exploded')

    // Two sends: the registration-time first link, and the re-arm from the `finally`. Without the
    // `finally` a thrown pass would stop drafting until the next watchdog tick.
    expect(sends).toEqual([
      { name: RETRO_AI_DRAFT_QUEUE, startAfter: RETRO_AI_DRAFT_INTERVAL_SECONDS },
      { name: RETRO_AI_DRAFT_QUEUE, startAfter: RETRO_AI_DRAFT_INTERVAL_SECONDS },
    ])
  })

  it('recreates a queue whose policy has drifted, and leaves a correct one alone', async () => {
    const drifted = fakeBoss({ [RETRO_AI_DRAFT_QUEUE]: 'exclusive' })
    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      retroDraft: RETRO_DRAFT,
      boss: drifted.boss,
    })
    expect(drifted.deleted).toEqual([RETRO_AI_DRAFT_QUEUE])

    const correct = fakeBoss({ [RETRO_AI_DRAFT_QUEUE]: 'short' })
    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      retroDraft: RETRO_DRAFT,
      boss: correct.boss,
    })
    expect(correct.deleted).toEqual([])
  })

  it('registers nothing when the block is absent (AI_RETRO_DRAFT=false)', async () => {
    const { boss, queues, schedules, sends } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      boss,
    })

    expect(queues).toEqual([])
    expect(schedules).toEqual([])
    expect(sends).toEqual([])
  })

  it('gates independently of the cycle digest block', async () => {
    const { boss, queues } = fakeBoss()

    await startScheduler({
      db: {} as never,
      dbProvider: {} as never,
      logger: silentLogger() as never,
      retroDraft: RETRO_DRAFT,
      boss,
    })

    // No cycle block at all, and the retro tail is still registered: one artifact does not gate the
    // other.
    expect(queues.map((queue) => queue.name)).toEqual([RETRO_AI_DRAFT_QUEUE])
  })
})
