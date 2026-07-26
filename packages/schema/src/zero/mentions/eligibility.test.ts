import { describe, expect, it } from 'vitest'
import { intersectEligible } from './eligibility.js'

const CANDIDATES = ['user-b', 'user-c', 'user-d']

describe('intersectEligible', () => {
  it('admits a member of the issue’s team', () => {
    expect([...intersectEligible(CANDIDATES, ['user-b'], [])]).toEqual(['user-b'])
  })

  it('admits a workspace admin who is not on the team — the same bypass teamScoped grants', () => {
    expect([...intersectEligible(CANDIDATES, [], ['user-d'])]).toEqual(['user-d'])
  })

  it('omits a workspace member who is neither, rather than erroring', () => {
    expect([...intersectEligible(CANDIDATES, ['user-b'], ['user-d'])]).toEqual(['user-b', 'user-d'])
  })

  it('omits an id that names nobody, indistinguishably from one that is disallowed', () => {
    expect([...intersectEligible(['user-nobody'], ['user-b'], ['user-d'])]).toEqual([])
  })

  it('keeps the candidates’ own order, not either read’s', () => {
    expect([...intersectEligible(CANDIDATES, ['user-c'], ['user-d', 'user-b'])]).toEqual([
      'user-b',
      'user-c',
      'user-d',
    ])
  })

  it('is unaffected by a person appearing in both reads', () => {
    expect([...intersectEligible(CANDIDATES, ['user-b'], ['user-b'])]).toEqual(['user-b'])
  })

  it('admits nobody when neither read returns anything', () => {
    expect([...intersectEligible(CANDIDATES, [], [])]).toEqual([])
  })
})
