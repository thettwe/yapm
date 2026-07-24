import { type IssueStatus, rankBetween } from '@yapm/schema'
import type { IssueRowData } from '@/issues/model'
import { STATUS_LABEL, STATUS_ORDER } from '@/issues/model'

// A board card is a list row plus its ordering rank (nullable until first moved).
export interface BoardCardData extends IssueRowData {
  readonly rank: string | null
}

export interface BoardColumn {
  readonly status: IssueStatus
  readonly label: string
  readonly cards: readonly BoardCardData[]
}

// Within a column: real ranks ascending (byte order == JS string order), then null-rank cards
// (freshly created, never moved) last by creation time then id. Deterministic and stable.
export function compareCards(a: BoardCardData, b: BoardCardData): number {
  if (a.rank !== null && b.rank !== null) {
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
    return a.id.localeCompare(b.id)
  }
  if (a.rank !== null) return -1
  if (b.rank !== null) return 1
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id.localeCompare(b.id)
}

export function buildColumns(cards: readonly BoardCardData[]): BoardColumn[] {
  return STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    cards: cards.filter((card) => card.status === status).sort(compareCards),
  }))
}

export const COLUMN_DROPPABLE_PREFIX = 'board-column:'

export function columnDroppableId(status: IssueStatus): string {
  return `${COLUMN_DROPPABLE_PREFIX}${status}`
}

// The nearest real (non-null) rank scanning outward from a slot. Because real ranks are
// contiguous at the front of a column's display order, the value found scanning back is always
// strictly less than the one found scanning forward, so `rankBetween` never throws.
function realRankBefore(cards: readonly BoardCardData[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const rank = cards[i]?.rank
    if (rank != null) return rank
  }
  return null
}

function realRankAtOrAfter(cards: readonly BoardCardData[], index: number): string | null {
  for (let i = index; i < cards.length; i += 1) {
    const rank = cards[i]?.rank
    if (rank != null) return rank
  }
  return null
}

// Given the destination column's cards in their FINAL order (moved card included at `index`),
// mint the single new rank for the moved card between its real-ranked neighbours. Sibling
// ranks are never touched.
export function rankForSlot(finalOrder: readonly BoardCardData[], index: number): string {
  const before = realRankBefore(finalOrder, index)
  const after = realRankAtOrAfter(finalOrder, index + 1)
  return rankBetween(before, after)
}

// Append rank for "Move to status": after the last real-ranked card in the target column.
export function appendRank(destCards: readonly BoardCardData[]): string {
  return rankBetween(realRankBefore(destCards, destCards.length), null)
}
