import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DeliverySignal } from './delivery.js'
import {
  classifyRestPhrase,
  type PhraseRegister,
  REST_PHRASE_KEYS,
  type RestPhraseKey,
  restPhrase,
  sayRestPhrase,
} from './phrases.js'

const REGISTERS: readonly PhraseRegister[] = ['neutral', 'personal', 'news']

const HOUR = 60 * 60 * 1000

function signal(overrides: Partial<DeliverySignal> = {}): DeliverySignal {
  return {
    pr: null,
    pullRequestId: null,
    ciHealth: null,
    reviewAgeMs: null,
    reviewAgeFrom: null,
    deployedAt: null,
    ...overrides,
  }
}

describe('the registers are total over the key set', () => {
  it('every register resolves every key — as text or explicitly as silence', () => {
    for (const register of REGISTERS) {
      for (const key of REST_PHRASE_KEYS) {
        const phrase = restPhrase(key, register, { reviewAgeMs: HOUR })
        expect(phrase.key).toBe(key)
        expect(phrase.text === null || phrase.text.length > 0).toBe(true)
      }
    }
  })

  it('no register holds a key another lacks', () => {
    // Reaching the tables through the only public door: a key one register knew and another did
    // not would throw or resolve `undefined` here rather than silently falling back.
    const resolved = REGISTERS.map(
      (register) =>
        new Set(REST_PHRASE_KEYS.filter((key) => restPhrase(key, register).text !== undefined)),
    )
    for (const set of resolved) {
      expect([...set].sort()).toEqual([...(resolved[0] ?? [])].sort())
    }
    expect(new Set(REST_PHRASE_KEYS).size).toBe(REST_PHRASE_KEYS.length)
  })

  it('the neutral register is silent exactly where the mock leaves the row blank', () => {
    const silent = REST_PHRASE_KEYS.filter((key) => restPhrase(key, 'neutral').text === null)
    expect(silent.sort()).toEqual(
      ['deployed', 'in_backlog', 'in_progress', 'in_review', 'not_started'].sort(),
    )
  })

  // The sibling of the assertion above, over the register that has three answers rather than two.
  // Pinned as three SETS, not as one "not drawn" list: a key drifting from quiet to silent loses
  // its words entirely, and that has to fail rather than pass as "still not drawn".
  it('the news register draws the exceptions, quiets what the track draws, and stays silent where neutral is', () => {
    const voicing = (key: RestPhraseKey) => {
      const phrase = restPhrase(key, 'news', { reviewAgeMs: 16 * HOUR })
      if (phrase.text !== null) return 'drawn'
      return phrase.spoken === null ? 'silent' : 'quiet'
    }
    const keysWhere = (state: string) => REST_PHRASE_KEYS.filter((key) => voicing(key) === state)

    expect(keysWhere('drawn').sort()).toEqual(
      [
        'diverged_behind_merge',
        'diverged_ahead_of_pr',
        'diverged_done_ci_failing',
        'checks_failing',
        // The one key admitted on the second ground: the track draws `rev-wait` for every open PR
        // and the age column names no clock, so nothing drawn says whether anybody has looked.
        'review_returned',
      ].sort(),
    )
    expect(keysWhere('quiet').sort()).toEqual(
      ['merged_not_deployed', 'pr_approved', 'pr_draft', 'review_unreviewed'].sort(),
    )
    expect(keysWhere('silent').sort()).toEqual(
      ['deployed', 'in_backlog', 'in_progress', 'in_review', 'not_started'].sort(),
    )
  })

  // The invariant `RestPhrase` states about itself, over every register and every key.
  it('a drawn entry speaks what it draws, a quiet one keeps its words, a silent one has none', () => {
    for (const register of REGISTERS) {
      for (const key of REST_PHRASE_KEYS) {
        const phrase = restPhrase(key, register, { reviewAgeMs: 16 * HOUR })
        if (phrase.text === null) expect(phrase.spoken !== '').toBe(true)
        else expect(phrase.spoken).toBe(phrase.text)
      }
    }
  })

  // `news` is a POLICY over `neutral`, not a second voice: it adds, rewrites and deletes no string.
  // The one-file guard below runs on the same eight strings for exactly this reason.
  it('news speaks neutral’s words and none of its own', () => {
    for (const key of REST_PHRASE_KEYS) {
      expect(restPhrase(key, 'news', { reviewAgeMs: 16 * HOUR }).spoken).toBe(
        restPhrase(key, 'neutral', { reviewAgeMs: 16 * HOUR }).text,
      )
    }
  })

  // A mark follows the text it sourced. `merged_not_deployed` is one of the three sourced keys, so
  // going quiet takes its GitHub mark off the list with it — no text for a mark to follow, and a
  // mark standing alone would be a provenance claim about nothing.
  it('a quiet phrase carries no provenance mark', () => {
    const quiet = restPhrase('merged_not_deployed', 'news')
    expect(quiet.text).toBeNull()
    expect(quiet.spoken).toBe('Built — not live yet')
    expect(quiet.source).toBeNull()
    // The same key still marks the register that draws it.
    expect(restPhrase('merged_not_deployed', 'neutral').source).toBe('github')
  })
})

