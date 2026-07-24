## 1. Dependencies

- [x] 1.1 Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@tanstack/react-virtual` to the pnpm catalog and `apps/web`; add `fractional-indexing` to the catalog and `packages/schema`; run `pnpm install` and confirm `pnpm turbo build` still passes.

## 2. Schema — rank column, migration, Zero schema (packages/schema)

- [x] 2.1 Add nullable `rank` to `IssueTable` (`Nullable<string>`) in `src/db/types.ts`.
- [x] 2.2 Write forward-only migration `0005_board_rank`: `ALTER TABLE issue ADD COLUMN rank text`; index `issue_team_status_rank_idx` on `(team_id, status, rank COLLATE "C")`; one-time backfill per `(team_id, status)` group ordered by the list default (priority desc, updated desc) using `generateNKeysBetween`. Register in `migrations/index.ts`; app boots and migrates cleanly.
- [x] 2.3 Add `rank: string().from('rank').optional()` to the Zero `issue` table.
- [x] 2.4 Add call-site rank helpers to `packages/schema` (`rankBetween(a, b)`, `initialRanks(n)`) wrapping `fractional-indexing` with `BASE_62_DIGITS`; export from the package index.

## 3. Mutator — single-write move (packages/schema)

- [x] 3.1 Add the shared `issue.move` mutator (`id`, `status`, `rank`, `updatedAt`): `canWrite` + `loadIssueForWrite` (auth before existence, team-scoped), then one `issue.update` of `status`+`rank`+`updatedAt`. Register in `defineMutators`; export `MOVE_ISSUE_MUTATOR_NAME`. It inherits into `createServerMutators` unchanged.

## 4. Drift + schema tests (packages/schema)

- [x] 4.1 Extend the schema-drift Kysely map and rely on Zero introspection to cover `issue.rank` (nullable text).
- [x] 4.2 Unit-test the rank helpers (monotonic keys, `initialRanks` byte-ordered) and the `issue.move` mutator (member moves = single update; viewer/non-member rejected before existence; cross-team rejected).
- [x] 4.3 Integration test: seed `initialRanks` output and assert JS `.sort()` order == Postgres `ORDER BY rank COLLATE "C"`.

## 5. UI — board card primitive (packages/ui)

- [x] 5.1 Add a tokenized `board-card` component reusing `StatusGlyph`/`PriorityMark`/`Avatar` and the reality-strip/divergence slots, keyboard-focusable; add a story across presets and modes.

## 6. Web — board route, DnD, keyboard, palette (apps/web)

- [x] 6.1 Add board model helpers: group synced rows into the six fixed columns, ordered by `rank` with null-rank cards last (`createdAt`/`id`); compute destination neighbour ranks for a drop and an append.
- [x] 6.2 Add the `/board` route (Authenticated shell + header + view toggle List↔Board), reading `issues.byTeam`.
- [x] 6.3 Build the DnD board with `@dnd-kit` classic: columns as droppable `SortableContext`s, sortable cards, `DragOverlay`, `PointerSensor` + `KeyboardSensor(sortableKeyboardCoordinates)`, ARIA announcements/instructions, `prefers-reduced-motion` respected. `onDragEnd` fires one `issue.move` with a call-site rank; focus restored after move.
- [x] 6.4 Add the board command palette "Move to status…" for the focused card (⌘K / `m`), appending to the target column via `issue.move`; gated so viewers see no move action.
- [x] 6.5 Virtualize a column with `@tanstack/react-virtual` only past ~100 cards (nested transform refs; full-id `SortableContext`; stable `getItemKey`).
- [x] 6.6 Add the List↔Board toggle to the list header and the team-detail nav.

## 7. Verification

- [x] 7.1 `pnpm turbo typecheck lint build test` green; boundary guard clean (ZQL/mutators only in `packages/schema`, no package→app imports); drift test run against live Postgres including `rank`.
- [x] 7.2 Add Playwright coverage: keyboard pick-up/move/drop across columns changes status and persists; drag reorders within a column; command-palette move; viewer read-only on the board; board correct in all three presets light+dark; existing suites still pass.

## Documentation

- [x] 8.1 Stand up the minimum Astro Starlight setup in `apps/docs` (catalog `astro` + `@astrojs/starlight`, `astro.config.mjs`, `src/content.config.ts`, docs `build` script) and add the user-facing **Board** page (`src/content/docs/features/board.md`: what it is, drag + full keyboard move, the command-palette "Move to status…" action, viewer read-only) with a home page linking a Features index; `pnpm --filter @yapm/docs build` passes and the full `turbo typecheck lint build test` stays green.
