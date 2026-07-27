import { describe, expect, it } from 'vitest'
import { LOCAL_RESULT_LIMIT, type LocalSearchCandidate, mergeLocalCandidates } from './merge.js'

function issue(
  id: string,
  title: string,
  updatedAt: number,
  extra: Partial<LocalSearchCandidate> = {},
): LocalSearchCandidate {
  return { kind: 'issue', id, title, updatedAt, number: null, ...extra }
}

describe('mergeLocalCandidates', () => {
  it('orders by tier first and by updatedAt descending inside a tier', () => {
    const results = mergeLocalCandidates(
      [
        [
          issue('a', 'Reconnect the socket', 1),
          issue('b', 'Socket reconnect loop', 3),
          issue('c', 'Fix the socket reconnect', 2),
          issue('d', 'Unrelated', 9, { body: 'socket' }),
        ],
      ],
      'socket',
    )

    expect(results.map((result) => [result.candidate.id, result.tier])).toEqual([
      ['b', 'title-prefix'],
      ['c', 'title-substring'],
      ['a', 'title-substring'],
      ['d', 'body-substring'],
    ])
  })

  it('breaks ties only by updatedAt, leaving equal rows in source order', () => {
    const results = mergeLocalCandidates(
      [[issue('first', 'socket a', 5), issue('second', 'socket b', 5)]],
      'socket',
    )
    expect(results.map((result) => result.candidate.id)).toEqual(['first', 'second'])
  })

  it('returns an issue reached through two sources exactly once, from the first', () => {
    const fromTeam = issue('shared', 'Socket work', 1)
    const fromTriage = issue('shared', 'Socket work', 99)
    const results = mergeLocalCandidates([[fromTeam], [fromTriage]], 'socket')

    expect(results).toHaveLength(1)
    expect(results[0]?.candidate.updatedAt).toBe(1)
  })

  it('keeps entities of different kinds that happen to share an id', () => {
    const results = mergeLocalCandidates(
      [
        [
          { kind: 'issue', id: 'x', title: 'Socket', updatedAt: 1 },
          { kind: 'project', id: 'x', title: 'Socket', updatedAt: 1 },
        ],
      ],
      'socket',
    )
    expect(results.map((result) => result.candidate.kind)).toEqual(['issue', 'project'])
  })

  it('caps the result set and defaults the cap to the shared constant', () => {
    const many = Array.from({ length: LOCAL_RESULT_LIMIT + 25 }, (_, index) =>
      issue(`i-${index}`, `socket ${index}`, index),
    )
    expect(mergeLocalCandidates([many], 'socket')).toHaveLength(LOCAL_RESULT_LIMIT)
    expect(mergeLocalCandidates([many], 'socket', 5)).toHaveLength(5)
  })

  it('produces the same order twice for the same input', () => {
    const sources = [
      [issue('a', 'socket a', 3), issue('b', 'reconnect socket', 3)],
      [issue('c', 'socket c', 7)],
    ]
    expect(mergeLocalCandidates(sources, 'socket')).toEqual(mergeLocalCandidates(sources, 'socket'))
  })

  it('returns nothing for a blank query rather than everything', () => {
    expect(mergeLocalCandidates([[issue('a', 'anything', 1)]], '  ')).toEqual([])
  })
})
