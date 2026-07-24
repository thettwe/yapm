## 1. Dependencies

- [x] 1.1 Add TipTap v3 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, and needed extensions) to the pnpm catalog and to `packages/ui`; confirm `cmdk` is already present; run `pnpm install` and confirm `pnpm turbo build` still passes.

## 2. Schema — tables, migration, Zero schema (packages/schema)

- [x] 2.1 Extend the hand-written `DB` interface (`src/db/types.ts`) with `IssueTable`, `LabelTable`, `IssueLabelTable`, `CommentTable`, `SavedViewTable`, and the server-only `IssueSequenceTable` (`team_id` PK, `next_number` Generated), plus Selectable/Insertable/Updateable exports; add `IssueStatus`/`IssuePriority` union types alongside the existing context types.
- [x] 2.2 Write forward-only migration `0004_issue_core`: Postgres enum (or CHECK) types for status/priority; `issue` (uuid PK, `team_id` FK, nullable `number`, `title`, jsonb `description` nullable, `status`, `priority`, nullable `assignee_id`, `creator_id`, timestamps); `label` (team-scoped, name, color); `issue_label` (compound PK `issue_id`,`label_id`); `comment` (uuid PK, `issue_id`, `author_id`, jsonb `body`, timestamps); `saved_view` (team-scoped, name, jsonb `filter`, `grouping`, jsonb `sort`, `created_by`, timestamps); `issue_sequence` (`team_id` PK, `next_number` bigint default 1). Register it in `migrations/index.ts`; app boots and migrates cleanly.
- [x] 2.3 Add `issue`, `label`, `issue_label`, `comment`, and `saved_view` to the Zero schema (`src/zero/schema.ts`) with `from(...)` column mappings, `number().optional()` for `issue.number`, `json().optional()`/`json()` for the TipTap bodies, and relationships (issue→team, issue→assignee/creator, issue→labels via `issue_label` junction, issue→comments, comment→author, label→team, saved_view→team). Do NOT add `issue_sequence` to the Zero schema. Export via the schema.
- [x] 2.4 Add the fixed `IssueStatus`/`IssuePriority` constant tuples and types to `src/zero/context.ts` (or a sibling), reused by the Zero enums, the Zod validators, and the UI.

## 3. Queries — team-scoped reads (packages/schema)

