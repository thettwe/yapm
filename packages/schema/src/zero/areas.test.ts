import { describe, expect, it } from 'vitest'
import {
  type AreaRule,
  areaCatalogFromRules,
  areaMapSchema,
  areasForPaths,
  CHANGE_SIZE_BANDS,
  changeSizeBand,
  matchArea,
  RESERVED_AREA_MESSAGE,
  UNMAPPED_AREA,
} from './areas.js'

// The ordered map an operator would plausibly write: the narrow rule FIRST, so the two `apps/server`
// rules exercise first-match-wins rather than tying.
const rules: AreaRule[] = [
  { prefix: 'apps/server/src/billing/', area: 'Billing', sensitive: true },
  { prefix: 'apps/server/', area: 'Backend' },
  { prefix: 'apps/web/', area: 'Web' },
  { prefix: 'packages/config/', area: 'Tooling', internal: true },
  { prefix: '.github/', area: 'Tooling', internal: true },
]

describe('matchArea — literal prefixes, first match wins', () => {
  it('returns the FIRST matching rule, not the longest or the last', () => {
    expect(matchArea(rules, 'apps/server/src/billing/refund.ts')?.area).toBe('Billing')
    expect(matchArea(rules, 'apps/server/src/index.ts')?.area).toBe('Backend')
  })

  it('is order-sensitive: reversing the map changes the winner', () => {
    const reversed = [...rules].reverse()
    expect(matchArea(reversed, 'apps/server/src/billing/refund.ts')?.area).toBe('Backend')
  })

  it('normalizes leading ./ and / and compares case-insensitively', () => {
    for (const path of [
      'apps/server/src/billing/refund.ts',
      './apps/server/src/billing/refund.ts',
      '/apps/server/src/billing/refund.ts',
      './/apps/server/src/billing/refund.ts',
      'Apps/Server/src/Billing/Refund.ts',
      '  apps/server/src/billing/refund.ts  ',
    ]) {
      expect(matchArea(rules, path)?.area).toBe('Billing')
    }
    // The rule's own prefix is normalized the same way, so an operator's leading slash still works.
    expect(matchArea([{ prefix: '/APPS/Web/', area: 'Web' }], 'apps/web/main.tsx')?.area).toBe(
      'Web',
    )
  })

  it('treats the prefix literally — a glob or regex metacharacter matches nothing special', () => {
    const globbed: AreaRule[] = [{ prefix: 'apps/*/src/', area: 'Any' }]
    expect(matchArea(globbed, 'apps/server/src/index.ts')).toBeNull()
    expect(matchArea(globbed, 'apps/*/src/index.ts')?.area).toBe('Any')
  })

  it('returns null for an unmatched path and for an empty rule set', () => {
    expect(matchArea(rules, 'docs/readme.md')).toBeNull()
    expect(matchArea([], 'apps/server/src/billing/refund.ts')).toBeNull()
  })
})

