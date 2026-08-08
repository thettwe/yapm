## 1. Read the rulebook first

- [x] 1.1 Read `design-explorations/overhaul-2026-08/northstar/issue.html` and `issue-full.png`; read `NORTHSTAR.md` (the `issue.html` row of the assembly table, §"Consistency check", §"The word diet", the `issue.html` self-critique) and `ia.html` (§"The word diet" — mono sublines live on the detail; §"Provenance"; §"Two patterns, drawn once")
- [x] 1.2 Read `reference/zero.md` (Zero 1.x — `defineQuery`/`defineQueries`/`createBuilder`, never the 0.x names) plus the Tailwind 4.3 and TanStack Router references
- [x] 1.3 Read the surfaces this change consumes and must NOT rebuild: `packages/ui/src/components/{reality-track,rest-phrase,provenance-mark,status-glyph,priority-mark,detail-field,peek}.tsx` and their stories, `apps/web/src/frame/masthead.tsx`, `apps/web/src/frame/command-registry.tsx`
- [x] 1.4 Read `packages/schema/src/zero/{delivery.ts,phrases.ts,team-home.ts,queries.ts,schema.ts}` — exactly which facts exist, and the two limits (`ci_check` has no start/finish times; there is no review-requested event)
- [x] 1.5 Read `apps/web/src/issues/{issue-detail.tsx,delivery.ts}` and `apps/web/src/routes/teams.$teamId.issues.{$issueKey,index}.tsx` — the capabilities that must survive, and the key-resolution wart

## 2. The one derivation (`packages/schema`)

- [x] 2.1 New `packages/schema/src/zero/issue-timeline.ts`: `IssueMoment` (`kind`, `at`, typed facts) and `buildIssueTimeline({ issue, links, deployments, cycle }, now)` — pure, ordered, no strings beyond enum kinds (design D1)
- [x] 2.2 Emit a moment **iff** a durable timestamp supports it (design D2): created, planned-into-cycle (`cycleAssignedAt`), linked-to-change (`issue_link.createdAt` + `source`), change-opened (`openedAt`), review-submitted (each `review`), merged (`mergedAt` + `mergeCommitSha` + passed/total checks), deployed (the `mergeCommitSha ↔ deployment.sha` join). **No status-transition moment of any kind**
- [x] 2.3 Carry the review round count and the latest review state; carry NO review-requested moment and NO check duration — the age of a failing check is permitted, a duration is not
- [x] 2.4 Reuse `buildDeploymentIndex` for the deploy join; do not re-derive it
- [x] 2.5 Export from `packages/schema/src/index.ts`; confirm no table, mutator or migration was added

## 3. Resolving an issue by its key (`packages/schema`)

- [x] 3.1 `queries.ts`: `issues.byKey({ teamId, number })` — `teamScoped` + `withLinkedDelivery` + the same related subtree and `needsTriage` treatment as `issues.byTeam`, `.one()` (design D8)
- [x] 3.2 Register its query-name constant beside its siblings
- [x] 3.3 Confirm by reading the predicate that it can neither widen a read past the caller's teams nor surface a triage row the list holds back

## 4. The page (`apps/web/src/issues/issue-detail.tsx`)

- [x] 4.1 `masthead.tsx`: one additive optional `kicker` slot (the row above the title); every existing caller unchanged (design D5)
- [x] 4.2 The masthead's content on the route: breadcrumb back to Issues · mono issue key · the divergence pill from the shared dictionary (text, never colour alone) · Follow · **Mark Done ⏎**
- [x] 4.3 The two-register subline (design D4): the plain line (status arc + status · cycle · labels · `sayRestPhrase(..., 'neutral')`) above the mono fact line (merge sha · PR number · drift age) with the provenance mark under the dictionary's existing rule — both from ONE signal computation
- [x] 4.4 The delivery rail: mount `RealityTrack orientation="vertical"` with `surface` declared, one station per timeline moment, each with its sentence and mono fact; header states `idea → built → live`; **no designed station** (design D3)
- [x] 4.5 The divergence callout (design D6): the sentence, the mono evidence line contrasting `lastHumanStatusAt` with the merge, and the two actions — Mark Done through the existing `mutators.issue.setStatus`, Keep as is dismissing locally with no write and no suppression of the pill, break or phrase; ⏎/esc bound inside the callout's focus scope, never on `document`
- [x] 4.6 The activity feed over the SAME timeline (design D2): created · planned into cycle · linked to a change (naming the link source) · change opened · reviews · merged · deployed. Assert by reading that no status transition is rendered
- [x] 4.7 Referenced in (design D7): linked changes with their link source, plus what is already anchored to the issue; **folds away entirely** when there is nothing — no header, no empty state, no new query
- [x] 4.8 The document column: description (existing rich-text editor, autosave, mentions, image attachments), Files, Comments with the composer and its `⌘↵` hint — every one preserved
- [x] 4.9 The properties block: Status, Priority, Assignee, Cycle, Labels, Updates/Follow; the `Delivery` field is removed because the rail states it at full measure (design D10); the mock's `Design` property folds
- [x] 4.10 `IssueDetailBody` takes `layout: 'page' | 'sheet'` and both render the same sections (design D9); `?open=<issueId>` keeps working unchanged
- [x] 4.11 Register this surface's commands with the frame's `⌘K` owner; bind no global listener

