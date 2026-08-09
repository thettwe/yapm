# Tasks — inbox-daylight

## 1. Read the rulebook first

- [ ] 1.1 Read `design-explorations/overhaul-2026-08/destinations/inbox.html` end to end **including its closing comment** (§"Facts drawn", §"What folded away, and the exact reason" 1–9, §"Deviations from the canonical frame", §"Self-critique", §"Set-reconciliation pass"), and look at `inbox.png` / `inbox-full.png` if present — render them from the HTML if they are not
- [ ] 1.2 Read `destinations/DESTINATIONS.md` — the `inbox.html` row, §"What the render showed" item 4 (the `--text-3` floor), §"Remaining drift" (frame B reads `Inbox 3`), and the `inbox.html` self-critique
- [ ] 1.3 Read `northstar/ia.html` (§"The word diet", the band-2 anatomy, transients-never-destinations) and `northstar/issues.html` (the row anatomy this page borrows, column for column)
- [ ] 1.4 Read `packages/schema/src/zero/schema.ts` around `notification` — the composite primary key and the **comment stating why there is no `issue` relationship** — and `queries.ts` `notifications.mine` (self-scoped, no admin bypass, `.limit()`)
- [ ] 1.5 Read `openspec/specs/notifications/spec.md` — the requirements this change modifies rather than contradicts
- [ ] 1.6 Read `reference/zero.md` (Zero 1.x is `defineQuery` / `defineMutator` / `createBuilder`; the 0.x names are non-functional) plus the Tailwind 4.3 and TanStack Router references — this change writes no new Zero API, so confirm rather than assume
- [ ] 1.7 Read the surfaces this change consumes and must NOT rebuild: `apps/web/src/frame/{masthead,app-frame,deck}.tsx`, `packages/ui/src/components/{issue-row,status-glyph,button}.tsx`, `apps/web/src/issues/{issue-list.tsx,model.ts}` (`formatRelative`), `apps/web/src/triage/triage-view.tsx` (the group band and empty state registers)
- [ ] 1.8 Read the "## Decisions made during implementation" sections of `openspec/changes/archive/2026-08-09-triage-daylight/design.md` and `openspec/changes/projects-roadmap-daylight/design.md` — settled precedent
- [ ] 1.9 **Inventory the shipped inbox's capabilities** against `design.md`'s table before editing anything, and correct that table if the code says otherwise

## 2. The copy seam (`packages/schema`)

- [ ] 2.1 `packages/schema/src/zero/notifications/copy.ts`: `NotificationCopy` gains `phrase` — the actor-and-verb with **no** subject interpolated. `title` and `summary` are untouched
- [ ] 2.2 The four phrases: `<actor> assigned you`, `<actor> commented`, `<actor> mentioned you`, and `Shared with you` for `pm_digest_published` (which names no actor by design, so the `Someone` fallback can never reach it)
- [ ] 2.3 Comment the constraint the code cannot express: which string is for a surface that draws the subject beside it and which is for a reader outside the app
- [ ] 2.4 Confirm no email template or delivery sweep changes: grep every consumer of `notificationCopy` and verify each still reads `title` / `summary`

## 3. The read model (`apps/web/src/notifications/model.ts`)

- [ ] 3.1 `NotificationRowData` gains `phrase`; `title` keeps its existing meaning (the full sentence) so nothing that reads it breaks, and the row draws `subjectTitle`
- [ ] 3.2 `KIND_LABEL`: the four kinds as words, for the row's assistive-technology text (`Assigned`, `Commented`, `Mentioned`, `Digest`)
- [ ] 3.3 A pure `unreadRows(rows)` (or equivalent) for the lens — filtering stays in the pure model so it is unit-testable without a client
- [ ] 3.4 `groupNotifications` is **unchanged** — same buckets, same order, same labels

## 4. The kind glyphs (`apps/web/src/notifications/kind-glyph.tsx`, new)

