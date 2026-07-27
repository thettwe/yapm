import { renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CorpusIssueRow, CorpusTeamRow } from './use-local-corpus'

const synced = vi.hoisted(() => ({ rows: {} as Record<string, readonly unknown[]> }))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (!request) return [undefined, { type: 'unknown' }]
    const name = (request as { query: { queryName: string } }).query.queryName
    return [synced.rows[name] ?? [], { type: 'complete' }]
  },
}))

import { useLocalSearchCorpus } from './use-local-corpus'

// The corpus the risk register names: "a few thousand issues", each carrying a description of the
// size people actually write. This is the case where walking every TipTap document on the keystroke
// would be real CPU — which is why the walk happens when rows are SEEN and the keystroke only
// scores already-extracted text.
const CORPUS_SIZE = 3_000
const TEAM: CorpusTeamRow = { id: 'team-1', name: 'Platform', key: 'ENG', updatedAt: 1 }

const WORDS =
  'the replica resync is the cost nobody wants so the publication stays untouched and the index expression carries the weighted vector while the plain text columns keep the type mapping trivial'.split(
    ' ',
  )

function description(seed: number): unknown {
  const paragraphs = Array.from({ length: 4 }, (_, p) => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: Array.from(
          { length: 30 },
          (_, w) => WORDS[(seed * 7 + p * 13 + w * 3) % WORDS.length],
        ).join(' '),
      },
    ],
  }))
  // One issue in the corpus carries the needle, and it is only in the description.
  if (seed === CORPUS_SIZE - 1) {
    paragraphs.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'qzt-needle lives only here' }],
    })
  }
  return { type: 'doc', content: paragraphs }
}

function corpus(size: number): CorpusIssueRow[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `issue-${index}`,
    teamId: 'team-1',
    number: index + 1,
    title: `Issue number ${index} about the ${WORDS[index % WORDS.length]} of things`,
    description: description(index),
    status: 'todo',
    needsTriage: false,
    updatedAt: 1_000 + index,
  }))
}

function measure(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

beforeEach(() => {
  synced.rows = {}
})

// Task 8.5. The numbers this prints are recorded in design.md's implementation log; the ceilings
// asserted here are the interaction budget (CLAUDE.md #9) with enough headroom that a slow CI box
// does not turn a real budget into a flaky one.
test('the on-device pass stays inside the interaction budget at a few thousand issues', () => {
  const rows = corpus(CORPUS_SIZE)
  synced.rows = { 'issues.byTeam': rows, 'teams.all': [TEAM] }

  let view: ReturnType<typeof renderHook<ReturnType<typeof useLocalSearchCorpus>, unknown>>
  const buildMs = measure(() => {
    view = renderHook(() => useLocalSearchCorpus('team-1'))
  })
  // biome-ignore lint/style/noNonNullAssertion: assigned by the measured callback above
  const search = () => view!.result.current.search
  expect(search()('qzt-needle')).toHaveLength(1)

  const firstKeystrokeMs = measure(() => {
    search()('qz')
  })

  const steady: number[] = []
  for (const query of ['qzt', 'qzt-', 'qzt-n', 'qzt-ne', 'qzt-nee', 'repl', 'replica', 'index']) {
    steady.push(measure(() => search()(query)))
  }
  const steadyMs = steady.reduce((a, b) => a + b, 0) / steady.length

  // One edited description must re-walk one document, not the corpus.
  const edited = rows.map((row, index) =>
    index === 0 ? { ...row, updatedAt: 99_999, title: `${row.title} edited` } : row,
  )
  const rebuildMs = measure(() => {
    synced.rows = { 'issues.byTeam': edited, 'teams.all': [TEAM] }
    // biome-ignore lint/style/noNonNullAssertion: assigned by the measured callback above
    view!.rerender()
  })

  console.log(
    `[task 8.5] corpus=${CORPUS_SIZE} build=${buildMs.toFixed(1)}ms ` +
      `firstKeystroke=${firstKeystrokeMs.toFixed(2)}ms steadyKeystroke=${steadyMs.toFixed(2)}ms ` +
      `rebuildAfterOneEdit=${rebuildMs.toFixed(1)}ms`,
  )

  expect(firstKeystrokeMs).toBeLessThan(100)
  expect(steadyMs).toBeLessThan(100)
  expect(rebuildMs).toBeLessThan(100)
})
