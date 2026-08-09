## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/destinations/triage.html` end to end **including its closing comment** (§"What folded, and why", §"Decision made here, beyond the shipped mutator", §"Self-critique"), and look at `triage.png` and `triage-full.png`
- [x] 1.2 Read `destinations/DESTINATIONS.md` (the `triage.html` row, §"What the render showed" items 2–4) and `northstar/ia.html` (§"The word diet", the band-2 anatomy, transients-never-destinations)
- [x] 1.3 Read `northstar/issues.html` — the row anatomy this page must line up with, column for column
- [x] 1.4 Read `reference/zero.md` (Zero 1.x — `defineQuery` / `defineMutator` / `createBuilder`; the 0.x names are non-functional) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.5 Read the surfaces this change consumes and must NOT rebuild: `packages/ui/src/components/{issue-row,reality-track,status-glyph,priority-mark,provenance-mark,peek,how,drawn,avatar,popover}.tsx`, `apps/web/src/frame/masthead.tsx`, `apps/web/src/issues/issue-list.tsx` (the row's wiring), `apps/web/src/issues/attachments/files-section.tsx`
- [x] 1.6 Read `packages/schema/src/zero/{queries.ts,mutators.ts,team-home.ts,ai-tools.ts}` — `triage.inbox`, `routeIssue`, `setIssueProject` (the permission story D1 copies), `buildAttention` (the one attention number), and the derived agent-tool registry

## 2. `issue.routeIssue` gains `projectId` (`packages/schema`)

- [x] 2.1 `routeIssueArgs`: add `projectId: z.string().min(1).nullable().optional()`
- [x] 2.2 `routeIssue`: when `projectId` is a non-null string, run the same existence check `setIssueProject` runs (workspace-level, **no** cross-team rejection — a project spans teams), throwing `MutationErrorCode.crossTeam` with `'Project not found'`
- [x] 2.3 Fold `projectId` into the single existing atomic `issue.update` — routing stays one write, and `needs_triage` is cleared in the same statement
- [x] 2.4 Comment the branch with the one constraint the code cannot express: why the project is existence-checked rather than team-checked (design D1)
- [x] 2.5 Confirm nothing else moved: no new table, no migration, no new named query, no change to `canWrite` / `loadIssueForWrite` ordering
- [x] 2.6 Update the `ai-tools` expectation for the derived `issue.routeIssue` tool to include the new field, at its existing `write` risk class — update the expectation, never loosen the assertion

## 3. The row (`packages/ui`)

- [x] 3.1 `issue-row.tsx`: one optional prop overriding **only** the trailing avatar's announced name (`title` / `aria-label`), defaulting to the person's name (design D5). Initials still derive from the name; no visual change to any existing surface
- [x] 3.2 `issue-row.stories.tsx`: a Triage case — reserved-empty reality slot, empty phrase slot, `created_at` age, reporter avatar — so the two row registers are visible side by side

## 4. The Triage destination (`apps/web/src/triage/triage-view.tsx`)

- [x] 4.1 Masthead: `title="Triage"`, mono `count`, and `oldest first` in the actions slot — the team name goes. `oldest first` is not rendered when the queue is empty. The error line keeps its `role="alert"` in `meta`
- [x] 4.2 The queue: render every waiting issue through `IssueRow` **unwrapped** — no flex shell, no bolted-on action cluster — with the reality slot reserved and empty, the phrase slot empty, `date` from `created_at`, labels as dot + name, and the reporter in the trailing avatar with its honest announced name
- [x] 4.3 The decision panel, unfolded in place below the focused row: the issue's description via the shared read-only rich-text renderer, a mono `<reporter> · <created-at>` line, and each attachment as an upload chip read from the existing `attachments.byIssue` synced query (mounted only for the issue under decision, so the hook is unconditional)
- [x] 4.4 The verdict rail: `[A] Accept`, `[R] Route`, `[D] Decline` as real buttons whose accessible names are the words, each drawing its keycap; `Decline` states where it lands (the canceled mark). Keep `data-testid="triage-accept" | "triage-route" | "triage-decline"` **verbatim** — four e2e viewer assertions depend on them
- [x] 4.5 The rail's key hint: `⏎ Open · J K Move`, in the mock's register
- [x] 4.6 The route transient (design D4): replaces `RouteDialog`. A labelled panel naming the issue, five rows — Status, Assignee, Cycle, **Project**, Labels — each showing the value routing will write (`none` where nothing is set); keyboard-operable; `⏎` commits one `issue.routeIssue`; `esc` closes writing nothing; focus returns to the row it opened from. Keep an explicit accessible role and name so e2e can address it by role
- [x] 4.7 Wire `projectId` through the transient into `routeIssue`, reading `queries.projects.all()` for the options
- [x] 4.8 The empty state (design D7): the done disc at the mock's size, `Nothing waiting.`, and the onward foot (Issues · Cycles · Projects, `⌘K goes anywhere`) — all `role="status"`. Distinguish it from the incomplete-query state, which says `Loading…`, so a premature all-clear is never announced
- [x] 4.9 The keyboard model survives intact: `j`/`k` and arrows move (and move the unfolded panel with them, design D3), `⏎` opens, `a`/`r`/`d` fire the verdicts, every one gated on `canWrite`; `esc` closes the transient. The frame owns ⌘K — this surface binds no listener of its own
- [x] 4.10 Word diet: no explanatory sentence renders anywhere on this page. Loading, empty and team-missing states are labels
- [x] 4.11 Verify the count: the masthead's number is the length of the same `triage.inbox` result `buildAttention` counts — one derivation, no second cap

## 5. Tests

- [x] 5.1 `packages/schema` unit (`mutators.triage.test.ts`) — **the falsifiable check, part one**: `routeIssue` with `projectId` sets `project_id` and clears `needs_triage` in one write; a project that exists in the workspace but belongs to another team's issues is accepted (no cross-team rejection); an unknown project id is rejected and nothing is written; `projectId: null` clears the project; omitting the field leaves `project_id` untouched
- [x] 5.2 `packages/schema` unit: a viewer's `routeIssue` with a `projectId` is still rejected before existence is revealed — the new field does not open a path around `canWrite`
- [x] 5.3 `apps/web` component (`apps/web/src/triage/triage-view.test.tsx`) — **the falsifiable check, part two**: the masthead reads `Triage` plus the mono count and does **not** contain the team's name; the head of the queue is unfolded and its panel shows the issue's description text, a mono line naming the reporter and the created-at, and an attachment chip; each of the three verdicts is a named button rendering its key
- [x] 5.4 `apps/web` component: moving the keyboard selection moves the unfolded panel, and the verdict fired by `a` acts on the newly unfolded issue — the panel and the keys can never name different issues
- [x] 5.5 `apps/web` component: the row anatomy matches the list's — the reality slot renders reserved and empty, the age column states `created_at` (not `updated_at`), the trailing avatar announces the reporter, and no control is rendered outside the row
- [x] 5.6 `apps/web` component: the empty state renders the done mark and `Nothing waiting.` with `role="status"` **only** when the query result is complete; an incomplete result says `Loading…`; neither renders an explanatory sentence, and `oldest first` is absent over an empty queue
- [x] 5.7 `apps/web` component: the route transient lists exactly the five fields routing writes, commits one mutation with all five on `⏎`, writes nothing on `esc`, and returns focus to the row it opened from; a viewer gets no transient at all
- [x] 5.8 Extend `packages/ui/src/styles/contrast.test.ts` with this page's pairs in **every** theme block, light and dark: the decision panel's ink on its tinted ground, the keycap ink and keycap border on that ground, the armed keycap's accent treatment, and the empty state's done disc against the page ground
- [x] 5.9 Update `apps/web/e2e/triage.spec.ts` selectors where the surface moved — the masthead heading, and the route transient's role and name in the route and viewer tests. The three `triage-*` test ids are preserved so the viewer's read-only assertions hold verbatim. Extend the route test to set a project and assert it landed. **Never weaken an assertion to make a gate pass**
- [x] 5.10 Re-run any e2e failure once before investigating: the known multi-context flake (`projects.spec.ts:188`, `:246`, `pm-digest.spec.ts:306`, signature `browserContext.close: Protocol error`) is tracked separately and is not this change's to fix. Any OTHER failure is
- [x] 5.11 Confirm no test hard-codes a budget encoding e2e fixture size, and no test's premise is what a given Node runtime provides (CI is Node 24; dev machines here run 26)

## 6. Documentation

- [x] 6.1 Update `apps/docs/src/content/docs/features/triage.md`: the row anatomy left to right and why the reality slot is blank, the decision panel's three facts, the three verdicts and their keys, what routing writes (**now including project**), the empty state, and the complete keyboard model
- [x] 6.2 Update `features/projects.md` if it enumerates what writes `project_id` — routing is now a second path
- [x] 6.3 Update `README.md` and `ROADMAP.md` (the change's status row); confirm `.env.example`, `TECHSTACK.md`, `VISION.md`, `DESIGN.md` and the `reference/` pages are untouched by this change and therefore not stale (PROCESS.md §2)
- [x] 6.4 `pnpm --filter @yapm/docs build` passes
- [x] 6.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation" — including anything that had to diverge from `triage.html` and why

## 7. Gates

- [x] 7.1 `pnpm turbo lint typecheck test build` *(green on CI run 31284019844, 2m38s)*
- [x] 7.2 The compose smoke test *(pass on CI run 31284019844, 4m39s)*
- [x] 7.3 The full Playwright suite *(pass on CI run 31284019844, 21m32s — no flake this run)*
- [x] 7.4 Render the built page at 1440×900 over a seeded team and compare it against `triage.png` / `triage-full.png`; record every deliberate difference in `design.md` *(DONE: rendered at 1440x900 over a seeded team. Matches the mock — masthead is "Triage 4 / oldest first" with no team name, head row unfolds in place, verdicts are keyed A/R/D with the canceled glyph, quiet rows lay down no reality ink. ONE DEFECT FOUND, recorded as a follow-up: with no description on the head issue the decision panel still reserves its full measure and renders as a large empty box — it needs to collapse or say something honest when the issue has no words of its own.)*