- [ ] 4.1 Four drawn glyphs — assigned, commented, mention, digest — transcribed from the mock's `<symbol>` paths: 20-unit viewBox, stroke-width 1.6, `currentColor`, `fill="none"` except the assigned glyph's landing disc. No `lucide`
- [ ] 4.2 The settled-loop glyph for the empty state (the mock's `g-todo`), at the mock's 34px
- [ ] 4.3 Every glyph `aria-hidden`; the kind reaches assistive technology as text on the row (task 5.4)

## 5. The destination (`apps/web/src/notifications/inbox-view.tsx`)

- [ ] 5.1 Masthead: `title="Inbox"`, mono unread `count` (suppressed while the result is incomplete), the `All` / `Unread` lens in the `lens` slot, `Mark all read` in `actions` — **absent** when nothing is unread, keeping `data-testid="inbox-mark-all-read"` when it renders. The `BellIcon` goes. The error line keeps `role="alert"` in `meta`
- [ ] 5.2 The lens: local state, filtering already-synced rows through the model's pure filter. No query, no search param, no round trip. Both positions are real controls with accessible names, and the current one is marked (`aria-pressed` or equivalent), never by colour alone
- [ ] 5.3 The day bands: `--density-group-header`, `bg-bg-hover`, `border-t border-row-hairline` — the issue list's group header. **No count on the band**
- [ ] 5.4 The row, at `--density-row`, one line, in the mock's column order: gutter disc · kind glyph · mono key (`w-[62px]`, reserved and empty for a digest) · title (`subjectTitle`, truncating) · spring · cross-team tag · phrase · mono age (`formatRelative` from `@/issues/model`, the one age measure). Keep `data-testid="notification-row"` and `data-read` **verbatim**. The kind reaches assistive technology as a visually hidden word; the `Read` / `Unread` word stays
- [ ] 5.5 Read / unread on three channels, none of them hue: the gutter disc, the title's weight, the title's ink. The read row's phrase stays `--text-2`, not the mock's `--text-3` (design D3 — a channel that misses AA is not a channel)
- [ ] 5.6 The cross-team tag: resolve `row.teamId` against the already-synced `queries.teams.all()`. Drawn only when the reader belongs to more than one team; a team the list cannot name draws no tag rather than an id (design D5). **No `.related('team')`, no query change**
- [ ] 5.7 The legend footline: `j` `k` move · `⏎` open · `e` read, in the mock's register, `aria-hidden` (the keys are real bindings, and the row carries `aria-keyshortcuts`)
- [ ] 5.8 The empty state (design D8): the settled loop at 34px, `Nothing waiting`, the four kinds in mono, and the two doorways (Issues · Home) as real links. Never drawn while the result is incomplete
- [ ] 5.9 One persistent `sr-only` `role="status"` outside the conditional whose TEXT changes; the drawn states carry no role of their own
- [ ] 5.10 The keyboard model survives verbatim: `j`/`k`/arrows move, `⏎` and `→` open and mark read, `e`/`E` toggles, the cursor stays anchored to row identity, and moving through a **filtered** list cannot point the cursor at a row that is not drawn
- [ ] 5.11 Word diet: no explanatory sentence anywhere on the page. Loading and empty states are labels
- [ ] 5.12 Nothing joins the subject: no status glyph, no reality track, no second query. Confirm by reading the finished file
- [ ] 5.13 `apps/web/src/routes/inbox.tsx`: `measure="full"`

## 6. Tests

- [ ] 6.1 `packages/schema` unit (`copy.test.ts`) — the four phrases, the digest phrase naming no actor, the unknown-actor fallback reaching `phrase` for the three actor kinds and never for the digest, and `title` / `summary` unchanged for all four (the email seam must be provably untouched)
- [ ] 6.2 `apps/web` unit (`model.test.ts`) — `phrase` on the row data, the kind labels, the pure unread filter, and `groupNotifications` unchanged
- [ ] 6.3 `apps/web` component (`inbox-view.test.tsx`) — **the falsifiable check**: a `pm_digest_published` row draws the stored `subjectTitle` as its title, `Shared with you` as its phrase, an empty key column and the digest kind as text; and an `issue_commented` row draws the stored issue title as its title with `<actor> commented` as its phrase. On today's `main` the row's title is the full sentence and no phrase element exists, so this fails
- [ ] 6.4 `apps/web` component — read/unread: an unread row draws the gutter mark and a semibold title, a read row draws neither, both expose `data-read` and the `Read`/`Unread` word, and the assertion is made on structure rather than on colour
- [ ] 6.5 `apps/web` component — the lens: `Unread` narrows the drawn rows to the unread ones, the masthead count does not change, no additional query is issued, and the cursor cannot land on a row the lens removed
- [ ] 6.6 `apps/web` component — the empty state renders the settled mark, `Nothing waiting`, the four kind words and the two doorways **only** when the result is complete; an incomplete result says it is loading; one live region carries both, and neither renders an explanatory sentence
- [ ] 6.7 `apps/web` component — `Mark all read` is absent at zero unread and present (with its test id) when something is unread
- [ ] 6.8 `apps/web` component — the degenerate states, each asserted rather than assumed: one row; a row whose stored title is 300 characters (truncates on one line, does not wrap or push the age column off); a digest row (no key, no actor); a row whose team is not in the synced team list (no tag, no id)
- [ ] 6.9 Extend `packages/ui/src/styles/contrast.test.ts` in **every** theme block, light and dark — **appended as a clearly delimited block at the END of the file**, never edited into the middle (this file has already produced one cross-branch conflict in this series): the unread gutter disc on `--bg` and on `--bg-selected` (3:1 non-text), the read row's title and phrase ink on both grounds (AA normal), the day band's ink on `--bg-hover`, the mono age and the empty state's mono kind line recorded honestly against the bar, and the empty state's settled loop against the page ground
- [ ] 6.10 Update `apps/web/e2e/notifications.spec.ts` where the surface moved: the row's word assertions become the phrase (`<ADMIN> assigned you`, `<ADMIN> commented`) plus the issue title as the row's title. The `notification-row` / `data-read` / `inbox-badge` contracts and the `confidential`-absent assertion are kept **verbatim**. **Never weaken an assertion to make a gate pass**
- [ ] 6.11 Re-run any e2e failure once before investigating, and confirm the signature: the known multi-context flake is `browserContext.close: Protocol error (Target.disposeBrowserContext)` at `projects.spec.ts:188`, `:246`, `pm-digest.spec.ts:306` — tracked separately, not this change's to fix or loosen. Any OTHER failure, and any failure that is an assertion disagreeing rather than that timeout, is this change's
- [ ] 6.12 Confirm no test hard-codes a budget encoding e2e fixture size, and no test's premise is what a given Node runtime provides (CI is Node 24; dev machines here run 26)

## 7. Render and look

- [ ] 7.1 Bring the app up at 1440×900 over a seeded account and screenshot `/inbox` populated; compare against `inbox.png` frame A and record every deliberate difference in `design.md`
- [ ] 7.2 Screenshot and **look at** the degenerate states, one image each — an inbox with ONE item, an inbox with FIFTY, an item whose stored title is very long, a `pm_digest_published` item, and the empty state. This is the pass that catches the class of defect Triage shipped (a panel reserving its full measure over nothing); a test passing is not this
- [ ] 7.3 Screenshot the empty state against `inbox.png` frame B
- [ ] 7.4 Check the page in all three themes, light and dark, and confirm nothing reads as a hole, a collapsed row or an unfilled reserved slot
- [ ] 7.5 Confirm the masthead count and the deck badge state the same number on the same screen

## 8. Documentation

- [ ] 8.1 Update `apps/docs/src/content/docs/features/notifications.md`: the row anatomy left to right, the four kinds and their glyphs, **why no subject status is drawn** (the permission boundary, not a simplification), the two lenses, the empty state, and the complete keyboard model
- [ ] 8.2 Update `README.md` where it describes the inbox surface (line ~247)
- [ ] 8.3 Confirm `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md`, `PROCESS.md` and every `reference/` page are untouched by this change and therefore not stale (PROCESS.md §2). **Do NOT edit `ROADMAP.md`** — parallel builds; the maintainer adds the row at archive time
- [ ] 8.4 `pnpm --filter @yapm/docs build` passes
- [ ] 8.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — including everything that diverged from `inbox.html` and why, and any deliberate removal of a shipped capability

## 9. Gates

- [ ] 9.1 `pnpm turbo lint typecheck test build`
- [ ] 9.2 The compose smoke test
- [ ] 9.3 The full Playwright suite
- [ ] 9.4 If the PR is behind `main` at merge time, rebase onto `main` and re-run 9.1–9.3
