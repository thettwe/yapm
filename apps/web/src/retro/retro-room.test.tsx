import { render, screen, within } from '@testing-library/react'
import {
  CYCLES_BY_TEAM_QUERY_NAME,
  ISSUES_BY_TEAM_QUERY_NAME,
  RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME,
  RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME,
  RETRO_AI_REACTIONS_MINE_QUERY_NAME,
  RETRO_DETAIL_QUERY_NAME,
  RETRO_DRAFTS_MINE_QUERY_NAME,
  RETRO_VOTES_MINE_QUERY_NAME,
  type RetroPhase,
  TEAMS_ALL_QUERY_NAME,
  USERS_ALL_QUERY_NAME,
} from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'

// The room, rendered. Everything asserted here fails on the surface this change replaces, and each
// assertion is about a fact rather than a look: the anonymity guarantee is true because
// `retro_card_author` is a server-only table; a quiet vote slot draws no ink because
// `reality-vocabulary` says a slot with no fact draws none; the budget is drawn AND read because
// neither channel may carry it alone.

const harness = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, canWrite: true }))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [name in harness.rows ? harness.rows[name] : [], { type: 'complete' }]
  },
  // The presence heartbeat fires on mount, so the stub has to hand back a real `MutatorResult`
  // shape rather than a bare promise.
  useZero: () => ({
    mutate: () => ({
      client: Promise.resolve({ type: 'success' }),
      server: Promise.resolve({ type: 'success' }),
    }),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
  Link: ({ children }: { children?: unknown }) => children,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    canWrite: harness.canWrite,
    canManage: harness.canWrite,
    role: harness.canWrite ? 'admin' : 'viewer',
  }),
}))

import { RetroView } from '@/retro/retro-view'

const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering', aiRetroDraftSince: null, members: [] }
const CYCLE = {
  id: 'cycle-1',
  number: 1,
  name: 'Cycle 1',
  status: 'completed',
  startDate: 0,
  endDate: 1,
}

const COLUMNS = [
  { id: 'col-1', key: 'went_well', title: 'Went well', accentToken: 'positive', rank: 'a0' },
  {
    id: 'col-2',
    key: 'didnt_go_well',
    title: "Didn't go well",
    accentToken: 'negative',
    rank: 'a1',
  },
]

interface CardSeed {
  readonly id: string
  readonly body: string
  readonly columnId?: string
}

function card({ id, body, columnId = 'col-1' }: CardSeed) {
  return {
    id,
    columnId,
    groupId: null,
    body,
    rank: id,
    isAnonymous: true,
    authorDisplayId: null,
    seedRef: null,
    createdAt: 1,
  }
}

interface RoomOptions {
  readonly phase?: RetroPhase
  readonly isAnonymous?: boolean
  readonly cards?: readonly ReturnType<typeof card>[]
  readonly tallies?: readonly { targetId: string; count: number }[]
  readonly votes?: readonly {
    id: string
    targetType: string
    targetId: string
    createdAt: number
  }[]
  readonly actions?: readonly unknown[]
  readonly groups?: readonly unknown[]
  readonly ai?: boolean
}

const CITED_ISSUE = {
  id: 'issue-1',
  number: 12,
  title: 'Fix the reconnect loop',
  status: 'done',
  issueLinks: [],
}

function rows(options: RoomOptions = {}) {
  const phase = options.phase ?? 'vote'
  const ai = options.ai === true
  harness.rows = {
    [TEAMS_ALL_QUERY_NAME]: [{ ...TEAM, aiRetroDraftSince: ai ? 1 : null }],
    [USERS_ALL_QUERY_NAME]: [],
    [CYCLES_BY_TEAM_QUERY_NAME]: [CYCLE],
    [ISSUES_BY_TEAM_QUERY_NAME]: ai ? [CITED_ISSUE] : [],
    [RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME]: ai ? { status: 'ready', createdAt: 1 } : undefined,
    [RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME]: ai
      ? [
          {
            id: 'proposal-1',
            category: 'win',
            summary: 'Work merged faster once reviews started sooner.',
            confidence: 'high',
            refs: [{ kind: 'issue', id: 'issue-1' }],
            rank: 0,
          },
        ]
      : [],
    [RETRO_AI_REACTIONS_MINE_QUERY_NAME]: [],
    [RETRO_DRAFTS_MINE_QUERY_NAME]: [],
    [RETRO_VOTES_MINE_QUERY_NAME]: options.votes ?? [],
    [RETRO_DETAIL_QUERY_NAME]: {
      id: 'retro-1',
      teamId: 'team-1',
      cycleId: 'cycle-1',
      nextCycleId: null,
      title: 'Cycle 1 retro',
      format: 'wentwell_didnt_action',
      phase,
      facilitatorId: 'user-1',
      isAnonymous: options.isAnonymous ?? true,
      votesPerParticipant: 5,
      timerEndsAt: null,
      timerDurationS: null,
      closedAt: null,
      createdAt: 1,
      columns: COLUMNS,
      cards: options.cards ?? [],
      groups: options.groups ?? [],
      voteTallies: options.tallies ?? [],
      actions: options.actions ?? [],
      presence: [],
    },
  }
}

