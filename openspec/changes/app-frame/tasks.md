## 1. Read the rulebook first

- [ ] 1.1 Read `design-explorations/overhaul-2026-08/northstar/ia.html` (render `ia-full.png`) — §"The frame" and §"Destinations" — plus `NORTHSTAR.md`
- [ ] 1.2 Diff the shared `<header class="gbar">` and `.statusline` markup across `home-digest-2.html`, `issues.html`, `issue.html`, `delivery.html`, `ia.html`; note the deck/statusline CSS (48px / 32px, `--statusline-bg`, the 2px accent underline)
- [ ] 1.3 Read `reference/zero.md` (Zero 1.x names), the TanStack Router and Tailwind 4.3 references; read `packages/schema/src/zero/team-home.ts` (`buildAttention`, `buildCadence`, `TeamHomeAttention`) and `apps/web/src/home/team-home.tsx` for the tone precedent
- [ ] 1.4 Inventory the shared vocabulary already in `packages/ui/src/components/` (`drawn.tsx`, `reality-track.tsx`, `peek.tsx`, `how.tsx`, `provenance-mark.tsx`, `status-glyph.tsx`, `priority-mark.tsx`) — the frame draws nothing new

## 2. The shared derivation (`packages/schema`)

- [ ] 2.1 Extract `buildTeamFrame(input, now): TeamFrameModel` in `packages/schema/src/zero/team-home.ts` — team identity, `attention` from the existing `buildAttention`, the active cycle's title/`dayIndex`/`dayCount`, the in-cycle shipped count, and `buildCadence`'s current-week deploy count; every field null-able so a segment can fold
- [ ] 2.2 Refactor `buildTeamHome` to call `buildTeamFrame` first and build its bands on that result, so `TeamHomeModel.attention` IS `TeamFrameModel.attention` — one `buildAttention` call site in the repo
- [ ] 2.3 Export `buildTeamFrame` and `TeamFrameModel` from `packages/schema/src/index.ts`; confirm no new table, query, mutator or migration was added

## 3. Band 1 — the deck