describe('the mock four, in the neutral register', () => {
  it('states the four strings issues.html draws', () => {
    expect(restPhrase('checks_failing', 'neutral').text).toBe('Checks failing')
    expect(restPhrase('diverged_behind_merge', 'neutral').text).toBe(
      'Done in git, not on the board',
    )
    expect(restPhrase('merged_not_deployed', 'neutral').text).toBe('Built — not live yet')
    expect(restPhrase('review_unreviewed', 'neutral', { reviewAgeMs: 16 * HOUR }).text).toBe(
      'In review — waiting 16h',
    )
  })
})

describe("the personal register reproduces team home's rendered strings", () => {
  it.each([
    ['diverged_behind_merge', 'Done in git — update the board'],
    ['checks_failing', 'Checks failing — the fix is yours'],
    ['pr_approved', 'Approved — merge when ready'],
    ['pr_draft', 'Draft open — not in review yet'],
    ['in_review', 'In review'],
    ['in_progress', 'In progress'],
    ['not_started', 'Not started'],
    ['in_backlog', 'In the backlog'],
  ] as const satisfies readonly (readonly [RestPhraseKey, string])[])('%s', (key, text) => {
    expect(restPhrase(key, 'personal').text).toBe(text)
  })
})

describe('provenance rides on the entry', () => {
  it('marks exactly the check facts and the deploy fact', () => {
    const sourced = REST_PHRASE_KEYS.filter(
      (key) => restPhrase(key, 'neutral', { reviewAgeMs: HOUR }).source === 'github',
    )
    expect(sourced.sort()).toEqual(
      ['checks_failing', 'diverged_done_ci_failing', 'merged_not_deployed'].sort(),
    )
  })

  it('gives the same answer in both registers', () => {
    for (const key of REST_PHRASE_KEYS) {
      const neutral = restPhrase(key, 'neutral', { reviewAgeMs: HOUR })
      const personal = restPhrase(key, 'personal', { reviewAgeMs: HOUR })
      // A silent entry carries no mark because there is no text for a mark to follow.
      if (neutral.text !== null) expect(neutral.source).toBe(personal.source)
      expect(neutral.urgent).toBe(personal.urgent)
    }
  })

  it('says nothing and marks nothing when the register is silent', () => {
    const deployed = restPhrase('deployed', 'neutral')
    expect(deployed.text).toBeNull()
    expect(deployed.source).toBeNull()
  })
})

