import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mustGetMutator, type Transaction } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { type AuthContext, SYSTEM_AUTH_CONTEXT } from './context.js'
import { mutators } from './mutators.js'

// A workspace admin, so the read path is byte-identical to the system principal's: `canWrite` and
// `assertTeamAccess` both short-circuit on the role, and the ONLY thing that differs between the two
// contexts below is `userID`. That isolation is the point — anything the two runs disagree about is
// attributable to the stamp and to nothing else.
const HUMAN: AuthContext = { userID: 'user-admin', role: 'admin' }

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'
const AT = 1_700_000_000_000

interface RecordedCall {
  table: string
  verb: 'insert' | 'update' | 'delete' | 'upsert'
  value: Record<string, unknown>
}

function fakeTx(runResults: unknown[] = []) {
  const calls: RecordedCall[] = []
  const runQueue = [...runResults]

  const tableMutator = (table: string) => ({
    insert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'insert', value })
      return Promise.resolve()
    },
    update: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'update', value })
      return Promise.resolve()
    },
    delete: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'delete', value })
      return Promise.resolve()
    },
    upsert: (value: Record<string, unknown>) => {
      calls.push({ table, verb: 'upsert', value })
      return Promise.resolve()
    },
  })

  return {
    calls,
    tx: {
      location: 'server',
      reason: 'authoritative',
      run: () => Promise.resolve(runQueue.shift()),
      mutate: new Proxy({}, { get: (_t, table: string) => tableMutator(table) }),
    } as unknown as Transaction,
  }
}

interface Driver {
  readonly path: string
  readonly run: (ctx: AuthContext) => Promise<RecordedCall[]>
}

// One driver per mutator that writes `issue.status`. The list is NOT the guard — the guard is the
// source scan below, which derives the same set mechanically and fails when the two disagree.
const DRIVERS: readonly Driver[] = [
  {
    path: 'issue.create',
    run: async (ctx) => {
      const { tx, calls } = fakeTx([])
      await mutators.issue.create.fn({
        tx,
        args: {
          id: newId(),
          teamId: TEAM_ID,
          title: 'Fix the thing',
          status: 'todo',
          priority: 'no_priority',
          createdAt: AT,
          updatedAt: AT,
        },
        ctx,
      })
      return calls
    },
  },
  {
    path: 'issue.setStatus',
    run: async (ctx) => {
      const id = newId()
      const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
      await mutators.issue.setStatus.fn({ tx, args: { id, status: 'done', updatedAt: AT }, ctx })
      return calls
    },
  },
  {
    path: 'issue.move',
    run: async (ctx) => {
      const id = newId()
      const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
      await mutators.issue.move.fn({
        tx,
        args: { id, status: 'in_review', rank: 'a1', updatedAt: AT },
        ctx,
      })
      return calls
    },
  },
  {
    path: 'issue.declineTriage',
    run: async (ctx) => {
      const id = newId()
      const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
      await mutators.issue.declineTriage.fn({ tx, args: { id, updatedAt: AT }, ctx })
      return calls
    },
  },
  {
    path: 'issue.routeIssue',
    run: async (ctx) => {
      const id = newId()
      const { tx, calls } = fakeTx([{ id, teamId: TEAM_ID }])
      await mutators.issue.routeIssue.fn({
        tx,
        args: { id, status: 'in_progress', updatedAt: AT },
        ctx,
      })
      return calls
    },
  },
]

function issueWrite(calls: readonly RecordedCall[]): Record<string, unknown> {
  const write = calls.find((call) => call.table === 'issue')
  if (write === undefined) throw new Error('the driver produced no issue write')
  return write.value
}

describe('the human-intent stamp on every status-writing mutator', () => {
  it.each(DRIVERS.map((driver) => [driver.path, driver] as const))(
    '%s stamps last_human_status_at for a person',
    async (_path, driver) => {
      const value = issueWrite(await driver.run(HUMAN))
      expect(value.status, 'the driver must actually write a status').toBeDefined()
      expect(value.lastHumanStatusAt).toBe(AT)
    },
  )

  // The absence IS the audit record: `decideAutoStatus` reads this column to tell "a person decided
  // this" from "the instance advanced it", so a machine write that stamped it would make automation
  // permanently block itself one delivery later.
  it.each(DRIVERS.map((driver) => [driver.path, driver] as const))(
    '%s leaves it untouched for the system principal',
    async (_path, driver) => {
      const value = issueWrite(await driver.run(SYSTEM_AUTH_CONTEXT))
      expect(value.status, 'the driver must actually write a status').toBeDefined()
      expect(value).not.toHaveProperty('lastHumanStatusAt')
    },
  )
})

