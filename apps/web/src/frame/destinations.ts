// THE DECK'S MEMBERSHIP, as data. Eight destinations across two tiers, and the one list the
// product may count.
//
// `deck.tsx` draws them, `app-frame.tsx` offers them in the palette's `Go to` group, and
// `routes.test.tsx` holds all three against the route inventory. The palette used to keep its own
// hand-written copy of the same eight rows: two lists of the same thing, each edited by whoever
// remembered, which is how a destination ends up advertised with a key it no longer has or offered
// in a palette the deck no longer draws.
//
// The order is the deck's own — the bar first, in the order the band draws it, then the menu's
// permanent list — so the palette reads as the deck does rather than as the router does.

export type DestinationId =
  | 'home'
  | 'issues'
  | 'cycles'
  | 'delivery'
  | 'triage'
  | 'retros'
  | 'projects'
  | 'roadmap'

export type DestinationTier = 'bar' | 'menu'

export interface Destination {
  readonly id: DestinationId
  readonly label: string
  // The `g` binding, advertised beside the name wherever the destination is drawn. A binding
  // belongs to its destination and not to its seat, so this column does not move when `tier` does.
  readonly shortcut: string
  // `bar` is a seat in the band itself; `menu` is the `more▾` popup's PERMANENT list — never the
  // responsive group, which holds only what the bar has shed at the current width.
  readonly tier: DestinationTier
  // The router's own id for the destination, so the route inventory can be held against this table
  // without a second mapping in between.
  readonly routeId: string
}

export const DESTINATIONS: readonly Destination[] = [
  { id: 'home', label: 'Home', shortcut: 'g h', tier: 'bar', routeId: '/teams/$teamId/' },
  {
    id: 'issues',
    label: 'Issues',
    shortcut: 'g i',
    tier: 'bar',
    routeId: '/teams/$teamId/issues/',
  },
  { id: 'cycles', label: 'Cycles', shortcut: 'g c', tier: 'bar', routeId: '/teams/$teamId/cycles' },
  {
    id: 'delivery',
    label: 'Delivery',
    shortcut: 'g d',
    tier: 'bar',
    routeId: '/teams/$teamId/delivery',
  },
  {
    id: 'triage',
    label: 'Triage',
    shortcut: 'g t',
    tier: 'menu',
    routeId: '/teams/$teamId/triage',
  },
  {
    id: 'retros',
    label: 'Retros',
    shortcut: 'g r',
    tier: 'menu',
    routeId: '/teams/$teamId/retros/',
  },
  {
    id: 'projects',
    label: 'Projects',
    shortcut: 'g p',
    tier: 'menu',
    routeId: '/teams/$teamId/projects',
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    shortcut: 'g m',
    tier: 'menu',
    routeId: '/teams/$teamId/roadmap',
  },
]

export function destinationsIn(tier: DestinationTier): readonly Destination[] {
  return DESTINATIONS.filter((destination) => destination.tier === tier)
}