- [ ] 3.1 `apps/web/src/frame/team-context.ts`: the anchor-team resolver — team in the route, else the remembered `yapm.frame.team` validated against the synced team list, else the first team, else none; guarded `localStorage` read/write on the `apps/web/src/theme/theme.ts` pattern
- [ ] 3.2 `apps/web/src/frame/deck.tsx`: 48px band — workspace mark + org `/` team + chevron (the existing `Switcher` reworked as the chevron's menu), the six stops in a `<nav aria-label="Destinations">` with `aria-current="page"`, accent text + 2px accent underline on the active stop
- [ ] 3.3 The `more▾` transient on Base UI `Menu` (the `Switcher` precedent): Retros `g r`, Projects `g p`, Roadmap `g m`, with kbd hints; keyboard-reachable, Escape closes and returns focus; Decisions folds away entirely
- [ ] 3.4 The right cluster: the ⌘K pill as a real `<Link to="/search">` (keeping `data-testid="search-entry"`), the attention badge (absent at zero, accessible name states what it counts), `InboxBadge`, the user chip
- [ ] 3.5 Fold `ThemeControls`, the settings routes, `/showcase` and the conditional `PmDigestsEntry` into the user menu — preserving `PmDigestsEntry`'s audience-then-content gate verbatim so an unnamed reader still constructs no query
- [ ] 3.6 Collapse behaviour below the deck's comfortable width: stops fold into `more▾` from the right; the band never wraps to a second row

## 4. Band 3 — the statusline

- [ ] 4.1 `apps/web/src/frame/statusline.tsx`: 32px, `--statusline-bg`, `margin-top:auto`; the four team segments, each folding individually; labels only, no sentences
- [ ] 4.2 Move the connection indicator into the statusline's right cluster — same `ConnectionSummary`, dot, `role="status" aria-live="polite"`, `sr-only` detail, `RetryButton` + `fallbackRef`; keep `data-testid="connection-status"`, `data-connection`, `data-recovery`
- [ ] 4.3 Delete `apps/web/src/components/connection-status.tsx` and every import of it; assert no second indicator can render

## 5. The frame, and the palette owner

- [ ] 5.1 `apps/web/src/frame/app-frame.tsx`: deck + `<main>` + statusline in a `min-h-svh` flex column, with the `measure` prop (`default` | `wide` | `full`) replacing `AppShell`'s `wide`
- [ ] 5.2 `apps/web/src/frame/go-to.ts`: the `g`-prefix shortcuts (`h i t c d r p m`), suppressed while a text input, `contenteditable` or an open dialog holds focus
- [ ] 5.3 `apps/web/src/frame/command-registry.tsx`: the single ⌘K owner mounted in `routes/__root.tsx` — one `keydown` listener, one palette instance, `useCommandSource(id, source)` registration, plus the always-present group (six destinations, Inbox, search everything, theme)
- [ ] 5.4 Convert `issues/command.tsx`, `board/board.tsx`, `retro/retro-command.tsx` and `routes/showcase.tsx` from their own ⌘K listeners to registration; their imperative APIs and every non-⌘K surface shortcut stay exactly as they are

## 6. Band 2 — the masthead, and the migration

- [ ] 6.1 `apps/web/src/frame/masthead.tsx`: title + mono count, `lens` slot, `meta` slot, `actions` slot — `ia.html`'s band-2 anatomy and nothing else
- [ ] 6.2 Migrate the eleven `AppShell` importers to `AppFrame` and delete `app-shell.tsx`
- [ ] 6.3 Migrate the nine hand-rolled routes (`issues.index`, `issues.$issueKey`, `board`, `cycles`, `triage`, `delivery`, `projects`, `roadmap`, `retros.index`, `retros.$retroId`) onto `AppFrame` + `Masthead`, keeping every control they offer today working
- [ ] 6.4 Move Board into the Issues masthead as a lens (`List | Board`, `aria-pressed`); delete `apps/web/src/board/view-switch.tsx` and its ten importers' usage; Gallery folds away
- [ ] 6.5 Add the repo guard: no `sticky top-0` application header outside `apps/web/src/frame/`

## 7. Tests

- [ ] 7.1 `packages/schema` unit: `buildTeamFrame` and `buildTeamHome` return the identical attention count across a table of inputs, including the two-classes-one-issue case and the zero case; a test that fails if a second `buildAttention` call site appears
- [ ] 7.2 `apps/web` component: **the falsifiable check** — rendering any authenticated route yields exactly one deck, exactly one statusline, and every element reporting an attention count reports the same value; zero renders no badge and no attention segment
- [ ] 7.3 `apps/web` component: the deck's six stops, `aria-current` on the right stop per route, Board-as-lens keeping Issues current, `more▾` open/Escape/focus-return, and the `g`-prefix shortcuts including the typing-suppression case
- [ ] 7.4 `apps/web` component: off-team degradation — stops point at the anchor team with nothing current, the statusline states no team fact, a stale anchor falls back, an empty workspace drops the stops
- [ ] 7.5 `apps/web` component: one palette owner — the shortcut opens a palette on a surface that registers nothing; a surface's commands appear only while mounted; every command reachable before is reachable after
- [ ] 7.6 `apps/web/src/routes.test.tsx`: the route inventory — every registered route is reachable from the frame or is one of the two unauthenticated surfaces
- [ ] 7.7 Extend `packages/ui/src/styles/contrast.test.ts` with the frame's token pairs (active stop on `--bg`, statusline text on `--statusline-bg`, attention ink on `--urgent-soft`) in all six theme blocks
- [ ] 7.8 Update the Playwright specs the frame moves: the fifteen `connection-status` waits (indicator relocated, testid preserved) and `retro-ai.spec.ts`'s `navigation { name: 'Issue views' }` → `navigation { name: 'Destinations' }` with `aria-current`. Update to match the new frame; never weaken an assertion

## 8. Documentation

- [ ] 8.1 New `apps/docs/src/content/docs/features/app-frame.md`: the three bands, the six destinations, the one-attention-number rule, the keyboard grammar (`⌘K`, `g`-prefix, `more▾`), and honest degradation off-team
- [ ] 8.2 Update `features/team-home.md` (the attention number is now app-wide), `features/board.md` (Board is a lens, not a peer view), `features/notifications.md` (the badge is in the deck, on every surface), `features/search.md` (the ⌘K pill and the palette owner)
- [ ] 8.3 Update `README.md` and `ROADMAP.md` where they describe navigation or the app shell; add the change's ROADMAP row/status
- [ ] 8.4 `pnpm --filter @yapm/docs build` passes; no stale root doc left behind (PROCESS.md §2)

## 9. Gates

- [ ] 9.1 `pnpm turbo lint typecheck test build`
- [ ] 9.2 The compose smoke test
- [ ] 9.3 The full Playwright e2e suite (CI is the gate of record; run locally once after the migration since this is cross-cutting chrome)
- [ ] 9.4 Walk every scenario in `openspec/changes/app-frame/specs/**` and confirm it is true