## 5. The route (`apps/web/src/routes/teams.$teamId.issues.$issueKey.tsx`)

- [x] 5.1 Parse the segment as `<TEAMKEY>-<number>` (matched against THIS team's key) or a bare `<number>`; anything else is not-found (design D8)
- [x] 5.2 Resolve through `issues.byKey`; delete the `issues.byTeam` sync and the linear scan
- [x] 5.3 Keep loading distinguishable from missing — not-found only once the result is complete
- [x] 5.4 Confirm the sheet's "open full view" link still resolves

## 6. Tests

- [x] 6.1 `packages/schema` unit — **the falsifiable check, part one**: `buildIssueTimeline` over a fixture with cycle assignment, a branch-sourced link, an opened PR, two reviews, a merge with 14/14 checks and no deployment emits exactly those moments in order, emits **no** status-transition moment even when `lastHumanStatusAt` is set, and emits no check duration
- [x] 6.2 `packages/schema` unit: the deploy join — a deployment carrying the merge commit yields the live moment; one carrying only the head commit does not
- [x] 6.3 `packages/schema` integration (pg, `describe.skipIf(DATABASE_URL === undefined)`): `issues.byKey` returns empty for a non-member, and a member of team A cannot resolve team B's `(teamId, number)` — the same scoping assertions its siblings carry
- [x] 6.4 `apps/web` component — **the falsifiable check, part two**: render the detail over the mock's ENG-116 case (in progress, merged, checks green, undeployed) and assert the plain line and the mono line state the same facts, the rail draws idea/change-opened/reviewed/merged/not-live-yet with fact lines and **no designed station**, and the feed contains no status transition
- [x] 6.5 `apps/web` component: the callout — Enter marks done through the shared mutator (optimistically), Escape dismisses while the pill, the `//` break and the phrase all remain, and a viewer is offered no action that writes
- [x] 6.6 `apps/web` component: every surviving capability still works in both layouts — description editing and autosave, mentions, file upload, comment post/edit/delete, status/priority/assignee/cycle/labels, follow
- [x] 6.7 `apps/web` component/route: key resolution — `ENG-116` resolves, a bare `116` resolves, `OPS-116` in team ENG is not-found, and loading is distinguished from missing
- [x] 6.8 Extend `packages/ui/src/styles/contrast.test.ts` with this page's pairs — mono subline ink, rail fact lines on the rail's surface, callout ink on its tinted ground, divergence pill ink — in **every** theme block, light and dark
- [x] 6.9 E2E: update the specs that drive the issue detail (`issues.spec.ts` and any sibling using the detail panel) for the new anatomy; add the keyboard divergence flow (open a diverged issue, ⏎ marks done) as the big-feature rule requires. **Never weaken an assertion to make a gate pass**; derive any bound from the page, never from a hard-coded fixture size

## 7. Documentation

- [x] 7.1 New `apps/docs/src/content/docs/features/issue-detail.md`: the page anatomy top to bottom, the two registers and why the mono one lives only here, each rail station and the exact fact it is derived from, the callout's two actions and what "keep as is" does not do, the activity feed's sources, and **the four blocks that fold away and why** (design artefacts, status history, backlinks, PR comment counts)
- [x] 7.2 Update `features/reality-vocabulary.md` (the vertical rail has a consumer; stations fold; one derivation), `features/delivery-signals.md` (where the deploy join is stated on the issue), `features/issue-list.md` (the sheet and the page share one body)
- [x] 7.3 Update `README.md` and `ROADMAP.md` (this change's status row); confirm `.env.example`, `TECHSTACK.md`, `PROCESS.md` and every other root doc are untouched by this change and therefore not stale (PROCESS.md §2)
- [x] 7.4 `pnpm --filter @yapm/docs build` passes
- [x] 7.5 Record every decision taken during the build in `design.md` under "## Decisions made during implementation", including everything that had to diverge from `issue.html` and why

## 8. Gates

- [x] 8.1 `pnpm turbo lint typecheck test build` — pass on CI run 31252600592 (2m9s)
- [x] 8.2 The compose smoke test — pass on CI run 31252600592 (4m33s)
- [x] 8.3 The full Playwright e2e suite — pass on CI run 31252600592 (22m19s)
- [x] 8.4 `npx -y @fission-ai/openspec@latest validate issue-detail-bridge` clean, and every scenario in this change's specs walked against the built surface