// The mechanical half. A sixth mutator that writes `issue.status` — added months from now by
// someone who has never read this file — must fail HERE rather than silently opening a hole through
// which automation can overwrite a human. So the set of status writers is derived from the source
// rather than listed, and compared against the drivers above.
describe('the set of status-writing mutators is closed', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./mutators.ts', import.meta.url)), 'utf8')

  const definitions = [...SOURCE.matchAll(/export const (\w+) = defineMutator\(/gu)].map(
    (match) => ({ index: match.index, ident: match[1] as string }),
  )

  function ownerOf(index: number): string {
    let owner: string | undefined
    for (const definition of definitions) {
      if (definition.index >= index) break
      owner = definition.ident
    }
    if (owner === undefined) throw new Error(`no mutator encloses source offset ${index}`)
    return owner
  }

  // The slice from `open` to the matching close, balanced so a nested `humanStatusStamp(...)`, a
  // ternary or an inner object does not truncate it.
  function balanced(open: number, opener: string, closer: string): string {
    let depth = 0
    for (let i = open; i < SOURCE.length; i += 1) {
      const char = SOURCE[i]
      if (char === opener) depth += 1
      else if (char === closer) {
        depth -= 1
        if (depth === 0) return SOURCE.slice(open, i + 1)
      }
    }
    throw new Error(`unbalanced ${opener} starting at ${open}`)
  }

  // `defineMutators` wraps every definition, so the registered object is not identity-equal to the
  // exported const and the source identifier has to be linked to its registry path through the
  // registry literal itself. The count self-check below is what fails — loudly — if a reformat ever
  // puts an entry on a shape this walk does not read, rather than letting it under-detect in silence.
  function pathByIdentifier(): Map<string, string> {
    const literal = balanced(SOURCE.indexOf('{', SOURCE.indexOf('defineMutators(')), '{', '}')
    const paths = new Map<string, string>()
    let group: string | undefined
    for (const line of literal.split('\n')) {
      const opened = /^ {2}(\w+): \{$/u.exec(line)
      if (opened?.[1] !== undefined) {
        group = opened[1]
        continue
      }
      if (/^ {2}\},?$/u.test(line)) {
        group = undefined
        continue
      }
      if (group === undefined) continue
      const pair = /^ {4}(\w+): (\w+),$/u.exec(line)
      if (pair?.[1] !== undefined && pair[2] !== undefined) {
        paths.set(pair[2], `${group}.${pair[1]}`)
        continue
      }
      const shorthand = /^ {4}(\w+),$/u.exec(line)
      if (shorthand?.[1] !== undefined) paths.set(shorthand[1], `${group}.${shorthand[1]}`)
    }
    return paths
  }

  function detectStatusWriters(): Set<string> {
    const paths = pathByIdentifier()
    const detected = new Set<string>()
    for (const match of SOURCE.matchAll(/tx\.mutate\.issue\.(?:insert|update|upsert)\(/gu)) {
      const open = match.index + match[0].length - 1
      const body = balanced(open, '(', ')').replaceAll(/^[ \t]*\/\/.*$/gmu, '')
      if (!/\bstatus\s*:/u.test(body)) continue
      const ident = ownerOf(match.index)
      const path = paths.get(ident)
      if (path === undefined) {
        throw new Error(`${ident} writes issue.status but is not registered in the mutators map`)
      }
      detected.add(path)
    }
    return detected
  }

  it('reads the whole registry literal, so nothing can hide from the scan', () => {
    const paths = pathByIdentifier()
    // `defineMutators` brands both the map and each group with a `~` key; everything else is a
    // mutator, and every one of them has to be reachable from the literal walk above.
    const registered = Object.entries(mutators)
      .filter(([group]) => group !== '~')
      .flatMap(([group, entries]) =>
        Object.keys(entries as object)
          .filter((name) => name !== '~')
          .map((name) => `${group}.${name}`),
      )
    expect([...paths.values()].sort()).toEqual(registered.sort())
    for (const path of paths.values()) {
      expect(mustGetMutator(mutators, path).mutatorName, path).toBe(path)
    }
  })

  it('finds a status writer at all, so the detector is not silently broken', () => {
    expect(detectStatusWriters().size).toBeGreaterThan(0)
  })

  it('matches the drivers above exactly', () => {
    const detected = [...detectStatusWriters()].sort()
    const driven = DRIVERS.map((driver) => driver.path).sort()
    expect(detected, 'add a driver above for every new mutator that writes issue.status').toEqual(
      driven,
    )
  })

  // The detector has to discriminate, or the previous assertion is satisfied by a rule that matches
  // everything. These three write the `issue` row and deliberately do not touch its status.
  it.each(['issue.update', 'issue.assign', 'issue.setPriority'])(
    'does not mistake %s for a status writer',
    (path) => {
      expect([...detectStatusWriters()]).not.toContain(path)
    },
  )
})