describe('areasForPaths — the substitution is total, a raw path is never returned', () => {
  it('maps every path to a label, deduplicated and sorted', () => {
    const result = areasForPaths(rules, [
      'apps/web/routes/board.tsx',
      'apps/server/src/index.ts',
      'apps/server/src/billing/refund.ts',
      'apps/server/src/billing/plan.ts',
    ])
    expect(result.areas).toEqual(['Backend', 'Billing', 'Web'])
    expect(result.sensitive).toEqual(['Billing'])
    expect(result.internalOnly).toBe(false)
  })

  it('yields `unmapped` — never the raw path — for an unmatched path', () => {
    const result = areasForPaths(rules, ['docs/refund-policy.md'])
    expect(result.areas).toEqual([UNMAPPED_AREA])
    expect(JSON.stringify(result)).not.toContain('docs/')
    expect(JSON.stringify(result)).not.toContain('refund-policy')
  })

  it('yields `unmapped` for EVERY path under an empty rule set, and still no raw path', () => {
    const paths = ['apps/server/src/billing/refund.ts', 'apps/web/main.tsx', 'README.md']
    const result = areasForPaths([], paths)
    expect(result.areas).toEqual([UNMAPPED_AREA])
    const serialized = JSON.stringify(result)
    for (const path of paths) expect(serialized).not.toContain(path)
    for (const fragment of ['refund', '.ts', '.tsx', '.md', '/']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('is internalOnly only when every path matched an internal rule', () => {
    expect(
      areasForPaths(rules, ['packages/config/base.json', '.github/workflows/ci.yml']),
    ).toMatchObject({ areas: ['Tooling'], internalOnly: true })
    // One non-internal path disqualifies the collapse.
    expect(
      areasForPaths(rules, ['packages/config/base.json', 'apps/web/main.tsx']).internalOnly,
    ).toBe(false)
    // An unmapped path disqualifies it too: yapm does not know where that work landed.
    expect(areasForPaths(rules, ['packages/config/base.json', 'docs/readme.md']).internalOnly).toBe(
      false,
    )
    // An empty path list is not "internal only" — it is nothing at all.
    expect(areasForPaths(rules, [])).toEqual({ areas: [], sensitive: [], internalOnly: false })
  })
})

describe('changeSizeBand — the band is the fact, never the raw churn', () => {
  it('bands every boundary of 10 / 50 / 250 / 1000', () => {
    expect(changeSizeBand(0)).toBe('xs')
    expect(changeSizeBand(9)).toBe('xs')
    expect(changeSizeBand(10)).toBe('s')
    expect(changeSizeBand(49)).toBe('s')
    expect(changeSizeBand(50)).toBe('m')
    expect(changeSizeBand(249)).toBe('m')
    expect(changeSizeBand(250)).toBe('l')
    expect(changeSizeBand(999)).toBe('l')
    expect(changeSizeBand(1000)).toBe('xl')
    expect(changeSizeBand(250_000)).toBe('xl')
  })

  it('only ever returns a declared band', () => {
    for (const total of [0, 9, 10, 49, 50, 249, 250, 999, 1000, 10_000]) {
      expect(CHANGE_SIZE_BANDS).toContain(changeSizeBand(total))
    }
  })
})

describe('areaCatalogFromRules — label→flags, carrying no path', () => {
  it('collapses repeated labels and lets a flag set anywhere win', () => {
    const catalog = areaCatalogFromRules([
      { prefix: 'a/', area: 'Tooling' },
      { prefix: 'b/', area: 'Tooling', internal: true },
      { prefix: 'c/', area: 'Billing', sensitive: true },
    ])
    expect(catalog).toEqual([
      { area: 'Tooling', internal: true },
      { area: 'Billing', sensitive: true },
    ])
    expect(JSON.stringify(catalog)).not.toContain('/')
  })

  it('is empty for an empty rule set', () => {
    expect(areaCatalogFromRules([])).toEqual([])
  })
})

describe('areaMapSchema', () => {
  it('defaults to an empty map and rejects a blank prefix or label', () => {
    expect(areaMapSchema.parse(undefined)).toEqual([])
    expect(areaMapSchema.safeParse([{ prefix: '', area: 'Billing' }]).success).toBe(false)
    expect(areaMapSchema.safeParse([{ prefix: 'a/', area: '' }]).success).toBe(false)
    expect(areaMapSchema.safeParse([{ prefix: 'a/', area: 'A', sensitive: true }]).success).toBe(
      true,
    )
  })

  // Reserved has to mean refused: an area an admin named `unmapped` would make "yapm could not place
  // this work" indistinguishable from "this work is in that area", and the reader could not tell.
  it('refuses the reserved label in any casing, with the message the editor shows', () => {
    for (const area of [UNMAPPED_AREA, 'Unmapped', ' UNMAPPED ']) {
      const parsed = areaMapSchema.safeParse([{ prefix: 'a/', area }])
      expect(parsed.success, area).toBe(false)
      expect(parsed.error?.issues[0]?.message).toBe(RESERVED_AREA_MESSAGE)
    }
    expect(areaMapSchema.safeParse([{ prefix: 'a/', area: 'Unmapped Work' }]).success).toBe(true)
  })
})