function room(options: RoomOptions = {}) {
  rows(options)
  return render(<RetroView teamId="team-1" retroId="retro-1" />)
}

const VOTED = card({ id: 'card-voted', body: 'Shipping every day felt calm.' })
const QUIET = card({ id: 'card-quiet', body: 'We cut refund scope early instead of late.' })
const TWO_CARDS = [VOTED, QUIET]
const TALLY_OF_TWO = [{ targetId: 'card-voted', count: 2 }]
const RECORDED_ACTION = {
  id: 'action-1',
  body: 'Rotate a review buddy each cycle',
  assigneeId: null,
  targetCycleId: null,
  issueId: null,
  groupId: null,
  cardId: null,
  createdAt: 1,
  issue: null,
}
const THREE_SPENT = [
  { id: 'v1', targetType: 'card', targetId: 'card-voted', createdAt: 1 },
  { id: 'v2', targetType: 'card', targetId: 'card-voted', createdAt: 2 },
  { id: 'v3', targetType: 'card', targetId: 'card-voted', createdAt: 3 },
]

beforeEach(() => {
  harness.rows = {}
  harness.canWrite = true
  // The board reads the reduced-motion preference at render; jsdom ships no `matchMedia`.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})

// (1) The guarantee is on the surface, in the words that are true of the schema.
test('an anonymous retro states the guarantee, in the sentence the storage makes true', () => {
  room({ cards: TWO_CARDS, tallies: TALLY_OF_TWO })
  expect(
    screen.getByText('cards are anonymous by design — there is no author column'),
  ).toBeInTheDocument()
})

// (2) A quiet row draws no reality ink — the shipped `reality-vocabulary` requirement.
test('a card with no dots renders no count, no pip and no retract control', () => {
  room({ cards: TWO_CARDS, tallies: TALLY_OF_TWO })

  const cards = screen.getAllByTestId('retro-card')
  const quiet = cards.find((node) => node.textContent?.includes('refund scope'))
  const voted = cards.find((node) => node.textContent?.includes('felt calm'))
  expect(quiet).toBeDefined()
  expect(voted).toBeDefined()

  expect(within(quiet as HTMLElement).queryByTestId('retro-vote-pips')).toBeNull()
  expect(within(quiet as HTMLElement).queryByTestId('retro-retract-vote')).toBeNull()
  // The way IN survives at zero: it is how the first dot is cast.
  expect(within(quiet as HTMLElement).getByTestId('retro-cast-vote')).toBeInTheDocument()

  // …and the card that does carry a tally still states it as a number.
  const pips = within(voted as HTMLElement).getByTestId('retro-vote-pips')
  expect(pips.textContent).toBe('2')
})

// (3) The budget is drawn AND read; neither channel carries it alone.
test('the vote budget renders spent and unspent dots beside its reading', () => {
  room({ cards: TWO_CARDS, tallies: TALLY_OF_TWO, votes: THREE_SPENT })

  const budget = screen.getByTestId('retro-vote-budget')
  expect(budget.textContent).toBe('2/5 dots left')
  // Five dots, two of them unspent — the drawn half of the same fact.
  expect(budget.querySelectorAll('span[class*="rounded-full"]')).toHaveLength(5)
})

test('an attributed retro states the opposite truth and never claims anonymity', () => {
  room({ isAnonymous: false, cards: TWO_CARDS })
  expect(screen.getByText('cards carry their author')).toBeInTheDocument()
  expect(screen.queryByText('cards are anonymous by design — there is no author column')).toBeNull()
})

test('the stepper draws six phases, names the current one and claims no duration', () => {
  room({ cards: TWO_CARDS })
  const steps = screen.getAllByTestId('retro-phase-step')
  expect(steps).toHaveLength(6)
  const now = steps.find((step) => step.dataset.phase === 'vote')
  expect(now?.getAttribute('aria-current')).toBe('step')
  expect(now?.textContent).toBe('Votenow')
  // No spent phase carries an elapsed reading, because none is stored.
  for (const step of steps) expect(step.textContent).not.toMatch(/\d+\s?(min|m|s)\b/)
})

test('band 2 states the retro and its cycle, with no team name and no resting format pill', () => {
  room({ cards: TWO_CARDS })
  const masthead = screen.getByTestId('masthead')
  expect(masthead.textContent).toContain('Retro')
  expect(masthead.textContent).toContain('Cycle 1')
  expect(masthead.textContent).not.toContain('Engineering')
  expect(masthead.textContent).not.toContain('Went well / Didn’t / Actions')
})

// Stepping back out of `discuss` must not hide what the room already recorded.
test('a retro at vote that already holds an action lists it read-only', () => {
  room({ cards: TWO_CARDS, actions: [RECORDED_ACTION] })
  expect(screen.getByTestId('retro-action')).toBeInTheDocument()
  expect(screen.queryByTestId('retro-new-action')).toBeNull()
  expect(screen.getByText('read-only · actions reopen at Discuss')).toBeInTheDocument()
})

// The note is a PHASE fact. At `closed` actions never reopen and converting one is still live, so
// the word "read-only" beside a live Convert would be the falsehood.
test('a closed retro says it is closed, not that actions reopen, and still offers Convert', () => {
  room({ phase: 'closed', cards: TWO_CARDS, actions: [RECORDED_ACTION] })
  const list = screen.getByRole('region', { name: 'Action items' })
  expect(within(list).getByText('this retro is closed')).toBeInTheDocument()
  expect(within(list).queryByText(/read-only/)).toBeNull()
  expect(within(list).queryByText(/reopen/)).toBeNull()
  expect(screen.getByTestId('retro-convert-action')).toBeInTheDocument()
})

// A viewer's ceiling is a role fact; pointing them at a phase that would not help them is not.
test('a viewer reading a retro is told nothing about when the action write reopens', () => {
  harness.canWrite = false
  room({ phase: 'discuss', cards: TWO_CARDS, actions: [RECORDED_ACTION] })
  const list = screen.getByRole('region', { name: 'Action items' })
  expect(within(list).getByTestId('retro-action')).toBeInTheDocument()
  expect(within(list).queryByText(/read-only/)).toBeNull()
  expect(screen.queryByTestId('retro-new-action')).toBeNull()
})

test('a retro at vote with no actions draws no action list at all', () => {
  room({ cards: TWO_CARDS })
  expect(screen.queryByRole('region', { name: 'Action items' })).toBeNull()
  expect(screen.queryByTestId('retro-action')).toBeNull()
})

test('the seed door is open while a card can be seeded from it and a door afterwards', () => {
  room({ phase: 'brainstorm' })
  expect(screen.getByTestId('retro-seed-toggle')).toHaveAttribute('aria-expanded', 'true')

  room({ phase: 'vote', cards: TWO_CARDS })
  const door = screen.getAllByTestId('retro-seed-toggle').at(-1)
  expect(door).toHaveAttribute('aria-expanded', 'false')
  // The door names what is behind it, so opening it is one keystroke rather than a guess.
  expect(door?.textContent).toContain('Cycle 1 data')
})

// The facilitator's advance reaches every client already in the room, so the door has to be derived
// at every render rather than read once at mount — the SAME tree, one phase later.
test('the seed panel becomes a door for a client that was already in the room', () => {
  const view = room({ phase: 'brainstorm' })
  expect(screen.getByTestId('retro-seed-toggle')).toHaveAttribute('aria-expanded', 'true')

  rows({ phase: 'group', cards: TWO_CARDS })
  view.rerender(<RetroView teamId="team-1" retroId="retro-1" />)
  expect(screen.getByTestId('retro-seed-toggle')).toHaveAttribute('aria-expanded', 'false')
})

// The door is a phase fact, not a role one: a viewer reads brainstorm's panel like everyone else,
// and the sentence about the seed path having closed only appears once the phase has closed it.
test('a viewer reads the seed panel open during brainstorm and is told no phase falsehood', () => {
  harness.canWrite = false
  room({ phase: 'brainstorm' })
  expect(screen.getByTestId('retro-seed-toggle')).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByText('seeding a card closed with brainstorm')).toBeNull()
})

// The arrival state of every retro: no cards anywhere, and nothing reserving a measure it cannot
// fill. The triage build shipped a panel that reserved its full measure over an empty issue.
test('a retro with no cards at all draws no vote ink and no empty card frames', () => {
  room({ cards: [] })
  expect(screen.queryAllByTestId('retro-card')).toHaveLength(0)
  expect(screen.queryAllByTestId('retro-vote-pips')).toHaveLength(0)
  expect(screen.getAllByText('No cards')).toHaveLength(COLUMNS.length)
})

// The stacking IS the argument, not a layout preference: the team's own cards are read before the
// seeded figures and both before the model's draft. It is also what the e2e tab walk across the
// absent-AI seam now depends on, and document order is the only place that is checkable without a
// browser.
test('the room reads cards, then the seeded figures, then the AI draft, then the actions', () => {
  room({ cards: TWO_CARDS, ai: true, actions: [RECORDED_ACTION] })

  const order = [
    screen.getAllByTestId('retro-card')[0],
    screen.getByTestId('retro-seed-toggle'),
    screen.getByTestId('retro-ai-panel'),
    screen.getByTestId('retro-action'),
  ]
  for (const node of order) expect(node).toBeInTheDocument()
  for (let i = 0; i < order.length - 1; i += 1) {
    const before = order[i] as HTMLElement
    const after = order[i + 1] as HTMLElement
    expect(
      before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${before.dataset.testid ?? 'card'} precedes ${after.dataset.testid}`,
    ).toBeTruthy()
  }
})

test('the room foot states only what the phase machine enforces', () => {
  room({ phase: 'vote', cards: TWO_CARDS })
  expect(
    screen.getByText(
      'Writing closed when the cards were revealed · dots close when the room moves on',
    ),
  ).toBeInTheDocument()
})
