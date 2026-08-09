import { describe, expect, it } from 'vitest'
import type { IssueStatus } from './context.js'
import {
  buildCycleRegister,
  CARRY_DEEP_DEPTH,
  type CycleRegisterCycleRow,
  type CycleRegisterInput,
  type CycleRegisterIssueRow,
} from './cycle-register.js'
import { buildTeamHome, type TeamHomeInput } from './team-home.js'

// THE REGISTER's derivation, at the two things only a test can hold: that the committed
// denominator degrades exactly where the schema stops being able to reconstruct it, and that a
// carry chain is drawn from `carryover_count` alone — never from cycle ordering.

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 7, 9, 0, 0)

const c1: CycleRegisterCycleRow = {
  id: 'cycle-1',
  number: 1,
  name: 'Cycle 1',
  status: 'completed',
  startDate: NOW - 42 * DAY,
  endDate: NOW - 29 * DAY,
}
const c2: CycleRegisterCycleRow = {
  id: 'cycle-2',
  number: 2,
  name: 'Cycle 2',
  status: 'completed',
  startDate: NOW - 28 * DAY,
  endDate: NOW - 15 * DAY,
}
const c3: CycleRegisterCycleRow = {
  id: 'cycle-3',
  number: 3,
  name: 'Cycle 3',
  status: 'active',
  startDate: NOW - 8 * DAY,
  endDate: NOW + 5 * DAY,
}
const c4: CycleRegisterCycleRow = {
  id: 'cycle-4',
  number: 4,
  name: 'Cycle 4',
  status: 'upcoming',
  startDate: NOW + 6 * DAY,
  endDate: NOW + 19 * DAY,
}

let nextIssue = 0
function issue(
  overrides: Partial<CycleRegisterIssueRow> & { status: IssueStatus },
): CycleRegisterIssueRow {
  nextIssue += 1
  return {
    id: `issue-${nextIssue}`,
    number: 100 + nextIssue,
    title: `Issue ${nextIssue}`,
    cycleId: null,
    cycleAssignedAt: null,
    carryoverCount: 0,
    rolledOverFromCycleId: null,
    ...overrides,
  }
}

function input(overrides: Partial<CycleRegisterInput> = {}): CycleRegisterInput {
  return { teamKey: 'ENG', cycles: [], issues: [], retros: [], digests: [], ...overrides }
}

// Four cycles, and one issue that has crossed two boundaries: it was committed to Cycle 1, carried
// into Cycle 2, carried again into Cycle 3, and `rolled_over_from_cycle_id` now names Cycle 2 only.
function threeCycleHistory(): CycleRegisterInput {
  nextIssue = 0
  return input({
    cycles: [c1, c2, c3, c4],
    issues: [
      // Cycle 1's remaining record: one landed issue still pointing at it, and one that carried.
      issue({ status: 'done', cycleId: c1.id, cycleAssignedAt: c1.startDate }),
      // Cycle 2's record: one landed, one added mid-cycle, and the traveller it handed forward.
      issue({ status: 'done', cycleId: c2.id, cycleAssignedAt: c2.startDate }),
      issue({ status: 'todo', cycleId: c2.id, cycleAssignedAt: c2.startDate + 3 * DAY }),
      // The traveller: now in Cycle 3, carried twice, last left Cycle 2. Its `cycleAssignedAt` is
      // the moment it LEFT Cycle 2 — the rollover overwrote the old one.
      issue({
        status: 'in_progress',
        cycleId: c3.id,
        cycleAssignedAt: c3.startDate,
        carryoverCount: 2,
        rolledOverFromCycleId: c2.id,
      }),
      // Cycle 3's own committed work: one landed, one still open.
      issue({ status: 'done', cycleId: c3.id, cycleAssignedAt: c3.startDate }),
      issue({ status: 'todo', cycleId: c3.id, cycleAssignedAt: c3.startDate }),
    ],
  })
}

