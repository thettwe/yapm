import { describe, expect, it } from 'vitest'
import type { RetroProposalVerdict } from '../context.js'
import type { RetroProposalCategory } from './ai-draft.js'
import { contestedFirst, retroProposalVerdict, sortContestedFirst } from './ratify.js'

// The rule, spelled out as a table, so changing the predicate has to change this too. It is FIXED
// and KNOB-FREE by maintainer decision: `retroProposalVerdict` takes no third argument and there is
// nowhere to put a threshold.
describe('retroProposalVerdict', () => {
  it.each<[number, number, RetroProposalVerdict]>([
    // Silence is not consent.
    [0, 0, 'unrated'],
    // Unanimous among responders, at any size.
    [1, 0, 'agreed'],
    [7, 0, 'agreed'],
    // A lone dissenter, and nobody else.
    [0, 1, 'rejected'],
    // THE MINORITY VETO: four agree, one disagrees, and it is still not agreed.
    [4, 1, 'contested'],
    [1, 1, 'contested'],
    [3, 3, 'contested'],
    // A strict majority against.
    [2, 3, 'rejected'],
    [1, 5, 'rejected'],
  ])('%i agree / %i disagree -> %s', (agree, disagree, expected) => {
    expect(retroProposalVerdict(agree, disagree)).toBe(expected)
  })

  it('never returns agreed once anyone has disagreed', () => {
    for (let agree = 0; agree <= 20; agree += 1) {
      for (let disagree = 1; disagree <= 20; disagree += 1) {
        expect(retroProposalVerdict(agree, disagree), `${agree}/${disagree}`).not.toBe('agreed')
      }
    }
  })

  it('is a total function over every non-negative pair it can be handed', () => {
    const seen = new Set<RetroProposalVerdict>()
    for (let agree = 0; agree <= 9; agree += 1) {
      for (let disagree = 0; disagree <= 9; disagree += 1) {
        seen.add(retroProposalVerdict(agree, disagree))
      }
    }
    expect([...seen].sort()).toEqual(['agreed', 'contested', 'rejected', 'unrated'])
  })
})

describe('contestedFirst', () => {
  const row = (id: string, verdict: RetroProposalVerdict | null) => ({ id, verdict })

  it('puts every contested proposal before every other one', () => {
    const sorted = sortContestedFirst([
      row('a', 'agreed'),
      row('b', 'contested'),
      row('c', 'rejected'),
      row('d', 'contested'),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  // The tail is where a naive comparator reshuffles what somebody is reading. `Array#sort` is stable,
  // so returning 0 for two same-class rows preserves the incoming (category, rank) order.
  it('leaves the non-contested tail in the order it arrived', () => {
    const sorted = sortContestedFirst([
      row('w1', 'agreed'),
      row('w2', 'unrated'),
      row('l1', 'rejected'),
      row('i1', null),
      row('i2', 'contested'),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['i2', 'w1', 'w2', 'l1', 'i1'])
  })

  it('changes nothing before the verdict is stamped', () => {
    const rows = [row('a', null), row('b', null), row('c', null)]
    expect(sortContestedFirst(rows).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(contestedFirst(row('a', null), row('b', null))).toBe(0)
  })

  it('does not mutate its input', () => {
    const rows = [row('a', 'agreed'), row('b', 'contested')]
    sortContestedFirst(rows)
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

// This comparator sorts on the STORED category, the same value the panel groups on, so the flat
// contested-first list and the grouped rendering cannot disagree about which category a proposal is
// in. Every field but the verdict is optional, and a row carrying none of them must sort exactly as
// it did before the category leg existed — which the four cases above assert, and this one completes.
describe('contestedFirst — category then rank', () => {
  const row = (
    id: string,
    verdict: RetroProposalVerdict | null,
    category: RetroProposalCategory,
    rank: number,
  ) => ({ id, verdict, category, rank })

  it('orders contested first, then by category, then by rank within the category', () => {
    const sorted = sortContestedFirst([
      row('i-1', 'agreed', 'improvement', 0),
      row('f-1', 'agreed', 'follow_up', 0),
      row('w-2', 'agreed', 'win', 1),
      row('f-0', 'contested', 'follow_up', 1),
      row('w-1', 'unrated', 'win', 0),
      row('l-1', 'rejected', 'loss', 0),
      row('f-2', 'agreed', 'follow_up', 1),
    ])

    expect(sorted.map((entry) => entry.id)).toEqual([
      'f-0',
      'w-1',
      'w-2',
      'l-1',
      'i-1',
      'f-1',
      'f-2',
    ])
  })

  it('leaves a row carrying neither a category nor a rank exactly where it arrived', () => {
    const bare = [
      { id: 'a', verdict: 'agreed' as const },
      { id: 'b', verdict: 'agreed' as const },
      { id: 'c', verdict: 'agreed' as const },
    ]
    expect(sortContestedFirst(bare).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(contestedFirst(bare[0] as never, bare[1] as never)).toBe(0)
    // And a bucketed row beside a bare one ties too, rather than jumping over it.
    expect(contestedFirst({ verdict: 'agreed' }, row('w', 'agreed', 'win', 0))).toBe(0)
  })
})
