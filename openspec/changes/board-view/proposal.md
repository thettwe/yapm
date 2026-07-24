## Why

issue-core landed the issue entity, the fixed six statuses, team-scoped synced queries, the keyboard-first list, and the command palette — but deliberately deferred manual ordering ("a `sort_order` column belongs to board-view"). This change adds the peer **board view**: a keyboard-first kanban of a team's issues grouped into columns by the fixed six statuses, at a new `/board` route. Moving a card changes its status and/or reorders it within a column.

It is roadmap change #4. It reuses issue-core wholesale — the same team-scoped synced `issue` query, the same tokenized status/priority/assignee visuals, the same shared-mutator + row-level-permission model — and adds exactly one new synced field (a nullable fractional-index `rank`) and one new shared mutator (`issue.move`). Serves VISION **#1 Speed** (a card move is a single optimistic write, sub-100ms, no sibling renumbering), **#9 Sub-100ms**, and **#10 Keyboard-first** (full pick-up / move / drop keyboard path plus a command-palette "Move to status…" action, not only pointer drag).

## What Changes

- **A `/board` route, peer to the list.** A kanban of the team's issues in six fixed columns (Backlog, Todo, In Progress, In Review, Done, Canceled), reading the same `issues.byTeam` synced query. A view toggle links List ↔ Board.
- **A nullable `rank` on `issue`** — a fractional-index string (`fractional-indexing`, BASE_62, stored `text COLLATE "C"`) that orders cards within a column. Existing issues are backfilled once, per status group, matching the list's default order. New issues keep `rank` null until first moved and sort last deterministically.
- **A single-write move.** One new shared mutator `issue.move` sets the moved card's `rank` (and `status` when the column changed) — never renumbering siblings. The fractional index is computed at the **mutator call site** (the client picks the key between the destination neighbours and passes it in), never inside the mutator, which re-runs on rebase.
- **Drag via @dnd-kit classic** (`@dnd-kit/core` + `@dnd-kit/sortable`) for pointer moves, **plus a full keyboard path** (Space/Enter to pick up, arrows to move within and across columns, Space/Enter to drop, Escape to cancel) via the KeyboardSensor + `sortableKeyboardCoordinates`, with ARIA live-region announcements.
- **A command-palette "Move to status…" action** — the non-pointer, always-available equivalent that appends the focused card to a chosen column via the same `issue.move` mutator.
- **Lazy virtualization** — a column renders plainly until it crosses ~100 cards, then virtualizes with `@tanstack/react-virtual` (nested transform refs so the virtualizer and the sortable never fight).

## Capabilities

### New Capabilities

- `board`: the status-grouped kanban view at `/board`; the fractional-index ordering model; drag + full keyboard move + command-palette move; lazy virtualization; correctness across all three presets in light and dark; viewers read-only.

### Modified Capabilities

- `issue-tracking`: adds the nullable `rank` field to `issue` and the `issue.move` shared mutator (team-scoped, `canWrite`-gated, call-site-computed rank, single-row write).
- `local-first-sync`: `issue.move` syncs under the same team scope; viewers cannot move cards; the `rank` field replicates like any issue column and the drift test covers it.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0005_board_rank` (nullable `rank text`, index `(team_id, status, rank COLLATE "C")`, one-time backfill); `rank` added to the Kysely `DB` interface, the Zero schema, and the drift test; `fractional-indexing` added; `issue.move` mutator + call-site `rankBetween`/`initialRanks` helpers exported.
- **UI** (`packages/ui`): a tokenized `board-card` primitive reusing the status/priority/assignee visuals and the reality-strip/divergence slots; a story.
- **Web** (`apps/web`): the `/board` route, the DnD board (columns, sortable cards, drag overlay, keyboard sensor, announcements), the board command-palette "Move to status…" surface, the List↔Board toggle, lazy virtualization.
- **Dependencies**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@tanstack/react-virtual`, `fractional-indexing` added to the pnpm catalog.

Docs: the docs site (`apps/docs`) is still a pre-Starlight stub (as of issue-core); no user pages are added until it is stood up. The behavior is specified in `openspec/specs/board`.

## Non-goals

- **Real delivery/reality data** — the card shows the same quiet "not linked" reality state as the list; git signals arrive with `connectors`.
- **Cross-team or multi-status bulk board ops, swimlanes, WIP limits, board-specific saved views** — not in v1 scope.
- **Grouping the board by anything other than status** — the board's columns are the fixed status enum by definition; other groupings stay on the list.
- **A unique constraint on `rank`** — rare concurrent ties self-heal on the next move and sort by a stable `id` tiebreaker.