describe('classifyRestPhrase reads only the real predicates', () => {
  it('puts divergence above every git fact', () => {
    expect(classifyRestPhrase('in_progress', signal({ pr: 'merged' }), 'status_behind_merge')).toBe(
      'diverged_behind_merge',
    )
    expect(
      classifyRestPhrase(
        'in_progress',
        signal({ pr: 'merged', ciHealth: 'failing' }),
        'status_behind_merge',
      ),
    ).toBe('diverged_behind_merge')
    expect(classifyRestPhrase('done', signal({ ciHealth: 'failing' }), 'done_but_ci_failing')).toBe(
      'diverged_done_ci_failing',
    )
  })

  it('puts failing checks above the deploy axis and the review axis', () => {
    expect(classifyRestPhrase('todo', signal({ pr: 'open', ciHealth: 'failing' }), null)).toBe(
      'checks_failing',
    )
  })

  it('separates a merge that shipped from one that did not', () => {
    expect(classifyRestPhrase('done', signal({ pr: 'merged' }), null)).toBe('merged_not_deployed')
    expect(classifyRestPhrase('done', signal({ pr: 'merged', deployedAt: 1 }), null)).toBe(
      'deployed',
    )
  })

  it('prefers the draft fact to the in-review divergence that describes it', () => {
    expect(classifyRestPhrase('in_review', signal({ pr: 'draft' }), 'status_ahead_of_pr')).toBe(
      'pr_draft',
    )
    expect(
      classifyRestPhrase('in_review', signal({ ciHealth: 'passing' }), 'status_ahead_of_pr'),
    ).toBe('diverged_ahead_of_pr')
  })

  it('splits the review keys by which clock the age names', () => {
    expect(
      classifyRestPhrase(
        'in_progress',
        signal({ pr: 'open', reviewAgeMs: 16 * HOUR, reviewAgeFrom: 'pr-open' }),
        null,
      ),
    ).toBe('review_unreviewed')
    expect(
      classifyRestPhrase(
        'in_progress',
        signal({ pr: 'open', reviewAgeMs: 2 * HOUR, reviewAgeFrom: 'review' }),
        null,
      ),
    ).toBe('review_returned')
  })

  it('never claims a reviewer waited when nobody has reviewed', () => {
    const unreviewed = sayRestPhrase(
      'in_progress',
      signal({ pr: 'open', reviewAgeMs: 16 * HOUR, reviewAgeFrom: 'pr-open' }),
      null,
      'neutral',
    )
    const returned = sayRestPhrase(
      'in_progress',
      signal({ pr: 'open', reviewAgeMs: 16 * HOUR, reviewAgeFrom: 'review' }),
      null,
      'neutral',
    )
    expect(unreviewed.text).toBe('In review — waiting 16h')
    expect(returned.text).toBe('In review — reviewed 16h ago')
  })

  // The one clause in the dictionary that ends in " ago", over the one age `formatReviewAge`
  // answers as a word rather than a number.
  it('says "just now" for a review under a minute rather than "now ago"', () => {
    const returned = restPhrase('review_returned', 'neutral', { reviewAgeMs: 20_000 })
    expect(returned.text).toBe('In review — reviewed just now')
    expect(returned.text).not.toMatch(/now ago/)
    // A minute later it is a measured age again.
    expect(restPhrase('review_returned', 'neutral', { reviewAgeMs: 90_000 }).text).toBe(
      'In review — reviewed 1m ago',
    )
  })

  it('falls back to the human status when git has nothing to say', () => {
    expect(classifyRestPhrase('in_progress', null, null)).toBe('in_progress')
    expect(classifyRestPhrase('todo', null, null)).toBe('not_started')
    expect(classifyRestPhrase('backlog', null, null)).toBe('in_backlog')
    expect(classifyRestPhrase('in_review', null, null)).toBe('in_review')
  })

  it("makes merged_not_deployed unreachable in team home's YOURS", () => {
    // YOURS lists unfinished issues only, and an unfinished issue with a merged PR always
    // classifies as the divergence first — which is why extending the classifier could not have
    // changed a string Home already rendered.
    for (const status of ['backlog', 'todo', 'in_progress', 'in_review'] as const) {
      const merged = signal({ pr: 'merged' })
      const divergence = 'status_behind_merge'
      expect(classifyRestPhrase(status, merged, divergence)).toBe('diverged_behind_merge')
    }
  })
})

describe('the dictionary lives in exactly one file', () => {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  // Whole entries, not fragments: "Checks failing on 3 issues" is the attention band counting a
  // class, not this dictionary speaking, and a guard that could not tell them apart would be
  // failing on the wrong thing.
  const DICTIONARY_STRINGS = [
    'Checks failing — the fix is yours',
    'Done in git, not on the board',
    'Built — not live yet',
    'In review — waiting ',
    'In review — reviewed ',
    'Done in git — update the board',
    'Approved — merge when ready',
    'Draft open — not in review yet',
  ]

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
          continue
        }
        sources(path, found)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      // Tests and stories may quote the dictionary — that is what asserting it looks like. Only
      // a second PRODUCTION table is the failure this guards.
      if (/\.(test|spec|stories)\.tsx?$/.test(entry.name)) continue
      found.push(path)
    }
    return found
  }

  it('no second production module declares the same strings', () => {
    const roots = ['packages/schema/src', 'packages/ui/src', 'apps/web/src', 'apps/server/src']
    const offenders = roots
      .flatMap((root) => sources(join(repoRoot, root)))
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        return DICTIONARY_STRINGS.some((phrase) => text.includes(phrase))
      })
      .map((path) => path.slice(repoRoot.length))

    expect(offenders).toEqual(['packages/schema/src/zero/phrases.ts'])
  })
})
