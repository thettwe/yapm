# board-view — design

## Ordering: fractional index, single-write move

A card move must be **one mutator writing one row** — never a renumber of siblings (N writes = N resynced rows, concurrent-edit conflicts, and a sub-100ms violation). Fractional indexing (`fractional-indexing@4.0.0`, CC0) gives each card a `text` key; a new key is always mintable between any two neighbours, so a move touches exactly one row and DB order is plain `ORDER BY rank`.

- **Alphabet**: `BASE_62_DIGITS`, used identically on the client (optimistic mint) and everywhere else. Mixing alphabets within a column corrupts order.
- **Collation**: `rank text` is indexed `(team_id, status, rank COLLATE "C")` so Postgres byte-order sort matches JS string `<`. An integration test seeds `generateNKeysBetween` output and asserts DB order == JS `.sort()`.
- **Nullable**: `rank` is nullable. Existing rows are backfilled once in the migration; new issues (`issue.create` unchanged) keep `rank` null and sort **last**, ordered by `createdAt` then `id`, until first moved. This avoids widening `issue.create` and keeps the board deterministic.

## The move mutator and the call-site rank (constraint #4 extended to rank)

`issue.move(id, status, rank, updatedAt)` — `canWrite` + `loadIssueForWrite` (auth before existence, team-scoped), then a single `issue.update`. The mutator does **not** compute the rank: the client computes `generateKeyBetween(prevRank, nextRank)` at the call site and passes the finished `rank` string in, exactly like the client-minted UUIDv7. Rationale: a mutator re-runs during rebase; computing the key inside from live neighbours would produce a different key between the optimistic and authoritative runs and could jump the card. A fixed call-site key is stable through rebase. Shared `rankBetween`/`initialRanks` helpers (in `packages/schema`, so client and server share one alphabet) wrap `fractional-indexing`.

Concurrency: `rank` is non-unique. Two clients dropping into the same gap can mint equal keys; they sort by the stable `(rank, id)` tiebreaker (`id` is monotonic UUIDv7) and self-heal on the next move. Chosen over a server-side neighbour requery for simplicity — the board is a small-team surface.

## DnD library: @dnd-kit classic

`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` (MIT), not the `@dnd-kit/react@0.5.0` Beta (per `reference/board-dnd.md`). Classic ships a directional `KeyboardSensor` + ARIA live-region announcements out of the box — the best fit for a keyboard-first product. Board = `DndContext` with a `PointerSensor` (4px activation) and a `KeyboardSensor` (`sortableKeyboardCoordinates`); each column is a droppable + a `SortableContext` (`verticalListSortingStrategy`); a `DragOverlay` renders the lifted card outside the transformed list. `onDragEnd` computes the destination neighbours and fires one `issue.move`; `onDragOver` only mutates local preview state.

## Keyboard + command-palette equivalence

Two non-pointer paths (APG "every drag has a non-pointer equivalent"):
1. **Spatial** — dnd-kit's KeyboardSensor: focus a card, Space/Enter picks up, arrows move within/across columns, Space/Enter drops, Escape cancels, with announcements.
2. **Command** — a board-local command palette (⌘K / `m`) exposing "Move to <status>" for the focused card; appends it to the target column (`generateKeyBetween(lastRank, null)`) via the same mutator. Cheap because the statuses are a fixed enum, and the most reliable path for switch/voice users.

Focus is restored to the moved card by id after the optimistic state lands (a card remounts into a new column and would otherwise drop focus to `<body>`).

## Virtualization: lazy

`@tanstack/react-virtual@3.14.8`. A column renders plainly until it exceeds a threshold (100), then virtualizes: the virtualizer transform goes on an outer wrapper and the sortable transform on an inner card (separate refs) so they never overwrite each other; `SortableContext items` is the full ordered id list even though only the window is mounted; `getItemKey` is `issue.id`. A status column is rarely long, so the ceremony is paid only when it matters (PRINCIPLES: measure first).

## Reuse

The board reuses: `queries.issues.byTeam` (unchanged), the status/priority enums and label maps from `apps/web/src/issues/model.ts`, the `StatusGlyph`/`PriorityMark`/`Avatar` primitives and the reality-strip/divergence slots (a new `board-card` primitive composes them vertically), `runMutation`, `newId`, and the tokenized theme. No hardcoded colors/fonts.

## Decisions made during implementation

- **Rank is passed to the mutator, not computed inside it.** `reference/board-dnd.md` §2.3 sketched computing the rank inside the mutator from `prevRank`/`nextRank`; the change's load-bearing constraints instead require call-site computation (stable through rebase, matching the client-minted-UUID rule). Followed the constraint: `issue.move` takes a finished `rank` string.
- **New issues sort last (null rank), not auto-ranked on create.** `issue.create` is left untouched (the `rank` stays nullable and null) rather than minting a rank at creation, to keep the create path and its server-numbering override unchanged. The board sorts null-rank cards last by `createdAt`/`id`; the first move assigns a real rank.
- **`board-card` lives in `packages/ui`.** Kept the card a tokenized design-system primitive (like `issue-row`) rather than composing raw primitives in the app, so the board's visuals stay strictly tokenized and story-covered.
- **E2E spec written and executed against the deterministic stack.** `apps/web/e2e/board.spec.ts` covers keyboard pick-up/move/drop across columns, drag reorder, command-palette move, the three-preset × light/dark matrix, and viewer read-only. It runs by pointing the dockerized `zero-cache` at Playwright's harness server port (`YAPM_HOST_PORT=3210`, matching `E2E_SERVER_PORT`) after a clean-DB migrate, then `pnpm exec playwright test`. Verified green: the full suite is 28/28 on a fresh DB (22 prior + 6 board), and the board suite is stable across repeats. Unit + integration (drift with `rank`, the COLLATE "C" ordering test, the migration backfill) were verified against live Postgres.
- **Two board E2E tests needed reliable dnd-kit driving, not code changes.** As written the pointer-drag reorder used Playwright `dragTo`, which never satisfies dnd-kit's 4px `PointerSensor` activation constraint nor feeds it the incremental moves its collision detection needs, so it failed deterministically; replaced with a granular press → nudge-past-threshold → glide-over-target → release sequence. The keyboard cross-column move fired Space/ArrowRight/Space in one burst, racing dnd-kit's async layout measurement between steps (the pick-up landed but the move no-oped into the empty destination column); paced the keystrokes. Both are test-driver fixes — the board move path itself (shared `issue.move` + call-site rank) was already correct, as the command-palette move and the passing runs confirm.
- **Board command palette is board-local**, not the list's `CommandProvider`. The list palette's "Change status" calls `issue.setStatus` (no rank); the board needs a move that also places the card, and it owns the per-column rank data needed to compute the append key, so it hosts its own small palette surface reusing the `command-palette` primitives.