describe('buildCycleRegister rows', () => {
  it('lists every cycle newest first, each with the glyph its status draws', () => {
    const register = buildCycleRegister(threeCycleHistory())

    expect(register.rows.map((row) => row.cycleId)).toEqual([c4.id, c3.id, c2.id, c1.id])
    expect(register.rows.map((row) => row.glyph)).toEqual([
      'upcoming',
      'active',
      'completed',
      'completed',
    ])
    expect(register.rows.map((row) => row.key)).toEqual([
      'Cycle 4',
      'Cycle 3',
      'Cycle 2',
      'Cycle 1',
    ])
  })

  // THE FALSIFIABLE CHECK, part one. The rule under test is not "completed cycles read differently"
  // — it is that a row claims a committed total exactly while its carried set is still addressable.
  it('claims a denominator for the open cycle and the latest completed one, and for no earlier one', () => {
    const register = buildCycleRegister(threeCycleHistory())
    const rowOf = (id: string) => register.rows.find((row) => row.cycleId === id)

    // Cycle 3 is running: every issue still points at it, so the total is simply a count of rows.
    const active = rowOf(c3.id)?.ledger
    expect(active?.denominatorKnown).toBe(true)
    expect(active?.reading).toBe('1/3')
    expect(active?.band).toEqual(['landed', 'open', 'open'])

    // Cycle 2 is the LATEST completed cycle: its carried set is still stamped, so its ledger is the
    // issues still pointing at it PLUS the traveller it handed forward — and the traveller counts
    // as COMMITTED to the cycle it left, not as work added to it. The rollover overwrote its
    // assignment stamp with the moment it left, so reading that stamp naively inverts the fact.
    const latestCompleted = rowOf(c2.id)?.ledger
    expect(latestCompleted?.denominatorKnown).toBe(true)
    expect(latestCompleted?.reading).toBe('1/2')
    expect(latestCompleted?.committed).toBe(2)
    expect(latestCompleted?.added).toBe(1)
    expect(latestCompleted?.band).toEqual(['landed', 'open', 'added'])
    expect(rowOf(c2.id)?.carriedForward).toBe(1)

    // Cycle 1 is an EARLIER completed cycle: the issue it handed forward has carried again and the
    // stamp naming it is gone. It reads what landed and claims no total, and draws no remainder.
    const earlier = rowOf(c1.id)?.ledger
    expect(earlier?.denominatorKnown).toBe(false)
    expect(earlier?.reading).toBe('1 landed')
    expect(earlier?.band).toEqual(['landed'])
    expect(earlier?.band).not.toContain('open')
    // A row that cannot count what it handed forward says nothing rather than printing a number
    // that shrinks every time one of its issues moves again.
    expect(rowOf(c1.id)?.carriedForward).toBe(0)
  })

  // The other half of the same trap: a carried-out issue's STATUS is the status it has NOW, in the
  // cycle it moved to. Reading it against the cycle it left credits that cycle with delivering work
  // it handed forward — a fully-delivered ratio printed beside `1 carried forward`.
  it('never credits the cycle it left with work that landed after the rollover', () => {
    const landedLater = threeCycleHistory()
    const rolled = landedLater.issues.map((issue) =>
      (issue.rolledOverFromCycleId ?? null) === c2.id
        ? { ...issue, status: 'done' as const }
        : issue,
    )
    const register = buildCycleRegister({ ...landedLater, issues: rolled })
    const ledger = register.rows.find((row) => row.cycleId === c2.id)?.ledger

    expect(ledger?.reading).toBe('1/2')
    expect(ledger?.landed).toBe(1)
    expect(ledger?.band).toEqual(['landed', 'open', 'added'])
  })

  it('states the ledger in words, so nothing on the row is carried by colour alone', () => {
    const register = buildCycleRegister(threeCycleHistory())
    const rowOf = (id: string) => register.rows.find((row) => row.cycleId === id)

    expect(rowOf(c3.id)?.ledger?.label).toBe('1 landed of 3 committed')
    expect(rowOf(c2.id)?.ledger?.label).toBe(
      '1 landed of 2 committed, 1 added after the cycle started',
    )
    expect(rowOf(c1.id)?.ledger?.label).toBe(
      '1 landed; the committed total is no longer reconstructible',
    )
  })

  // A ratio over the committed set can never print above 1, and the added work that landed is
  // stated rather than folded into the numerator — where it would credit the cycle with delivering
  // scope it never committed to.
  it('keeps added work out of the ratio and names it separately when it lands', () => {
    const register = buildCycleRegister(
      input({
        cycles: [c3],
        issues: [
          issue({ status: 'todo', cycleId: c3.id, cycleAssignedAt: c3.startDate }),
          issue({ status: 'done', cycleId: c3.id, cycleAssignedAt: c3.startDate + 2 * DAY }),
          issue({ status: 'done', cycleId: c3.id, cycleAssignedAt: c3.startDate + 3 * DAY }),
        ],
      }),
    )
    const ledger = register.rows[0]?.ledger

    expect(ledger?.reading).toBe('0/1')
    expect(ledger?.label).toBe(
      '0 landed of 1 committed, 2 added after the cycle started, of which 2 landed',
    )
  })

  // The everyday case behind this: a cycle created already running, then filled. `0/0` beside a
  // drawn block is a ratio about nothing.
  it('reads the scope it has when a cycle committed to nothing at all', () => {
    const register = buildCycleRegister(
      input({
        cycles: [c3],
        issues: [
          issue({ status: 'done', cycleId: c3.id, cycleAssignedAt: c3.startDate + DAY }),
          issue({ status: 'todo', cycleId: c3.id, cycleAssignedAt: c3.startDate + DAY }),
        ],
      }),
    )
    const ledger = register.rows[0]?.ledger

    expect(ledger?.reading).toBe('2 added')
    expect(ledger?.label).toBe('2 added after the cycle started, 1 of them landed')
    expect(ledger?.band).toEqual(['landed', 'added'])
  })
})

