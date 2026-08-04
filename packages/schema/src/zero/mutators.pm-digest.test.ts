import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import type { AuthContext } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { mutators } from './mutators.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }
const NON_MEMBER: AuthContext = { userID: 'user-outsider', role: null }

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const DIGEST_ID = '019f8f00-0000-7000-8000-0000000000e1'
const AT = 1_800_000_000_000

interface RecordedCall {
  table: string
  verb: string
  value: Record<string, unknown>
}

// Answers `run` from a queue, in order. It cannot see its own writes, which is exactly right here:
// every claim below is about the ORDER of the gates, not about how rows affect each other.
function fakeTx(runResults: unknown[] = []) {
  const calls: RecordedCall[] = []
  const runQueue = [...runResults]
  const tableMutator = (table: string) =>
    new Proxy(
      {},
      {
        get: (_t, verb: string) => (value: Record<string, unknown>) => {
          calls.push({ table, verb, value })
          return Promise.resolve()
        },
      },
    )
  const tx = {
    location: 'server',
    reason: 'authoritative',
    run: () => {
      if (runQueue.length === 0) throw new Error('fakeTx: unexpected read')
      return Promise.resolve(runQueue.shift())
    },
    mutate: new Proxy({}, { get: (_t, table: string) => tableMutator(table) }),
  } as unknown as Transaction
  return { tx, calls, runQueue }
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (thrown) {
    return thrown
  }
  return undefined
}

const digestRow = (over: Record<string, unknown> = {}) => ({
  id: DIGEST_ID,
  teamId: TEAM_ID,
  status: 'ready',
  publishedAt: null,
  ...over,
})

const membership = { id: 'tm-1', teamId: TEAM_ID, userId: MEMBER.userID }

describe('pmDigest.publish — the only write that crosses the boundary', () => {
  it('publishes a ready, unpublished digest for a member of the producing team', async () => {
    const { tx, calls } = fakeTx([digestRow(), membership])
    await mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: MEMBER })
    expect(calls).toEqual([
      {
        table: 'pm_digest',
        verb: 'update',
        value: { id: DIGEST_ID, publishedAt: AT, updatedAt: AT },
      },
    ])
  })

  // THE ORDER IS THE POINT. A viewer is rejected before the row is ever read, so the refusal cannot
  // depend on — and cannot reveal — whether the digest exists. The empty run queue is what proves it:
  // the stub would throw on any read.
  it('rejects a viewer and a non-member before any existence check', async () => {
    for (const ctx of [VIEWER, NON_MEMBER, undefined]) {
      const { tx, calls, runQueue } = fakeTx([])
      const error = await capture(
        mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx }),
      )
      expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
      expect(calls).toEqual([])
      expect(runQueue).toEqual([])
    }
  })

  // A nonexistent id and an unauthorized one produce the SAME error, so nothing about which digests
  // exist leaks through the write path either.
  it('answers a nonexistent id exactly as it answers a foreign one', async () => {
    const missing = await capture(
      mutators.pmDigest.publish.fn({
        tx: fakeTx([undefined]).tx,
        args: { id: DIGEST_ID, updatedAt: AT },
        ctx: MEMBER,
      }),
    )
    const foreign = await capture(
      mutators.pmDigest.publish.fn({
        // The row exists, but the caller has no membership of its team.
        tx: fakeTx([digestRow(), undefined]).tx,
        args: { id: DIGEST_ID, updatedAt: AT },
        ctx: MEMBER,
      }),
    )
    expect(mutationErrorCode(missing)).toBe(MutationErrorCode.notAuthorized)
    expect(mutationErrorCode(foreign)).toBe(mutationErrorCode(missing))
    expect((missing as Error).message).toBe((foreign as Error).message)
  })

  // Nothing that failed, was capped, or has not run yet can be disclosed — there is nothing in it to
  // disclose, and offering the control would show an error to a producing team about a reader who
  // will never see anything either way.
  it.each(['pending', 'failed', 'ai_off'])('refuses to publish a %s digest', async (status) => {
    const { tx, calls } = fakeTx([digestRow({ status }), membership])
    const error = await capture(
      mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  // Re-publishing would overwrite the audience-size snapshot the producing team was shown.
  it('refuses to publish an already published digest', async () => {
    const { tx, calls } = fakeTx([digestRow({ publishedAt: AT - 1 }), membership])
    const error = await capture(
      mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: MEMBER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(calls).toEqual([])
  })

  // Not a new grant: `assertTeamAccess` already gives a workspace admin every team on the write side.
  it('lets a workspace admin publish under the existing team-access bypass', async () => {
    const { tx, calls } = fakeTx([digestRow()])
    await mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: ADMIN })
    expect(calls).toHaveLength(1)
  })
})

describe('pmDigest.unpublish — stops further reads, un-reads nothing', () => {
  it('clears the publication for a member of the producing team, whatever the status', async () => {
    const { tx, calls } = fakeTx([digestRow({ publishedAt: AT - 1 }), membership])
    await mutators.pmDigest.unpublish.fn({
      tx,
      args: { id: DIGEST_ID, updatedAt: AT },
      ctx: MEMBER,
    })
    expect(calls).toEqual([
      {
        table: 'pm_digest',
        verb: 'update',
        value: { id: DIGEST_ID, publishedAt: null, updatedAt: AT },
      },
    ])
  })

  it('rejects a viewer before any existence check', async () => {
    const { tx, runQueue } = fakeTx([])
    const error = await capture(
      mutators.pmDigest.unpublish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: VIEWER }),
    )
    expect(mutationErrorCode(error)).toBe(MutationErrorCode.notAuthorized)
    expect(runQueue).toEqual([])
  })
})

describe('the artifact has no other client write path', () => {
  it('registers exactly publish and unpublish, and nothing that writes content', () => {
    // `~` is `defineMutators`' branded phantom key, not a mutator.
    expect(Object.keys(mutators.pmDigest).filter((key) => key !== '~')).toEqual([
      'publish',
      'unpublish',
    ])
    expect(mustGetMutator(mutators, 'pmDigest.publish')).toBe(mutators.pmDigest.publish)
    expect(() => mustGetMutator(mutators, 'pmDigest.create')).toThrow()
  })

  // Neither mutator mints an id, so the rebase hazard the UUIDv7-at-the-call-site rule exists for
  // cannot arise: both address a row that already exists.
  it('mints no id: every write is an update addressed by the argument id', async () => {
    const { tx, calls } = fakeTx([digestRow(), membership])
    await mutators.pmDigest.publish.fn({ tx, args: { id: DIGEST_ID, updatedAt: AT }, ctx: MEMBER })
    expect(calls.every((call) => call.verb === 'update' && call.value.id === DIGEST_ID)).toBe(true)
  })
})
