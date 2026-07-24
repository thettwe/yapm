## Context

workspace-auth established the membership graph (`workspace` → `team` ← `team_membership` → `user`) and the row-level sync pattern in `packages/schema`: server-controlled synced queries deny by empty `or()`, drive every predicate off the verified `ctx` (`{userID, role}`), and check authorization before existence. It also left a reusable `teamScoped` helper and the `canWrite`/`canManage`/`isMember`/`isAuthenticated` context predicates. design-system shipped the tokenized `issue-row` primitive (with `realityStrip` and `divergenceFlag` slots and a placeholder unlinked state), the `command-palette` (`cmdk`) shell, `status-glyph`, and `priority-mark`.

issue-core is the first change to write **product work data**. It must (a) model issues/labels/comments/saved-views as team-scoped work-graph entities inheriting the workspace-auth permission story, (b) mint a per-team human number that the optimistic client cannot know, (c) build the reality-strip/divergence seam and reality-aware filter architecture now while shipping zero git data, and (d) deliver a sub-100ms keyboard-first list, wired palette, and detail surface strictly against the tokenized components and the Warm mockups.

The stack postdates model training: all Zero, TipTap, TanStack, Kysely, and Tailwind APIs are taken from `reference/*.md` and the installed `.d.ts`, not memory. zbugs (Rocicorp's own Zero bug tracker) is the closest reference implementation and its `issue`/`comment`/`label`/`issueLabel` schema, `shortID` pattern, and `createServerMutators` override are used directly.

## Goals / Non-Goals

**Goals:**

- One team-scoped `issue` entity with fixed status categories, priority, assignee, TipTap description, labels, and comments, all written through shared `packages/schema` mutators.
- Server-authoritative per-team issue number under optimistic creation, with a settled pending state — no client ever invents a number.
- A reality-strip + divergence-flag data seam and a reality-aware filter/view model that `github-sync` can populate without schema or UI churn — but no empty reality views shipped now.
- A keyboard-first grouped list, a palette wired to real mutators, and a detail panel, all sub-100ms and fully pointer-free.
- No regression to foundation, workspace-auth, or design-system; the drift test grows to the new synced tables.

**Non-Goals:**

- Any git/PR/CI/deploy data or the connector framework (change 8), board view (change 4), cycles/triage/projects (later), estimates/sub-issues (deferred), the blocked-on axis (deferred), Yjs collaboration (deferred), and server-side FTS at scale.
- Manual drag-reordering / a `sort_order` column — belongs to board-view.
- Configurable statuses or custom issue types — VISION explicitly refuses Jira-style configurability.

## Decisions

### D1 — Per-team issue number: server-only mutator pass over a non-synced counter

**Choice.** The `issue` PK is a client-minted UUIDv7 (constraint #4). The human number is `issue.number` — an integer, **nullable**, modeled in Zero as `number().optional()` (exactly zbugs' `shortID`). The shared client `issue.create` mutator inserts the row **without** a number (omitted → Postgres default `NULL`). A **server-only** mutator override (`createServerMutators`, the `defineMutators(base, overrides)` mechanism, §5.7 of reference/zero.md) runs the shared create, then, in the same authoritative transaction, atomically claims the next number for the team and writes it back via `tx.mutate.issue.update({id, number})`.

The counter lives in a dedicated `issue_sequence` table (`team_id` PK, `next_number` bigint default 1) that is **in the Kysely `DB` interface and migrations but NOT in the Zero schema**, so counter churn never replicates to clients. The claim is a single atomic statement through the raw-SQL escape hatch (`tx.dbTransaction.wrappedTransaction`, §5.8): `INSERT INTO issue_sequence (team_id, next_number) VALUES ($1, 2) ON CONFLICT (team_id) DO UPDATE SET next_number = issue_sequence.next_number + 1 RETURNING next_number - 1`. The row lock serializes concurrent creates per team; different teams never contend.

**Optimistic behavior.** On the client, `number` stays `null` after the optimistic insert (client reads are local and never see the server value; a number generated client-side would corrupt on rebase — constraint #4). The list and detail render the key as **pending** (team key + a quiet pending glyph, not a fabricated number). When the authoritative row replicates back, `number` populates and the key settles with no reload.

**Alternatives rejected.** (a) A per-team Postgres `SEQUENCE` created by DDL at team-creation time — runtime DDL is awkward, non-transactional with the insert, and leaks numbers on rollback. (b) A counter column on the `team` row — every issue insert would dirty the team row and replicate that churn to all members over Zero. (c) `MAX(number)+1` per team — races under concurrent creates. The dedicated non-synced counter row is the least-surprising, contention-isolated option.

### D2 — Reality-strip / divergence seam: computation over (future) linked entities, not columns on `issue`

**Choice.** issue-core adds **no** git-shaped columns to `issue` (no `pr_state`, no `ci_status`). In the work graph, delivery reality is a set of **linked entities** (issue ↔ PR ↔ CI run ↔ deploy) owned by `connectors`, not denormalized fields on the issue. The seam is therefore a **pure computation**, defined in `packages/schema`:

```
computeDeliverySignal(issue, linked): DeliverySignal | null   // linked is empty in issue-core → always null
computeDivergence(status, signal): DivergenceKind | null      // signal null → always null (dormant)
```

`DeliverySignal` and `DivergenceKind` are typed now (the shape the reality strip renders: PR state, CI health, review age); the functions return `null` for every issue because no linked entities exist. The `issue-row` slots (`realityStrip`, `divergenceFlag`) are fed by these functions; `null` renders the existing quiet "not linked" placeholder and the dormant flag. When `connectors` lands the linked-entity tables, only these two functions and their inputs change — the row, the list, the filter model, and every query are untouched.

This honors "nullable link fields now, computation seam for later" by making the *derived state* nullable and dormant rather than reserving speculative columns that would be the wrong (denormalized) model. Logged explicitly because the phrase could be read as "add nullable PR columns"; we deliberately did not.

**Alternative rejected.** Nullable `linked_pr_id` / `ci_status` columns on `issue` — denormalizes the work graph, forces schema churn when the real edges arrive, and can't represent multiple linked PRs. Rejected in favor of the computation seam.

### D3 — Reality-aware filter/view model: two-axis typed predicate, only intention axes populated

**Choice.** A filter is a typed, structured object (a discriminated set of predicates), not free SQL:

```
IssueFilter = {
  // intention axes — queryable today
  status?: IssueStatus[]; priority?: IssuePriority[];
  assigneeIds?: (string | null)[];   // null = unassigned
  labelIds?: string[]; text?: string;
  // reality axis — RESERVED, resolves empty in issue-core
  delivery?: DeliveryPredicate[];    // 'blocked-on-review' | 'failing-ci' | 'merged-not-deployed' | ...
}
```

The evaluator has two halves: **intention predicates** filter the synced issue rows client-side (instant, sub-100ms over a team's small row set); **reality predicates** run through `computeDeliverySignal` and today match nothing (signal is always null), so a filter that sets only `delivery` yields an empty list by construction — which is why we ship no default reality views. Sorting is a typed key (`status` | `priority` | `assignee` | `updated` | `created` | `number`) + direction. Grouping is `status` (default) | `assignee` | `priority` | `label` | `none`.

A `saved_view` persists `{name, filter, grouping, sort}` as jsonb. When `github-sync` teaches `computeDeliverySignal` to return real signals, the reserved `delivery` predicates light up and new views become addable — no model change.

**Why client-side filtering.** For 2–20-person teams a team's issues are a small synced set; local filtering guarantees the sub-100ms budget and works offline. Server-side FTS is deferred; `text` today is a local case-insensitive title/identifier contains-match.

### D4 — Rich text (description + comment body) stored as TipTap JSON in jsonb

**Choice.** `issue.description` and `comment.body` are TipTap-v3 documents stored as **jsonb** (Zero `json().optional()` / `json()`), the canonical TipTap representation — round-trips without an HTML sanitization step on render. Editing is last-write-wins through the shared mutator (Yjs collaboration is deferred). A plain-text projection for FTS is deferred with server-side search.

**Alternative rejected.** Storing serialized HTML strings (as zbugs stores markdown) — needs sanitization on every render and loses structural fidelity. jsonb is the honest TipTap shape and Zero maps `jsonb → json` cleanly (reference §9.1).

### D5 — Entity → team binding and the sync/permission story

Every work entity is team-scoped and reuses the workspace-auth pattern (deny-by-empty, ctx-driven, auth-before-existence):

| Entity | Work-graph placement | Read (sync) | Write |
|---|---|---|---|
| `issue` | hangs off `team` (the tracking root) | members of the issue's team (`whereExists('team', t => t.whereExists('members', m => m.where('userId', ctx.userID)))`) | `canWrite` members/admins of the team; viewers never |
| `label` | hangs off `team` | team members | `canWrite` |
| `issue_label` | edge `issue`↔`label` | via the issue's team scope | `canWrite`; validates label and issue share a team |
| `comment` | hangs off `issue` | via the issue's team scope | author is `ctx.userID`; edit/delete own-or-admin (`assertIsCreatorOrAdmin`) |
| `saved_view` | hangs off `team` (shared, team-visible) | team members | `canWrite` create/edit; delete creator-or-admin |
| `issue_sequence` | server-only counter off `team` | **never synced** | server mutator only |

The existing `teamScoped` helper is generalized to accept any table that has a `team` relationship (not just `team_membership`). Assignee changes validate the assignee is a member of the issue's team.

### D6 — Fixed statuses/priorities; ordering is derived

`IssueStatus = backlog | todo | in_progress | in_review | done | canceled`; `IssuePriority = no_priority | low | medium | high | urgent`. Stored as Postgres enums with a `CHECK`/enum column (matching the design-system tokens; `canceled` is the one new status glyph the component library must gain). The list groups by status in that fixed category order; within a group the default sort is `priority` desc then `updated` desc. No manual `sort_order` (board-view territory). Status/priority are **not** configurable (VISION anti-Jira stance).

### D7 — Palette + list actions invoke the same shared mutators

The command palette and the list keyboard shortcuts are thin action layers over the shared mutators (`issue.create`, `issue.setStatus`, `issue.assign`, `issue.addLabel`/`removeLabel`, `issue.setPriority`). Actions are scoped to the focused row (list) or selected set (multi-select via `x`) or the open issue (detail). This keeps every write on the single client+server mutator path (constraint #2) and guarantees optimistic sub-100ms application.

## Risks / Trade-offs

- **[Optimistic pending number could confuse users]** → the pending key is a distinct, quiet visual (team key + pending glyph), never a fake number; it settles automatically on replication; a scenario covers it. Copy/link actions are disabled until the number settles.
- **[Server-only mutator override drift]** → the shared `issue.create` and the server override are both in `packages/schema`; a unit test asserts the client path leaves `number` null and the server path assigns a monotonic per-team value; the drift test covers `issue_sequence` in the Kysely `DB` map while excluding it from Zero introspection.
- **[Client-side filtering assumes a small synced set]** → true for the 2–20-person target; if a team's backlog grows large, filtering stays local but preload TTLs and a server-side path can be added later without changing the filter model (D3). Documented as a deferred scale concern.
- **[Reserved `delivery` axis shipping visibly empty]** → mitigated by shipping **no** default reality views and hiding reality filter chips until `github-sync`; the axis exists in types/model only, verified by a test that a delivery-only filter yields empty.
- **[jsonb description not FTS-searchable now]** → accepted; `text` filter matches title/identifier locally in v1; a plain-text projection + FTS is deferred.
- **[Zero two-level relationship-chaining limit (reference §3.3)]** → the team-membership `whereExists` is two hops (issue → team → members) which is within the limit; comment scoping goes issue → team → members via the comment's issue relationship, also within limits.

## Migration Plan

Forward-only Kysely migration `0004_issue_core` creates `issue`, `label`, `issue_label`, `comment`, `saved_view`, and `issue_sequence` (with the Postgres enum types for status/priority, FKs to `team`/`user`, the `issue_label` compound PK, and the `issue_sequence` counter). Applied automatically at boot after the existing migrations; the Zero schema and the hand-written `DB` interface are updated in lockstep and the drift test enforces agreement. No data backfill (net-new tables). Rollback is forward-only per project convention; the migration is additive and does not touch workspace-auth tables.

## Open Questions

- Whether `saved_view` should also support **user-private** views in addition to team-shared. v1 ships team-shared only (simpler, matches the "browsable team views" model); a private flag is an additive column later. Logged as a deliberate v1 narrowing.
- Whether label color should be a **token name** (theme-aware) or a raw hex. Leaning token-name-or-hex string (like `user_preference.accent`, validated by the shared `isParseableColor` plus a token allowlist) so labels stay theme-consistent; final call deferred to implementation and to be logged under "Decisions made during implementation" if it changes.

## Decisions made during implementation

### Schema phase (data model in packages/schema)

- **Status/priority stored as `text` + `CHECK`, not native Postgres enum types.** D6 said "Postgres enums with a `CHECK`/enum column"; I chose `text` + `CHECK` to match the established `role`/`theme` columns and, crucially, the drift test's `POSTGRES_TYPE_TO_ZERO` map, which maps `text → string` and has no entry for a user-defined enum type (a native enum would report an unmapped Postgres type and fail the drift test). Zero's `enumeration<IssueStatus>()` still maps to `string`, so the fixed sets are enforced in Postgres by the `CHECK` and in the mutators/Zod by `z.enum`. Configurability is still refused.

- **`team_id` denormalized onto `comment` and `issue_label`.** D5's table described `comment`/`issue_label` scoping "via the issue's team scope," but it also said to *generalize `teamScoped` to any table with a `team` relationship*. To satisfy the latter (and to mirror zbugs, which carries `projectID` on `issueLabel`), every work-data table carries a direct `team_id`, so its sync predicate is a uniform two-hop `whereExists('team', t => t.whereExists('members', …))` rather than a three-hop chain through the issue. This denormalizes a *stable* FK (an issue never changes team), not volatile git state, so D2's objection to denormalization does not apply. `teamScoped` was left as-is — it already works for any table exposing a `team` relationship.

- **Label color validated by `isParseableColor` only (hex/rgb/oklch), token-name allowlist deferred.** Resolves the D3/Open-Questions lean: labels validate exactly like `user_preference.accent` (the shared `isParseableColor`). A theme-token-name allowlist is an additive, non-breaking follow-up and is not built now (no token list is owned by the schema layer).

- **Rich text and structured filters typed for Zero's `json()` columns via `z.custom`.** `RichTextDoc`/`IssueFilter`/`IssueSort` are ordinary readonly TS interfaces and therefore not assignable to Zero's `ReadonlyJSONValue` (missing index signature). The mutator arg validators use `z.custom<ReadonlyJSONValue>` — for TipTap docs it passes the document through untouched (a `z.object` would strip unknown content nodes), and for filter/sort it wraps the real `issueFilterSchema`/`issueSortSchema` via `safeParse` so the structure is still validated while the arg type stays JSON. The Zero schema columns are plain `json()`; the precise TS types live in the Kysely `DB` interface and the app layer.

- **Server numbering exposed via a new `@yapm/schema/server` subpath.** `createServerMutators()` and `claimNextIssueNumber()` import `kysely`/raw SQL, so they live behind a dedicated export the web client never imports (the client bundles only `@yapm/schema`). `apps/server`'s `/mutate` handler now resolves mutators from `createServerMutators()` (base shared mutators + the `issue.create` override). `claimNextIssueNumber(db, teamId)` takes a bare Kysely executor so the atomic `INSERT … ON CONFLICT … RETURNING next_number - 1` is unit-testable against live Postgres (monotonic, per-team-isolated, concurrency-safe — covered by a DB-gated test).

- **Team-write authorization shape.** `canWrite` (workspace-role gate) rejects viewers, non-members, and unauthenticated callers *before any existence check*. A workspace admin may write to any team; otherwise the caller must be a member of the target team. For mutations on an existing row, the row is read and then the caller's *own* membership is checked, throwing a generic not-authorized for both "missing" and "wrong team" so a private row's existence never leaks — the zbugs `assertIsCreatorOrAdmin` pattern. Cross-team labeling and assigning a non-team-member both reject with a new `cross_team` error code.

### List phase (apps/web issue list, keyboard, palette)

- **Issue-list route is `/teams/$teamId/issues` with a full-width chrome, not `AppShell`.** `AppShell` centers content in a `max-w-3xl` column, wrong for a dense list. The issues route reuses the same header pieces (`Switcher`/`ConnectionStatus`/`ThemeControls`/`UserMenu`) but renders the list full width with its own toolbar, matching the warm mockup's main panel. The mockup's left sidebar chrome is deliberately out of the List phase (it is app-shell territory and reworking `AppShell` would risk regressing the existing routes/tests); the team-detail page gains an "Issues" link so the route is reachable.

- **"Open issue" is a typed `?open=<id>` search param on the list route, not a navigation to a detail route.** The detail route is a later phase; hard-linking to a not-yet-existing route would not typecheck under TanStack's typed router. Enter/ArrowRight/click set `search.open`, the focused row gets `aria-current`, and the detail phase reads that param to mount its panel. Forward-compatible and self-contained.

- **List keyboard shortcuts and the command palette are one surface.** `s`/`a`/`l` on the focused row (or multi-selection) and `c` open the same `cmdk` palette pre-scoped to a sub-page (status/assign/label/create), so every write flows through one action layer over the shared mutators (D7). `⌘K` opens the palette at root, reading an ambient target the list writes into a ref on focus/selection change (a ref, never state, so navigation never re-renders the list — protects the sub-100ms budget). Root palette also lists navigate/create/jump-to-issue and the context actions.

- **Roving-tabindex focus over the flattened, sorted row set.** Rows are the focus targets (only the focused index is `tabIndex=0`); `j`/`k`/arrows move focus programmatically via a `data-index` query, `x`/Space toggle selection, and the accent focus-visible ring + selection bar on the `issue-row` primitive is the visible indicator. The list region is a labelled `<section>`; shortcut keys never collide with the toolbar search because that input lives outside the region and its keydowns don't bubble in.

- **`issue-row` label dot gained an optional `color` prop.** Real labels carry arbitrary color strings (hex/rgb/oklch), which the primitive's fixed `tone` token classes can't render. Added a backwards-compatible `color?: string` that drives the dot via inline `style` when present (label data, not a hardcoded design value); the `tone` path is untouched. This is the List-phase slice of "wire the issue-row slots"; the reality-strip/divergence slots already render their unlinked/dormant defaults from the seam (always null now) with no per-row wiring needed.

- **Pending number renders as `<TEAMKEY>‑…`** (team key + a quiet ellipsis, `data-pending` on the row) until the server number replicates, then settles in place with no reload — never a fabricated number (D1).

- **Client-side filter/group/sort model built to hold the reserved reality axis.** Filtering routes through the shared `matchesFilter` evaluator (intention axes only today; the `delivery` axis resolves empty), grouping supports status (default)/priority/assignee/label/none, and sorting is the typed key+direction. No delivery/reality filter chips or default reality views are rendered (D3). Saved views persist `{filter, grouping, sort}` via the shared `savedView.create` mutator and re-apply by setting local state; the JSON filter/sort are cast to `ReadonlyJSONValue` at the call site (the same typing seam the schema phase logged).

- **Issue-list route decoupled from team-detail via an index route.** The first cut made `teams.$teamId.tsx` (team-detail, no `<Outlet/>`) the parent of the file-based `teams.$teamId.issues` child, so the issues URL rendered team-detail and the list never mounted. Both pages are full standalone surfaces (each owns its chrome), so `teams.$teamId.tsx` was renamed to `teams.$teamId.index.tsx`; the TanStack plugin now flattens both `/teams/$teamId` (index) and `/teams/$teamId/issues` as independent routes under root — no shared non-layout parent, no dead route.

- **Palette create form shields Enter/Escape from cmdk.** The new-issue composer is mounted inside `cmdk`'s `Command` root, whose global keydown handler claims Enter (item selection) and the arrows — so the form's `onSubmit` never fired and creating an issue silently did nothing. The composer's input now handles Enter (submit) and Escape (cancel) explicitly with `stopPropagation`, keeping its own semantics inside the command surface.

- **Read scope grants workspace admins workspace-wide access.** `teamScoped` filtered every work-data read by a `team_membership` row for `ctx.userID`, but the write-side `assertTeamAccess` already lets an admin write to any team without a membership row. An admin who created an issue in a team they had not joined could therefore never see it. `teamScoped` now short-circuits for admins (`canManage(ctx)`), mirroring the write bypass; members/viewers stay strictly team-scoped and non-members/unauthenticated are still denied by empty query. The queries unit test was updated to encode this.

- **Demo seed wired into first-admin bootstrap behind `SEED_DEMO_CONTENT`.** `seedDemoContent` needs a real user id and a workspace, which first exist at the first-admin bootstrap (`/api/zero/token`); it runs there when the flag is `'true'`. It is advisory-locked and one-shot (does nothing once any team exists), so it never touches a real workspace. It seeds a demo team, four labels, eight realistic issues spanning all six statuses and five priorities (numbered ENG-1…8 with `issue_sequence` advanced to 9), label edges, the admin's team membership, and one comment.

### Detail phase (apps/web issue detail surface)

- **Detail ships as BOTH a `?open=<id>` side panel and a deep-link route keyed by issue number.** The List phase left `?open=<id>` as the seam for opening an issue; that param can never carry a human number for a just-created optimistic issue (the number is server-assigned and briefly null), so the in-app open path must key off the client-minted id. The list therefore opens a right-side `Sheet` drawer (base-ui Dialog → focus trap + Escape + focus restore for free) rendered from `?open=<id>`, which works for pending issues and re-mounts after reload because the param survives the reload. Separately, a flat sibling route `/teams/$teamId/issues/$issueKey` gives the assignment's "issue key in the URL" deep-linkability: it resolves the number → id through the team-scoped `issues.byTeam` query (permission-safe) and renders the same `IssueDetail` full-page. The panel header exposes an "Open full view" link to that route, hidden while the number is pending (D1's "link disabled until settled"). Both surfaces share one `IssueDetail` component, keyed by issue id so switching issues resets local drafts.

- **Route file renamed `teams.$teamId.issues.tsx` → `teams.$teamId.issues.index.tsx`.** Adding the `$issueKey` detail route under `/teams/$teamId/issues` would have forced the existing list file to become a layout with an `<Outlet/>`, nesting the detail inside the list chrome. Following the established index-rename pattern (the same fix the List phase applied to `teams.$teamId`), the list is now the `issues/` index and the detail is a flat sibling — both independent routes under root, no shared non-layout parent. `navigate({ to: '/teams/$teamId/issues' })` still resolves to the index.

- **`Sheet` (right drawer) added to `@yapm/ui`, not `apps/web`.** The web app depends only on `@yapm/ui` and `@yapm/schema`, never on `@base-ui/react` or `@tiptap/*` directly. The detail panel's drawer is therefore a tokenized `Sheet` design-system component wrapping base-ui Dialog; likewise the web layer imports `RichTextValue` (a `JSONContent` alias) and `isRichTextEmpty` from `@yapm/ui/components/rich-text` rather than importing TipTap types, keeping the app free of direct editor-library imports.

- **Description editing is debounced (500 ms) with a flush on unmount.** The optimistic `issue.update` mutator applies instantly on every keystroke, but firing an authoritative write per keystroke floods the sync layer. `saveDescription` debounces the authoritative write and a `useEffect` cleanup flushes the pending doc when the panel closes, so a fast close never drops the last edit. Single-writer LWW per D4; Yjs is still deferred.

- **Rich text renders through a read-only TipTap editor, not `generateHTML` + `dangerouslySetInnerHTML`.** `RichTextRenderer` mounts a non-editable `useEditor` instance keyed on the value. This avoids the `noDangerouslySetInnerHtml` lint (and its XSS surface) at the cost of a ProseMirror instance per rendered doc — acceptable for the small comment threads of a 2–20-person team (D3's small-synced-set assumption). `RichTextEditor` is uncontrolled (initialised from `defaultValue`, emits `onChange`/`onSubmit`/`onCancel`), so the local-first editor state is the source of truth while editing; the parent persists.

- **Metadata controls are `PropertyButton` + base-ui `Menu`, each with a value-bearing `aria-label` (`"Status: In Progress"`).** Reuses the List phase's menu pattern (`MenuTrigger render={<Button/>}`) rather than inventing new pickers, keeping every write on the shared mutator path (D7). The explicit aria-labels make the inline controls unambiguous to assistive tech and to the keyboard-only e2e (glyph `title`s would otherwise duplicate the label text into the accessible name). Viewers get the same `PropertyButton` rendered `disabled` — read-only, no menu, no write affordance.

- **Reality strip shown in the detail as an explicit "Not linked" row.** The detail's Delivery field renders the shared `RealityStripPlaceholder` next to muted "Not linked" copy, and the header renders `DivergenceFlag` only when `computeDivergence(status, computeDeliverySignal(issue, {}))` is non-null — which is never in issue-core (empty linked entities → null, D2). The seam is wired to the same pure functions the row uses, so `connectors` lights up both surfaces with no detail-side change.

- **Detail e2e added to `issues.spec.ts`; viewer-read-only and the full three-preset matrix are left to task 8.2.** Two live-stack Playwright cases cover opening an issue to the panel, editing the description, posting a comment, and changing status from the inline control — all keyboard-reachable — with persistence verified across a reload. The full suite passes 20/20 against the dev-compose stack (postgres 5440 + zero-cache 4848, server 3210, vite 5174) with no regression to auth/sync/theme/list. The viewer-read-only-across-detail case and the all-presets-light+dark visual check remain under 8.2 (they need invite/role e2e scaffolding not yet established) and are owned by the final verification pass.

### Close phase (final verification, screenshots, task 8.2)

- **Task 8.2 closed with two new permanent Playwright cases; assign/label writes covered transitively.** `issues.spec.ts` gained (a) a preset-matrix case that loops all three presets × light/dark by seeding the `yapm:pref` cache, reloading, and asserting `data-theme`/`dark` plus the grouped `Todo` region and the row's unlinked reality strip (`aria-label="No delivery signal yet"`) in each combination; and (b) a self-contained viewer journey that mints a viewer invite, accepts it in a second browser context, joins the team for read scope, and asserts read-only across all three surfaces — list reads the issue; the detail panel shows a title heading (not a textbox), no description editor, no comment composer, and a disabled Status control; and the palette offers no change-status/assign/add-label commands (the `hasTarget && canWrite` gate). A dedicated assign/label *write* smoke was deliberately not added: `createTeam` intentionally does not auto-join its creator, so an admin `assign-to-me` would fail the team-membership validation (correct behavior) and require an extra join step to exercise a mechanism already proven by the status-change keyboard test (identical focused-row → `cmdk` sub-page → shared-mutator path) and gated by the viewer test. The suite is green at **22/22**.

- **Deterministic e2e stack ordering on a fresh volume.** Observed that on a clean `pgdata`+`zero-replica` volume, bringing up `zero-cache` before the server migrates leaves the replica snapshotting an empty schema (`SchemaVersionNotSupported: the "issue"/"team"/… table … is not one of the replicated tables`). The reliable order for a from-scratch verification run is: `up postgres` → start the server so it applies migrations (the 20 public tables appear) → `up zero-cache` (it snapshots the real schema, 0 replication errors) → start vite. A cold `zero-cache` also makes the *first* client query materialize in ~20 s, which can trip the 20 s bootstrap assertion in the first test; a one-shot pre-warm sign-in avoids the cold-start false failure. Both are test-harness/operational notes, not product behavior — the app itself stays sub-100 ms once the replica is warm. The auth journey's roster assertions assume a *fresh* database (its own comment says so); running the suite repeatedly on a persisted dev DB accumulates teams/members and makes those substring/label assertions ambiguous, so the definitive run is on a reset volume.

- **Review screenshots captured under `design-explorations/built/issue-core/`.** Six PNGs prove the signature surfaces in the Warm preset, light and dark: `issue-list-warm-{light,dark}.png` (status-grouped list with the reality-strip slot on every row and no divergence flag), `command-palette-warm-{light,dark}.png` (palette open with real Create/Issue/Navigate/Jump-to-issue actions), and `issue-detail-warm-{light,dark}.png` (detail with the description editor, comment composer, metadata controls, and the explicit Delivery "Not linked" reality strip). Captured against the demo seed (`SEED_DEMO_CONTENT=true`) so the list shows the ENG-1…8 issues across all six statuses; the accent is the Warm preset default (no synced-preference leftover, since the capture ran on a fresh admin). The capture spec was a throwaway and is not committed.