describe('buildCycleRegister carriedIn', () => {
  // THE FALSIFIABLE CHECK, part two: depth comes from the stored count, and exactly ONE hop is
  // named — inferring `Cycle 1` from the ordering would be an invention, and this pins that it
  // is not made.
  it('names the traveller with its depth and the one cycle the schema still records', () => {
    const carried = buildCycleRegister(threeCycleHistory()).carriedIn(c3.id)

    expect(carried?.count).toBe(1)
    expect(carried?.originName).toBe('Cycle 2')
    const row = carried?.rows[0]
    expect(row?.issueKey).toBe('ENG-104')
    expect(row?.depth).toBe(2)
    expect(row?.originCycleId).toBe(c2.id)
    expect(row?.fact).toBe('carried 2×')
    expect(row?.say).toBe('Carried 2 times; last left Cycle 2.')
    // Two boundaries crossed plus the node for now; the older origin is drawn as an unnamed hop,
    // and the lead-in stands for the part of the chain before the record begins.
    expect(row?.chain.nodes).toEqual(['unnamed', 'origin', 'now'])
    expect(row?.chain.leadIn).toBe(true)
    expect(row?.deep).toBe(false)
  })

  it('draws a single hop with no lead-in, and says it in the singular', () => {
    const once = input({
      cycles: [c2, c3],
      issues: [
        issue({
          status: 'todo',
          cycleId: c3.id,
          carryoverCount: 1,
          rolledOverFromCycleId: c2.id,
        }),
      ],
    })
    const row = buildCycleRegister(once).carriedIn(c3.id)?.rows[0]

    expect(row?.fact).toBe('carried 1×')
    expect(row?.say).toBe('Carried 1 time; last left Cycle 2.')
    expect(row?.chain.nodes).toEqual(['origin', 'now'])
    expect(row?.chain.leadIn).toBe(false)
  })

  it('washes a deeply carried row without naming a cycle it cannot name', () => {
    const deep = input({
      cycles: [c3],
      issues: [
        issue({ status: 'todo', cycleId: c3.id, carryoverCount: 3, rolledOverFromCycleId: null }),
      ],
    })
    const carried = buildCycleRegister(deep).carriedIn(c3.id)
    const row = carried?.rows[0]

    expect(CARRY_DEEP_DEPTH).toBe(3)
    expect(row?.deep).toBe(true)
    expect(row?.originCycleName).toBeNull()
    expect(carried?.originName).toBeNull()
    expect(row?.say).toBe('Carried 3 times; the cycles it left are no longer named.')
    expect(row?.chain.nodes).toEqual(['unnamed', 'unnamed', 'unnamed', 'now'])
  })

  it('says nothing about the band header origin when the carried rows came from different cycles', () => {
    const mixed = input({
      cycles: [c1, c2, c3],
      issues: [
        issue({ status: 'todo', cycleId: c3.id, carryoverCount: 1, rolledOverFromCycleId: c2.id }),
        issue({ status: 'todo', cycleId: c3.id, carryoverCount: 2, rolledOverFromCycleId: c1.id }),
      ],
    })
    const carried = buildCycleRegister(mixed).carriedIn(c3.id)

    expect(carried?.count).toBe(2)
    expect(carried?.originName).toBeNull()
    // Deepest first, so the row that has travelled furthest leads the band.
    expect(carried?.rows.map((row) => row.depth)).toEqual([2, 1])
  })

  // A row whose reference names nothing is NOT agreement with the row that names something: the
  // header would otherwise put an issue with no recorded origin under a cycle's name.
  it('says nothing about the header origin when one carried row names no origin at all', () => {
    const partial = input({
      cycles: [c2, c3],
      issues: [
        issue({ status: 'todo', cycleId: c3.id, carryoverCount: 1, rolledOverFromCycleId: c2.id }),
        issue({ status: 'todo', cycleId: c3.id, carryoverCount: 2, rolledOverFromCycleId: null }),
      ],
    })
    const carried = buildCycleRegister(partial).carriedIn(c3.id)

    expect(carried?.count).toBe(2)
    expect(carried?.originName).toBeNull()
    expect(carried?.rows.map((row) => row.originCycleName)).toEqual([null, 'Cycle 2'])
  })
})

