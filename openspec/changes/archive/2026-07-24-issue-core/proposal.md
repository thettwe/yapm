## Why

workspace-auth landed the identity/access graph and the `team_membership` visibility edge, and design-system shipped the tokenized component library — including an `issue-row` primitive with reserved reality-strip and divergence-flag slots and a `command-palette` shell — but there is still nothing to track. yapm is a project-management tool with no issues. This change lands the first product-work entity: the issue, plus statuses/priorities/labels/comments, the keyboard-first grouped list, the wired command palette, filtering/sorting with a saved-view concept, and the issue detail surface.

It is sequenced third precisely because it defines the core work-graph tables that every later change (board-view, cycles, triage, projects, connectors, AI) hangs off. Critically, it realizes DESIGN.md's differentiation thesis structurally: the row shows **reality, not just intention** — the reality-strip and divergence-flag layout and their computation seam are built now (rendering a quiet "not linked" state), and the filter/view model is architected to query derived delivery state, so `github-sync` (change 8) can populate them without reshaping the schema or the UI. Serves VISION principles **#1 Speed is the feature** (team-scoped issues sync locally so list, filter, and status changes resolve sub-100ms with no network wait), **#3 Reality over ritual** (the seam that will let git move work items exists from day one), and **#10 Keyboard-first** (every surface is fully operable without a pointer).

## What Changes

- **Issue entity, bound to a team.** `issue` carries title, TipTap-v3 rich description, `status`, `priority`, optional assignee, creator, and a per-team human number. Issues belong to a `team`; a user syncs issues only for teams they belong to (extends workspace-auth's team-scoped synced-query pattern).
- **Fixed status categories** (opinionated, non-configurable): Backlog, Todo, In Progress, In Review, Done, Canceled. Adds the missing `canceled` status glyph variant to the component library. Priorities: No priority, Low, Medium, High, Urgent.
- **Server-authoritative per-team issue number** (e.g. `ENG-142`). The PK is a client-minted UUIDv7; the display number is assigned by a server-only mutator pass from a per-team monotonic counter. Under optimistic creation the client shows a **pending** key until the authoritative number settles (the zbugs `shortID` pattern).
- **Labels and comments.** `label` (team-scoped) with a many-to-many `issue_label` edge; `comment` (TipTap rich text) hanging off an issue, authored from the verified `ctx`.
- **Reality-strip + divergence-flag seam (layout + computation, no git data).** No git columns are added to `issue`; the delivery signal is a nullable derived value produced by a pure computation over (future) linked entities that today always resolves to "unlinked", feeding the existing row slots. The divergence flag is a pure function of (human status, delivery state) that is dormant while delivery state is null.
- **Keyboard-first issue list**, grouped by status, built on the `issue-row` primitive: `j`/`k` move, `x` select, arrow/Enter open, and shortcuts to change status / assign / label. Sub-100ms feel via local filtering over synced rows.
- **Command palette wired to real actions** — navigate, create issue, change status, assign, add label — scoped to the focused/selected issue, keyboard-native, on the design-system `cmdk` shell.
- **Filtering, sorting, and saved views.** A structured, typed filter model with axes for status/assignee/label/priority/text **and a reserved delivery axis** (blocked-on-review, failing-CI, merged-not-deployed) that resolves empty now; a `saved_view` entity persists filter + grouping + sort. Reality-derived views are NOT shipped (they would be empty) — only the architecture that will hold them.
- **Issue detail surface** — panel/route with the TipTap description editor, inline metadata editing (status, priority, assignee, labels), and comments — all through shared mutators.

## Capabilities

### New Capabilities

- `issue-tracking`: the `issue`, `label`, `issue_label`, `comment`, and `saved_view` entities; the fixed status/priority model; per-team server-authoritative numbering; the reality/divergence computation seam and the reality-aware filter/view data model; the shared mutators (create/update/status/assign/label/comment) with team-scoped, role-gated authorization.
- `issue-list`: the keyboard-first status-grouped list built on the `issue-row` primitive, rendering the reality-strip and divergence-flag slots (quiet unlinked state); the filter/sort/saved-view UX; pending-number handling; the full keyboard model.
- `command-palette`: the `cmdk` palette wired to real navigate/create/status/assign/label actions scoped to the focused or selected issue, keyboard-native, invoking shared mutators.
- `issue-detail`: the issue detail view/panel — TipTap description editing, inline metadata editing, and a comment thread — all via shared mutators, keyboard-operable.

### Modified Capabilities

- `local-first-sync`: adds team-scoped work-data visibility — `issue`, `label`, `issue_label`, `comment`, and `saved_view` sync only for the caller's teams (deny-by-empty, auth-before-existence), viewers read but never write, and per-team issue numbering is assigned only in the server-authoritative mutator pass.

## Impact

- **Schema** (`packages/schema`): new Kysely tables + forward-only migration (`issue`, `label`, `issue_label`, `comment`, `saved_view`, and a server-only `issue_sequence` counter); new Zero schema tables + relationships (all except `issue_sequence`); new synced queries (team-scoped issue list, detail, labels, saved views, my-issues) and shared mutators; a new `server-mutators` module for the authoritative number-assignment pass; drift test extended to the new synced tables.
- **UI** (`packages/ui`): `canceled` status-glyph variant; wiring the `issue-row` reality-strip/divergence slots to the computation seam; palette action items; issue-detail and comment components; TipTap-v3 rich-text editor component.
- **Web** (`apps/web`): team issue-list route (grouped, filtered, keyboard-driven), issue-detail route/panel, command-palette provider wired to mutators and navigation, saved-view UI.
- **Dependencies**: TipTap v3 (`@tiptap/*`) added to the catalog and `packages/ui`; `cmdk` already present.

## Non-goals

- **Git ingestion / real reality data** — actual PR/CI/deploy state and the connector framework are `connectors` (change 8). This change builds only the layout, the computation seam, and the filter architecture; the reality strip renders "not linked" and the divergence flag stays dormant.
- **Reality-derived saved views** — `blocked-on-review`, `failing-CI`, `merged-not-deployed` are NOT shipped (they would be empty); only the filter/view model that will hold them.
- **Board view** (kanban) — `board-view` (change 4). No drag-to-reorder or manual sort order in this change.
- **Cycles, triage inbox, projects/roadmap** — later changes; `issue` carries no cycle/project binding yet.
- **Estimates and sub-issues** — deferred per ROADMAP.
- **The "blocked-on" axis** — deferred to `github-sync` (needs real data).
- **Collaborative (Yjs) descriptions** — deferred; descriptions are last-write-wins via the shared mutator.
- **Server-side full-text search at scale** — v1 filters run locally over synced rows for sub-100ms feel; Postgres FTS is a later concern.
