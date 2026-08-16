// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { BoardCard, CARD_TRACK_WIDTH } from './board-card'
import { buildRealityShape, RealityTrack, realityTrackLabel } from './reality-track'

// The card is the board's whole vocabulary in one primitive, and three of its registers are new:
// a card with nothing true to say, the hole a picked-up card leaves, and the card in flight. Each
// is drawn from props alone — no animation, no board — so each is provable here.

const REST = {
  issueKey: 'ENG-116',
  title: 'Apple Pay in the payment sheet',
  status: 'in-progress',
  priority: 'urgent',
} as const

const DIVERGED = { pr: 'merged', ci: 'passing', reviewAgeMs: 600_000, deployedAt: null } as const

function slot(card: HTMLElement, name: string): HTMLElement | null {
  return card.querySelector<HTMLElement>(`[data-slot="${name}"]`)
}

function card(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[data-slot="board-card"]')
  if (node === null) throw new Error('no card')
  return node
}

test('a card handed no track draws no ink and announces nothing — the slot is empty, not filled', () => {
  const { container } = render(<BoardCard {...REST} />)

  const track = slot(card(container), 'board-card-track')
  expect(track).not.toBeNull()
  // Every card used to be handed a quiet track labelled "No delivery signal yet". An inkless
  // track states nothing to assistive technology (`reality-vocabulary`), so absent means absent:
  // nothing is drawn, and nothing is announced, in the caller's place.
  expect(track?.querySelector('[role="img"]')).toBeNull()
  expect(track?.textContent).toBe('')
  expect(track?.querySelector('*')).toBeNull()
})

test('a card with nothing to say reserves the same track measure as one that says everything', () => {
  const quiet = render(<BoardCard {...REST} />)
  const loud = render(
    <BoardCard
      {...REST}
      phrase={<span>Done in git, not on the board</span>}
      realityTrack={
        <RealityTrack
          width={CARD_TRACK_WIDTH}
          shape={buildRealityShape(DIVERGED, { divergence: 'status_behind_merge' })}
          label={realityTrackLabel(DIVERGED, 'PR merged but this issue is not marked done')}
        />
      }
    />,
  )

  const quietTrack = slot(card(quiet.container), 'board-card-track')
  const loudTrack = slot(card(loud.container), 'board-card-track')
  expect(quietTrack?.style.width).toBe(`${CARD_TRACK_WIDTH}px`)
  expect(loudTrack?.style.width).toBe(quietTrack?.style.width)
  expect(loudTrack?.querySelector('[data-slot="reality-track-break"]')).not.toBeNull()
})

test('the phrase and the footer are drawn only when there is one — never as a reserved blank row', () => {
  const bare = render(<BoardCard {...REST} />)
  expect(slot(card(bare.container), 'board-card-phrase')).toBeNull()
  expect(slot(card(bare.container), 'board-card-footer')).toBeNull()

  const said = render(<BoardCard {...REST} phrase={<span>In review — waiting 16h</span>} />)
  expect(slot(card(said.container), 'board-card-phrase')?.textContent).toContain('waiting 16h')
})

test('a title that runs long wraps and takes every other fact with it', () => {
  const long =
    'Address autocomplete on the shipping step drops the second line of a UK address when the postcode is entered first'
  const { container } = render(
    <BoardCard
      {...REST}
      title={long}
      labels={[{ name: 'checkout' }]}
      assignee={{ name: 'Ada Lovelace' }}
    />,
  )

  // Stated in full: at a 216px column this is three lines, and a card that clipped it to one
  // would be hiding the only thing on it a reader is looking for.
  expect(screen.getByText(long)).toBeInTheDocument()
  const title = screen.getByText(long)
  expect(title.className).not.toMatch(/truncate|whitespace-nowrap|line-clamp/)
  // Everything below the title survives it; nothing is dropped to make room.
  expect(screen.getByText('checkout')).toBeInTheDocument()
  expect(screen.getByLabelText('Ada Lovelace')).toBeInTheDocument()
  expect(slot(card(container), 'board-card-track')).not.toBeNull()
  expect(card(container).className).not.toMatch(/(?:^|\s)h-\d/)
})

// The labels row shares one line with the reserved track measure and the assignee, and the track
// is the widest thing on it. jsdom measures nothing, so what is asserted is WHICH element was made
// to yield: the labels, the way a list row makes its title yield.
test('a label that runs long is the element that yields, not the track or the assignee', () => {
  const { container } = render(
    <BoardCard
      {...REST}
      labels={[{ name: 'checkout-and-payments-platform-migration' }]}
      assignee={{ name: 'Ada Lovelace' }}
      realityTrack={
        <RealityTrack
          width={CARD_TRACK_WIDTH}
          shape={buildRealityShape(DIVERGED, { divergence: 'status_behind_merge' })}
          label={realityTrackLabel(DIVERGED, 'PR merged but this issue is not marked done')}
        />
      }
    />,
  )

  const name = screen.getByText('checkout-and-payments-platform-migration')
  expect(name.className).toContain('truncate')
  const labels = name.closest('span.flex-wrap')
  expect(labels?.className).toContain('min-w-0')
  expect(labels?.className).toContain('overflow-hidden')
  // And the furniture the labels yield to keeps every bit of its measure.
  const track = slot(card(container), 'board-card-track')
  expect(track?.style.width).toBe(`${CARD_TRACK_WIDTH}px`)
  expect(track?.className).toContain('flex-none')
  expect(
    screen.getByLabelText('Ada Lovelace').closest('[data-slot="avatar"]')?.className,
  ).toContain('shrink-0')
})

test('the hole a picked-up card leaves is the same box, emptied', () => {
  const resting = render(<BoardCard {...REST} />)
  const held = render(<BoardCard {...REST} dragging />)

  const hole = card(held.container)
  expect(hole.dataset.dragging).toBe('true')
  // Same element, same measure: the content is hidden rather than removed, so the gap is exactly
  // the size of the card that left it, and the fill and the solid border go.
  expect(hole.firstElementChild?.className).toContain('invisible')
  expect(hole.className).toContain('border-dashed')
  expect(hole.className).toContain('bg-transparent')
  expect(slot(hole, 'board-card-track')?.style.width).toBe(
    slot(card(resting.container), 'board-card-track')?.style.width,
  )
  expect(hole.textContent).toContain(REST.title)
})

test('the card in flight is raised and states the contract it is carrying', () => {
  const { container } = render(
    <BoardCard {...REST} inFlight footer={<span>space drop · esc cancel · ← → column</span>} />,
  )

  const flying = card(container)
  expect(flying.dataset.inFlight).toBe('true')
  expect(flying.className).toContain('shadow-elevated')
  expect(flying.className).toContain('ring-accent-line')
  expect(slot(flying, 'board-card-footer')?.textContent).toContain('esc cancel')
  // The footer is a state, not chrome: a resting card carries no keys.
  expect(slot(card(render(<BoardCard {...REST} />).container), 'board-card-footer')).toBeNull()
})
