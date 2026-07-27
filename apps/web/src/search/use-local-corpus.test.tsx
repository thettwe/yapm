import { renderHook } from '@testing-library/react'
import { matchesSearchText } from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CorpusIssueRow, CorpusNamedRow, CorpusTeamRow } from './use-local-corpus'

const synced = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  seen: [] as string[],
}))

// Dispatches on the query's registered name, which is what a `QueryRequest` carries
// (`{ query: { queryName }, args }`), so the test asserts against the real subscription set rather
// than against call order.
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    synced.seen.push(name)
    return [synced.rows[name] ?? [], { type: 'complete' }]
  },
}))

import { useLocalSearchCorpus } from './use-local-corpus'

const TEAM: CorpusTeamRow = { id: 'team-1', name: 'Platform', key: 'ENG', updatedAt: 10 }

function doc(text: string): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function issue(overrides: Partial<CorpusIssueRow> & { id: string }): CorpusIssueRow {
  return {
    teamId: 'team-1',
    number: 1,
    title: 'A title',
    description: undefined,
    status: 'todo',
    needsTriage: false,
    updatedAt: 100,
    ...overrides,
  }
}

beforeEach(() => {
  synced.rows = {}
  synced.seen = []
})

function corpus(teamId?: string) {
  return renderHook(() => useLocalSearchCorpus(teamId)).result
}

test('subscribes to the team-scoped set only when a team is in context', () => {
  corpus()
  expect(synced.seen).toEqual(['issues.mine', 'projects.all', 'teams.all'])

  synced.seen = []
  corpus('team-1')
  expect([...synced.seen].sort()).toEqual([
    'cycles.byTeam',
    'issues.byTeam',
    'issues.mine',
    'labels.byTeam',
    'projects.all',
    'teams.all',
    'triage.inbox',
  ])
})

// `issues.byTeam` filters `needsTriage` out and `triage.inbox` is where those rows live, so the two
// subscriptions are BOTH required and they overlap by construction — an issue assigned to the
// caller appears in `issues.mine` as well.
test('an issue reachable through two synced queries appears once', () => {
  const row = issue({ id: 'issue-1', title: 'Replica resync' })
  synced.rows = {
    'issues.byTeam': [row],
    'issues.mine': [row],
    'teams.all': [TEAM],
  }

  const hits = corpus('team-1').current.search('replica')
  expect(hits).toHaveLength(1)
  expect(hits[0]?.entry.id).toBe('issue-1')
  expect(hits[0]?.entry.issueKey).toBe('ENG-1')
})

// The half of the falsifiable check the on-device pass owns: `matchesText` matches title and issue
// key only, so a token that lives only in a description already misses today.
test('finds a description-only token that the list filter misses', () => {
  const row = issue({
    id: 'issue-2',
    number: 7,
    title: 'Nothing to see here',
    description: doc('the qzt-alpha token lives only in this description'),
  })
  synced.rows = { 'issues.byTeam': [row], 'teams.all': [TEAM] }

  expect(
    matchesSearchText({ title: row.title, number: row.number, teamKey: 'ENG' }, 'qzt-alpha'),
  ).toBe(false)

  const hits = corpus('team-1').current.search('qzt-alpha')
  expect(hits).toHaveLength(1)
  expect(hits[0]?.entry.id).toBe('issue-2')
  expect(hits[0]?.tier).toBe('body-substring')
})

test('a mention in a description is findable by the mentioned name', () => {
  const row = issue({
    id: 'issue-3',
    title: 'Nothing to see here',
    description: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'user-1', label: 'Lovisa Berg' } }],
        },
      ],
    },
  })
  synced.rows = { 'issues.byTeam': [row], 'teams.all': [TEAM] }

  expect(corpus('team-1').current.search('@lov')).toHaveLength(1)
  expect(corpus('team-1').current.search('lovisa')).toHaveLength(1)
})

test('carries the display values a result row needs, including the two state labels', () => {
  synced.rows = {
    'issues.byTeam': [issue({ id: 'a', number: 5, title: 'Cancelled work', status: 'canceled' })],
    'triage.inbox': [
      issue({ id: 'b', number: 6, title: 'Cancelled inbound', needsTriage: true, updatedAt: 200 }),
    ],
    'teams.all': [TEAM],
  }

  const hits = corpus('team-1').current.search('cancelled')
  expect(hits.map((hit) => hit.entry.id)).toEqual(['b', 'a'])
  expect(hits[0]?.entry.needsTriage).toBe(true)
  expect(hits[1]?.entry.status).toBe('canceled')
  expect(hits[1]?.entry.issueKey).toBe('ENG-5')
})

test('projects, cycles, labels and teams are searchable by name', () => {
  const named: CorpusNamedRow[] = [{ id: 'p-1', name: 'Quiet migration', updatedAt: 1 }]
  synced.rows = {
    'projects.all': named,
    'cycles.byTeam': [{ id: 'c-1', name: 'Quiet cycle', updatedAt: 2 }],
    'labels.byTeam': [{ id: 'l-1', name: 'quiet', updatedAt: 3 }],
    'teams.all': [TEAM, { id: 'team-2', name: 'Quiet team', key: 'QT', updatedAt: 4 }],
  }

  const kinds = corpus('team-1')
    .current.search('quiet')
    .map((hit) => hit.entry.kind)
  expect([...kinds].sort()).toEqual(['cycle', 'label', 'project', 'team'])
})

test('the same query twice produces the same order', () => {
  synced.rows = {
    'issues.byTeam': [
      issue({ id: 'a', number: 1, title: 'alpha match', updatedAt: 5 }),
      issue({ id: 'b', number: 2, title: 'match beta', updatedAt: 9 }),
      issue({ id: 'c', number: 3, title: 'match gamma', updatedAt: 9 }),
    ],
    'teams.all': [TEAM],
  }
  const { current } = corpus('team-1')

  const first = current.search('match').map((hit) => hit.entry.id)
  const second = current.search('match').map((hit) => hit.entry.id)
  expect(first).toEqual(second)
  // Prefix beats substring; the two prefix hits tie on `updatedAt` and fall back to declaration
  // order, which is what makes a stable source order a correctness property rather than a detail.
  expect(first).toEqual(['b', 'c', 'a'])
})

// The cache is keyed by id and invalidated by `updatedAt`, and it is filled as rows are SEEN — in
// the corpus memo — so the keystroke path walks nothing at all.
test('the plaintext cache re-walks only the document that changed', () => {
  const walked: string[] = []
  const trackedDoc = (id: string, text: string) => ({
    type: 'doc',
    get content() {
      walked.push(id)
      return [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    },
  })
  const rowsFor = (updatedAt: number, text: string) => ({
    'issues.byTeam': [
      issue({ id: 'a', title: 'issue a', updatedAt: 1, description: trackedDoc('a', 'alpha') }),
      issue({ id: 'b', title: 'issue b', updatedAt, description: trackedDoc('b', text) }),
    ],
    'teams.all': [TEAM],
  })

  synced.rows = rowsFor(1, 'bravo')
  const view = renderHook(() => useLocalSearchCorpus('team-1'))
  expect(new Set(walked)).toEqual(new Set(['a', 'b']))

  walked.length = 0
  synced.rows = rowsFor(2, 'bravo edited')
  view.rerender()
  expect(new Set(walked)).toEqual(new Set(['b']))
  expect(view.result.current.search('edited')).toHaveLength(1)
})