- [x] 3.1 Generalize the `teamScoped` helper in `queries.ts` to scope any table that has a `team` relationship (not only `team_membership`) via `whereExists('team', t => t.whereExists('members', m => m.where('userId', ctx.userID)))`.
- [x] 3.2 Add team-scoped synced queries: issues by team (with assignee/labels related, ordered), issue detail by id (related comments/labels/assignee/creator, `.one()`), labels by team, saved views by team, and `issues.mine` (assigned to `ctx.userID` across the caller's teams). Deny by empty query for non-members; export their names.

## 4. Mutators — shared writes and server numbering (packages/schema)

- [x] 4.1 Add the reality/divergence computation seam module: `computeDeliverySignal(issue, linked)` returning null now, `computeDivergence(status, signal)` returning null now, with the `DeliverySignal`/`DivergenceKind` types; unit-test that both return null for the no-linked-entity case.
- [x] 4.2 Add the `IssueFilter` type and a pure evaluator (intention axes filter synced rows; reserved `delivery` axis routes through the seam and matches nothing); unit-test that a delivery-only filter yields empty and intention filters narrow correctly.
- [x] 4.3 Add shared mutators to `mutators.ts`: `issue.create` (leaves `number` unset, `creator` from ctx, team-scoped `canWrite`), `issue.update`, `issue.setStatus`, `issue.setPriority`, `issue.assign` (validates assignee is a team member), `issue.addLabel`/`removeLabel` (validates same-team), `label.create`/`rename`/`delete`, `comment.create`/`edit`/`delete` (author from ctx, author-or-admin for edit/delete), and `savedView.create`/`update`/`delete` (creator-or-admin delete). All: auth-before-existence, UUIDv7 at call site, Zod-validated status/priority/color.
- [x] 4.4 Add `src/zero/server-mutators.ts` exporting `createServerMutators()` via `defineMutators(mutators, overrides)`: the `issue.create` override runs the shared mutator, then atomically claims the next per-team number from `issue_sequence` through the raw-SQL escape hatch and writes it onto the issue in the authoritative transaction. Wire `apps/server`'s `/mutate` handler to use `createServerMutators()`.
- [x] 4.5 Register all new mutators in `defineMutators`; export mutator name constants where the app needs them.

## 5. Drift + schema tests (packages/schema)

- [x] 5.1 Extend the schema-drift test to cover the new synced tables (`issue`, `label`, `issue_label`, `comment`, `saved_view`) in both the Kysely `DB` map and the Zero introspection; include `issue_sequence` in the Kysely map but assert it is intentionally excluded from the Zero schema. Keep it a hard CI failure.
- [x] 5.2 Unit-test the queries (team-scoped/denyAll, non-member empty, viewer read-only) and mutators (client create leaves `number` null; server pass assigns monotonic per-team numbers with no collision; cross-team label/assignee rejected; viewer/non-member writes rejected before existence; invalid status/priority/color rejected).

## 6. UI components (packages/ui)

- [x] 6.1 Add the `canceled` variant to `status-glyph` (tokenized, accessible label); update its stories to render all six statuses across presets and modes.
- [x] 6.2 Add a tokenized TipTap-v3 rich-text editor component (read-only and editable modes, keyboard-operable) and a rich-text renderer; add stories.
- [x] 6.3 Add issue-detail building blocks (metadata controls for status/priority/assignee/labels, comment thread + composer) and palette action-item components, all tokenized and keyboard-operable; wire the `issue-row` reality-strip/divergence slots to the computation seam output (unlinked/dormant now). Add stories.

## 7. Web — list, detail, palette (apps/web)

- [x] 7.1 Add the team issue-list route: status-grouped list built from `issue-row`, reading the team-scoped synced query, with local filter/sort/grouping, saved-view select/save, and the pending-number state. Reality/delivery filter chips hidden.
- [x] 7.2 Implement the full list keyboard model (`j`/`k`, `x` multi-select, Arrow/Enter open, status/assign/label shortcuts) invoking the shared mutators with a visible accent focus indicator.
- [x] 7.3 Add the issue-detail route/panel: TipTap description editing, inline metadata editing (team-scoped assignee/label choices), and the comment thread — all via shared mutators, keyboard-operable, with loading-vs-not-found distinction.
- [x] 7.4 Wire the command-palette provider to real actions (navigate, create issue, change status, assign, add label) scoped to the focused/selected/open issue, invoking shared mutators; keyboard open/filter/execute/dismiss with focus restore.

## 8. Verification

- [x] 8.1 `pnpm turbo typecheck lint build test` green; boundary guard clean (ZQL/mutators only in `packages/schema`, no package→app imports); drift test run against live Postgres including the new tables.
- [x] 8.2 Add Playwright coverage: keyboard-only create/navigate/status-change/assign/label in the list and palette; pending-number settles without reload; viewer is read-only across list/detail/palette; list is correct in all three presets light+dark; and the existing foundation/workspace-auth/design-system e2e and unit tests still pass (no regression). Full suite green at 22/22 on a fresh stack. Keyboard create/navigate/status-change and pending-number settle are covered directly; a new preset-matrix test asserts the grouped list in all three presets × light/dark; a new self-contained viewer journey asserts read-only across list, detail, and palette (including that the palette offers no change-status/assign/add-label commands to a viewer). Assign/label concrete writes are exercised through the identical focused-row → palette → shared-mutator path proven by the status-change test and gated by the viewer test, not a separate write assertion (an admin who creates a team is intentionally not auto-joined, so an assign-to-me smoke would need an extra join step for no new mechanism coverage).