describe('buildCycleRegister artifact chips', () => {
  const withArtifacts = (
    digests: CycleRegisterInput['digests'],
    retros: CycleRegisterInput['retros'],
  ) => buildCycleRegister(input({ cycles: [c3], digests, retros })).rows[0]?.chips

  it('draws the report chip only for a stored digest that is ready with content', () => {
    expect(withArtifacts([], [])).toEqual({ cycleReport: false, wrapped: false })
    expect(
      withArtifacts([{ cycleId: c3.id, status: 'pending', content: { headline: 'soon' } }], []),
    ).toEqual({ cycleReport: false, wrapped: false })
    expect(withArtifacts([{ cycleId: c3.id, status: 'ready', content: null }], [])).toEqual({
      cycleReport: false,
      wrapped: false,
    })
    expect(
      withArtifacts(
        [{ cycleId: c3.id, status: 'ready', content: { headline: 'A good week.' } }],
        [],
      ),
    ).toEqual({ cycleReport: true, wrapped: false })
  })

  it('draws the wrapped chip only for a CLOSED retro, never for one still open', () => {
    expect(withArtifacts([], [{ cycleId: c3.id, closedAt: null }])).toEqual({
      cycleReport: false,
      wrapped: false,
    })
    expect(withArtifacts([], [{ cycleId: c3.id, closedAt: NOW - DAY }])).toEqual({
      cycleReport: false,
      wrapped: true,
    })
    // An artifact belonging to another cycle never leaks onto this row.
    expect(withArtifacts([], [{ cycleId: c2.id, closedAt: NOW - DAY }])).toEqual({
      cycleReport: false,
      wrapped: false,
    })
  })
})

