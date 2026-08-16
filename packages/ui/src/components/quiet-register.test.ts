import {
  classifyRestPhrase,
  type DeliverySignal,
  type DeliveryStrip,
  type DivergenceKind,
  type IssueStatus,
  REST_PHRASE_KEYS,
  type RestPhraseKey,
  restPhrase,
} from '@yapm/schema'
import { expect, test } from 'vitest'
import { buildRealityShape, isQuietTrack } from './reality-track'

// THE SEAM BETWEEN THE DICTIONARY AND THE DRAWING, and the two properties that make it safe to take
// a row's words away. Neither can be asserted in `packages/schema` — the drawing lives here and the
// schema package may not import UI (CLAUDE.md constraint 3) — and neither can be asserted over the
// component alone, because what is quieted is a decision the dictionary makes. So it lives in the
// package that can see both, over the dictionary imported from the one that owns it.

const HOUR = 60 * 60 * 1000

interface Case {
  readonly status: IssueStatus
  readonly signal: DeliverySignal | null
  readonly divergence: DivergenceKind | null
}

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

// One representative row per key — the real predicates a surface would hold, not a hand-built
// strip. `classifyRestPhrase` is asserted over the table below, so a fixture that stopped producing
// its key fails here rather than quietly testing a different row.
const CASES: Record<RestPhraseKey, Case> = {
  diverged_behind_merge: {
    status: 'in_progress',
    signal: signal({ pr: 'merged', ciHealth: 'passing' }),
    divergence: 'status_behind_merge',
  },
  diverged_ahead_of_pr: {
    status: 'in_review',
    signal: signal({ ciHealth: 'passing' }),
    divergence: 'status_ahead_of_pr',
  },
  diverged_done_ci_failing: {
    status: 'done',
    signal: signal({ pr: 'merged', ciHealth: 'failing' }),
    divergence: 'done_but_ci_failing',
  },
  checks_failing: {
    status: 'todo',
    signal: signal({ pr: 'open', ciHealth: 'failing' }),
    divergence: null,
  },
  merged_not_deployed: {
    status: 'done',
    signal: signal({ pr: 'merged', ciHealth: 'passing' }),
    divergence: null,
  },
  deployed: {
    status: 'done',
    signal: signal({ pr: 'merged', ciHealth: 'passing', deployedAt: 1_759_000_000_000 }),
    divergence: null,
  },
  pr_approved: {
    status: 'in_review',
    signal: signal({ pr: 'approved', ciHealth: 'passing' }),
    divergence: null,
  },
  pr_draft: {
    status: 'in_progress',
    signal: signal({ pr: 'draft', ciHealth: 'passing' }),
    divergence: null,
  },
  review_unreviewed: {
    status: 'in_progress',
    signal: signal({
      pr: 'open',
      ciHealth: 'passing',
      reviewAgeMs: 16 * HOUR,
      reviewAgeFrom: 'pr-open',
    }),
    divergence: null,
  },
  review_returned: {
    status: 'in_progress',
    signal: signal({
      pr: 'open',
      ciHealth: 'passing',
      reviewAgeMs: 16 * HOUR,
      reviewAgeFrom: 'review',
    }),
    divergence: null,
  },
  in_review: { status: 'in_review', signal: null, divergence: null },
  in_progress: { status: 'in_progress', signal: null, divergence: null },
  not_started: { status: 'todo', signal: null, divergence: null },
  in_backlog: { status: 'backlog', signal: null, divergence: null },
}

function stripFor(key: RestPhraseKey): DeliveryStrip | null {
  const { signal: value } = CASES[key]
  if (value === null) return null
  return {
    pr: value.pr,
    ci: value.ciHealth,
    reviewAgeMs: value.reviewAgeMs,
    reviewAgeFrom: value.reviewAgeFrom,
    deployedAt: value.deployedAt,
  }
}

function shapeFor(key: RestPhraseKey) {
  return buildRealityShape(stripFor(key), { divergence: CASES[key].divergence })
}

function voicingOf(key: RestPhraseKey): 'drawn' | 'quiet' | 'silent' {
  const phrase = restPhrase(key, 'news', { reviewAgeMs: 16 * HOUR })
  if (phrase.text !== null) return 'drawn'
  return phrase.spoken === null ? 'silent' : 'quiet'
}

test('every representative row classifies to the key it stands for', () => {
  for (const key of REST_PHRASE_KEYS) {
    const { status, signal: value, divergence } = CASES[key]
    expect(classifyRestPhrase(status, value, divergence)).toBe(key)
  }
})

// THE GATE. Visual silence must not become total silence: a row whose phrase went quiet has to have
// a track carrying ink, because the quiet track is `aria-hidden` and states nothing to anybody. If
// this ever fails, a row has gone silent in both channels at once.
test('no key is quiet in the words and inkless in the drawing', () => {
  const quiet = REST_PHRASE_KEYS.filter((key) => voicingOf(key) === 'quiet')
  expect(quiet.length).toBeGreaterThan(0)

  for (const key of quiet) {
    expect(`${key}: ${isQuietTrack(shapeFor(key))}`).toBe(`${key}: false`)
  }
})

// A key may only be quieted where the drawing tells it apart from every other key the register
// quiets or silences — otherwise quieting it erases a distinction rather than removing a
// repetition. `pr_approved` versus `merged_not_deployed` is the pair this was written for: before
// the change station stopped drawing an approved PR as landed, the two drew an identical track.
test('the quiet keys are told apart from every quiet or silent key by their stations alone', () => {
  const carried = REST_PHRASE_KEYS.filter((key) => voicingOf(key) !== 'drawn')
  const stations = (key: RestPhraseKey) =>
    shapeFor(key)
      .stations.map((station) => station.node)
      .join('·')

  for (const key of carried.filter((candidate) => voicingOf(candidate) === 'quiet')) {
    for (const other of carried) {
      if (other === key) continue
      expect(`${key} vs ${other}: ${stations(key) === stations(other)}`).toBe(
        `${key} vs ${other}: false`,
      )
    }
  }
})
