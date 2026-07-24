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

- **Demo seed wired into first-admin bootstrap behind `SEED_DEMO_CONTENT`.** `seedDemoContent` needs a real user id and a workspace, which first exist at the first-admin bootstrap (`/api/zero/token`); it runs there when the flag is `'true'`. It is advisory-locked and one-shot (does nothing once any team exists), so it never touches a real workspace. It seeds a demo team, four labels, eight realistic issues spanning all six statuses and five priorities (numbered ENG-1…8 with `issue_sequence` advanced to 9), label edges, the admin's team membership, and one comment.