describe('buildCycleRegister degenerate inputs', () => {
  it('a team with no cycles publishes no rows and no carried band', () => {
    const register = buildCycleRegister(input())
    expect(register.rows).toEqual([])
    expect(register.carriedIn(null)).toBeNull()
    expect(register.carriedIn('cycle-nobody')).toBeNull()
  })

  it("a team's very first cycle is one row with no history behind it", () => {
    const first = input({
      cycles: [c3],
      issues: [issue({ status: 'todo', cycleId: c3.id, cycleAssignedAt: c3.startDate })],
    })
    const register = buildCycleRegister(first)

    expect(register.rows).toHaveLength(1)
    expect(register.rows[0]?.ledger?.reading).toBe('0/1')
    expect(register.rows[0]?.carriedForward).toBe(0)
    // Nothing has crossed a boundary yet, so the band folds rather than drawing a zero.
    expect(register.carriedIn(c3.id)).toBeNull()
  })

  it('a cycle with no issues folds its ledger rather than drawing an empty rail', () => {
    const register = buildCycleRegister(input({ cycles: [c3, c4] }))
    expect(register.rows.every((row) => row.ledger === null)).toBe(true)
  })

  // Dropping the open blocks from a degraded row can leave nothing to draw at all.
  it('a degraded cycle whose visible band is empty folds too', () => {
    const stale = input({
      cycles: [c1, c2],
      issues: [issue({ status: 'canceled', cycleId: c1.id, cycleAssignedAt: c1.startDate })],
    })
    const row = buildCycleRegister(stale).rows.find((candidate) => candidate.cycleId === c1.id)
    expect(row?.ledger).toBeNull()
  })

  it('a cycle whose issues all carried nothing draws no carry band', () => {
    const register = buildCycleRegister(
      input({
        cycles: [c3],
        issues: [issue({ status: 'todo', cycleId: c3.id, carryoverCount: 0 })],
      }),
    )
    expect(register.carriedIn(c3.id)).toBeNull()
  })

  it('renders a cycle with no number and no name without inventing either', () => {
    const bare: CycleRegisterCycleRow = {
      id: 'cycle-bare',
      number: null,
      name: '   ',
      status: 'upcoming',
      startDate: NOW,
      endDate: NOW + DAY,
    }
    const row = buildCycleRegister(input({ cycles: [bare] })).rows[0]
    expect(row?.key).toBe('Cycle …')
    expect(row?.name).toBe('Cycle …')
  })
})

// D1: Home's hero and the register may not disagree about the same cycle, which is only true while
// exactly one function computes the band. This fails the moment either surface grows its own copy.
describe('the scope band is one rule, shared with Home’s hero', () => {
  it('gives buildHeroCycle and buildCycleRegister the identical band and counts', () => {
    const issues = [
      { status: 'done' as const, cycleAssignedAt: c3.startDate },
      { status: 'in_progress' as const, cycleAssignedAt: c3.startDate },
      // A carry-in is assigned at rollover time and stays COMMITTED, not added.
      { status: 'todo' as const, cycleAssignedAt: c3.startDate, carryoverCount: 1 },
      { status: 'todo' as const, cycleAssignedAt: c3.startDate + 2 * DAY },
    ]

    const homeInput: TeamHomeInput = {
      team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
      cycles: [c3],
      issues: issues.map((row, index) => ({
        id: `issue-${index}`,
        number: 200 + index,
        title: `Issue ${index}`,
        status: row.status,
        priority: 'medium' as const,
        assigneeId: null,
        cycleId: c3.id,
        cycleAssignedAt: row.cycleAssignedAt,
        createdAt: c3.startDate,
        updatedAt: NOW,
      })),
      triage: [],
      deployments: [],
      digest: null,
      retros: [],
      notifications: [],
    }

    const hero = buildTeamHome(homeInput, NOW, 'user-viewer').hero.cycle?.scope
    const ledger = buildCycleRegister(
      input({
        cycles: [c3],
        issues: homeInput.issues.map((row) => ({
          id: row.id,
          number: row.number,
          title: row.title,
          status: row.status,
          cycleId: row.cycleId,
          cycleAssignedAt: row.cycleAssignedAt,
        })),
      }),
    ).rows[0]?.ledger

    expect(hero).toBeDefined()
    expect(ledger?.band).toEqual(hero?.band)
    expect(ledger?.committed).toBe(hero?.committed)
    expect(ledger?.landed).toBe(hero?.landed)
    expect(ledger?.added).toBe(hero?.added)
    // …and the register's ratio is derived from that same band, not from a second count of rows.
    const open = (hero?.band ?? []).filter((block) => block === 'open').length
    expect(ledger?.reading).toBe(`${(hero?.committed ?? 0) - open}/${hero?.committed}`)
  })
})
