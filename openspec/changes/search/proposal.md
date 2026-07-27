## Why

`grep -rn "ilike\|tsvector\|to_tsquery\|websearch_to_tsquery" apps packages` returns **zero hits**.
ROADMAP's locked v1 Surfaces line has promised "search/filtering" since day one; filtering shipped
in `issue-core` and search never did. The command palette's "Jump to issue" group
(`apps/web/src/issues/command.tsx:505`) is the closest thing that exists, and it is a title-and-key
substring match over the *one team* whose list is currently open — it cannot find a phrase in a
description, cannot find anything in a comment (comments only sync for the issue you have open,
`queries.ts:126`), and cannot find anything in another team. Search is the last of the three v1 gaps,
after `notifications` (11) and `mentions` (12).

The two changes before it built exactly what this one needs and said so at the time.
`packages/schema/src/rich-text/plaintext.ts` was written by `mentions` with the header comment
"Expect a second consumer: the search change extends this file rather than writing its own walk",
and `richTextToPlainText(doc, {names})` already resolves a mention to a person's name. The scheduler
was reshaped by `notifications` into `startScheduler` with independently-gated feature blocks, with
"ONE PgBoss instance and ONE `boss.start()` in this file" written on it. This change collects on both.

It serves VISION **#1 Speed is the feature** (the first frame of a search is computed synchronously
over rows Zero has already replicated — no common interaction newly waits on the network, and search
keeps working offline), **#2 Opinionated defaults, real escape hatches** (one entry point, one
opinionated ranking, and a plain `/search?q=` URL that is shareable and back-button-correct),
**#4 Metrics for teams, never surveillance** (search is a per-user *read* over data the caller is
already authorised to read: there is no query log, no "popular searches", no `search_log` table, and
nothing about it is aggregatable into a per-person record — see the paragraph below), **#5 Free means
free** (viewers search exactly like everyone else), **#6 Deployable in minutes** (Postgres full-text
is Postgres's own; the container count does not move) and **#10 Keyboard-first** (results are
navigable, selectable and dismissible from the keyboard, and — the harder half — the list never
reflows under an arrow key when the server answers 150 ms late).

**Why this is not surveillance.** Search computes no aggregate over people, ranks nothing by author,
exposes no per-person scorecard, and produces no artefact any other user can see. It is one person
finding work they are already allowed to read. Constraint #8 forbids ranking people; it does not
forbid a person finding their own work. What keeps that true is the refusal to record queries — and
that refusal is **asserted by a test**, not assumed, because the request logger is one middleware
change away from making it false and nothing else in the repo would notice.

## What Changes

- **Search is a hybrid with the seam shown, not hidden.** An **on-device pass** runs synchronously
  on the keystroke over rows Zero already replicated — zero network, works offline. A **server pass**
  over Postgres full-text extends it with comment bodies and every other team the caller may read,
  debounced 150 ms behind an `AbortController`, and **appended below a labelled divider**. Two
  groups, "On this device" and "From the server", never one merged list: a merged list reflows under
  the keyboard when the second half lands, and CLAUDE.md #10 outranks familiarity with other tools.

- **A server-only `search_document` sidecar, migration `0015_search`.** Plain `text` columns; the
  `tsvector` lives **only inside a GIN expression index**, so nothing exotic enters the logical
  replication path toward zero-cache's replica. It joins `issue_sequence`, `cycle_sequence`, the
  three `connector_*` tables and `retro_card_author` on the drift test's server-only list: present
  in Postgres and in the hand-written Kysely `DB`, **absent from the Zero schema**, so no synced
  query can even name it. `entity_type` carries a Postgres CHECK — a deliberate inversion of
  `notification.kind`'s no-CHECK precedent, because here the closed allowlist *is* the security
  property and making a new indexable entity cost a migration is the point.

- **The index is maintained by a job, not by the write path.** No mutator writes a document, so an
  issue-title edit costs exactly what it costs today. A `search-index` tail pass on the **existing**
  scheduler (`apps/server/src/jobs/scheduler.ts` — no second `boss.start()`) picks up rows whose
  `updated_at` has moved past the index watermark, self-re-arming every 10 s with a one-minute cron
  watchdog; a slower `search-reconcile` pass does the full diff, the orphan cleanup and the
  first-boot backfill. Search freshness is a stated few-second lag; the sub-100 ms write budget is a
  constraint. The one exception, taken deliberately: deleting a comment removes its document through
  an FK cascade **in the same transaction**, because a deleted comment must not stay findable.

- **`GET /api/v1/search?q=&teamId?=&limit?=`** on the existing Hono app, session-authenticated
  before any table is read. The actor's team set is resolved **server-side** from
  `workspace_member` / `team_membership`; `teamId` can only intersect that set, never widen it; a
  non-member's set is empty and yields zero rows — the deny-by-empty-set analogue of `denyAll`.

- **Search must never become a permission oracle, and that is asserted rather than reasoned about.**
  Miss, out-of-scope and statement timeout return the **same status and the same response shape**.
  No counts, no "N more results you can't see", no 404-vs-empty distinction, no partial flag whose
  value depends on whether a row existed. `ts_headline` snippets are produced in the same statement
  as, and after, the scoping filter — never over a pre-filter CTE.

- **Retrospectives are excluded from both passes, structurally and permanently.** The indexable set
  is an **allowlist** of two entity types (`issue`, `comment`) enforced by a database CHECK, and no
  search code path names any `retro_*` table. `retro_draft.body` is what a person is still writing
  and `retro_card_author` is the server-only binding the retro's anonymity guarantee turns on; an
  index built as "every text column" would destroy the strongest promise in the codebase through a
  JOIN nobody reviewed.

- **`search_document` is never an AI data source**, inherited from `mentions` §1.9. Its `body`
  column contains colleagues' names, because the indexer resolves mention nodes with
  `richTextToPlainText(doc, {names})` so a mention is findable by the person's name. The AI
  substrate's guarantee is that it is fed only team-level aggregates; a searchable projection of
  every description and comment is precisely the shape that would leak per-person data into a model.
  The rule is written down **and** asserted by a test that no AI path reads the table.

- **One entry point, two depths.** Cmd-K keeps its actions and its ~5-per-group result cap, with a
  persistent `Search everything for "q" →` row; Enter there opens **`/search?q=`**, a real TanStack
  route where fifty comment hits with snippets are legible. No second global keybinding, no `/`
  shortcut.

- **The palette's "Jump to issue" group is replaced, not joined.** Two title-only matchers in one
  palette is two mental models for one question. The palette also stops delegating filtering and
  ordering to `cmdk`'s scorer and takes both over, with a controlled cursor keyed to a **result id**,
  because a scorer that re-sorts groups when a new group appears is exactly the reflow this change
  must not ship.

- **What "everything" includes is decided, not deferred.** Results include `needs_triage` and
  `canceled` issues, **visibly labelled**. Both are readable, so neither is a permission question.
  Finding nothing when you search for an issue you filed that was later canceled is worse than
  finding it marked canceled — lists curate, search reports what exists.

- **Language-neutral by default.** The text-search configuration is `'simple'`, not `'english'`,
  exposed as `SEARCH_TEXT_CONFIG`. Stemming would quietly optimise for English teams; yapm is for
  self-hosters everywhere. `'simple'` also sits closer to the on-device pass's substring semantics,
  which narrows the visible seam. Reversible by rebuilding one index, which the job does for you.

## Capabilities

### New Capabilities

- `search`: the hybrid model and its two labelled groups; the shared tokenizer, scorer and
  deterministic merge in `packages/schema/src/search/`; the `search_document` sidecar, its allowlist
  and its job-driven maintenance; the team-scoped, oracle-free `GET /api/v1/search` route; the
  `/search?q=` surface and its keyboard model; what is and is not searchable; the empty, offline and
  still-indexing states; and the two absences that are the point — no query log and no retro path.

### Modified Capabilities

- `command-palette`: the "Jump to issue" group is **replaced** by an "On this device" results group
  fed entirely by the on-device pass, plus a "From the server" group and a persistent
  `Search everything →` row; the palette owns its own filtering, its own deterministic ordering and
  a controlled, id-anchored cursor, so appending late server results never moves the row under the
  user's cursor.
- `local-first-sync`: `search_document` is a **server-only** table — in Postgres and in the
  hand-written Kysely `DB`, absent from the Zero schema, covered by the drift test's server-only
  assertion — and zero-cache replicates cleanly past it and its GIN expression index, proven by the
  compose smoke test. The server pass degrades against the **existing** connection state rather than
  inventing a second one.
- `self-host-deploy`: search adds no container and no second job-scheduler instance; five new
  Zod-validated environment variables; a documented way to force a full reindex and to change the
  text-search configuration; and the operator-visible index-freshness signal that makes silent index
  drift reportable instead of "search is flaky".
- `component-library`: a tokenized search-result row and a snippet renderer that renders the
  server's highlight delimiters as **segments, never as HTML** — AA in all three presets, light and
  dark.

## Impact

- **Schema** (`packages/schema`): forward-only migration **`0015_search`** — `search_document`
  (`entity_type`, `entity_id`, `team_id`, `issue_id`, `comment_id`, `title`, `body`,
  `source_updated_at`, `indexed_at`; primary key `(entity_type, entity_id)`; a CHECK pinning the
  allowlist and the entity/FK shape; FK cascades to `issue` and `comment`), a GIN **expression**
  index over the weighted `tsvector`, a btree on `team_id`, and a btree on
  `(entity_type, source_updated_at)` for the watermark read. The hand-written Kysely `DB` interface
  and the drift test extended; the **Zero schema is not touched at all**. New
  `packages/schema/src/search/` (pure tokenizer, on-device scorer, deterministic merge — no imports,
  usable from both apps). New `packages/schema/src/db/search.ts` (every Kysely statement over the
  table and the scoping predicate, in one greppable file, beside `cycle-facts.ts` and
  `connector.ts`). `rich-text/plaintext.ts` extended, not duplicated. **No new mutators, no new
  synced query, no ZQL, and therefore no new AI tool** — `ai-tools.ts` derives its tool set from
  `defineMutators`, so adding none is what keeps search out of the agent surface.
- **Server** (`apps/server`): `GET /api/v1/search` mounted on the existing Hono app with the
  `auth.getSessionUser` middleware shape the AI and connector admin routes already use; a
  `search?: SearchSchedulerOptions` block on `startScheduler` registering the `search-index` and
  `search-reconcile` queues on the **existing** `PgBoss` instance; the indexer itself in
  `apps/server/src/jobs/search.ts`.
- **Web** (`apps/web`): the palette's results groups and its controlled cursor; a new `/search`
  route; a shared `useLocalSearchCorpus` hook and a `useServerSearch` hook (debounce + abort — the
  first such helper in `apps/web/src/lib/`, which today holds only `keyboard.ts` and `mutation.ts`).
- **UI** (`packages/ui`): `SearchResultRow` and `SnippetText`, plus Ladle stories across all three
  presets, light and dark.
- **Dependencies**: **none**. No new catalog entry, no `pg_trgm`, no extension of any kind.
- **Environment**: `SEARCH_INDEX`, `SEARCH_INDEX_INTERVAL_SECONDS`, `SEARCH_RECONCILE_CRON`,
  `SEARCH_TEXT_CONFIG`, `SEARCH_STATEMENT_TIMEOUT_MS` — all optional with defaults, all validated by
  the existing Zod pattern and failing fast by name. `.env.example` and the config reference move in
  the same commit (the drift check between them is mechanical and merge-blocking).
- **Docs:** `apps/docs/src/content/docs/features/search.md` (new),
  `apps/docs/src/content/docs/self-hosting/search-index.md` (new, and the home of the
  `/api/v1/search` reference — matching how the other `/api/v1` surfaces are documented today),
  `apps/docs/astro.config.mjs` (two sidebar entries), `README.md` (feature list, and "What's next"
  no longer opens with Search), `ROADMAP.md` (row 13's status **and** its now-false "index maintained
  in the server-mutator wrapper" claim, plus the "V1 is not complete" paragraph, whose second bullet
  this change closes), **`TECHSTACK.md` (its Search row currently reads "Postgres FTS (`tsvector` +
  `pg_trgm`)" — `pg_trgm` is refused by the H13 answer and must go, with the `'simple'` default and
  the no-`CREATE EXTENSION` promise in its place)**, `.env.example`, and
  `openspec/SCOPE-v1-gaps.md` §2.3 (whose "index maintenance in `createServerMutators()`" bullet the
  H10 answer supersedes — corrected in place, as `mentions` corrected §0).

## Non-goals

- **Indexing anything reachable from the retro anonymity boundary** — `retro`, `retro_card`,
  `retro_draft`, `retro_vote`, `retro_action`, `retro_card_author`. Structurally excluded,
  permanently, by an allowlist enforced in Postgres. The retro entity's own *title* is excluded too,
  even though it names nobody: the value is a handful of rows per team that are all one click from
  the cycle view, and the cost of including it is that "no search path names a `retro_*` table"
  stops being a one-line grep and becomes a judgement about which retro column is safe.
- **Any query logging, search analytics, "popular searches", "recent searches" stored on the server,
  or per-person search metrics.** A `search_log` table would be the first per-person behavioural
  record in the product. Refused on principle, not deferred.
- **Fuzzy / typo tolerance.** No `pg_trgm`, no levenshtein, no synonyms, no per-workspace dictionary.
  `pg_trgm` needs `CREATE EXTENSION`, which some managed-Postgres self-hosters cannot run; that
  trades the deployment promise for typo tolerance nobody has asked for.
- **Semantic or vector search, embeddings, pgvector, or any AI anywhere in the search path.** Search
  is deterministic and works identically with AI switched off.
- **Searching people** (`user`, `workspace_member`, `invite`). The assign page already covers picking
  a person, and a people index invites directory scraping.
- **Indexing cycle digests, connector payloads, PR/CI rows, saved views, or attachment content.**
  Projects, cycles, teams and labels are searchable **on-device only** (name substring), because they
  are already fully synced under existing permissioned queries — indexing them server-side would
  duplicate data the client holds and add a second permission predicate for no gain.
- **Saved searches, or unifying the search model with `IssueFilter` / `saved_view`.** They converge
  later; converging now doubles the change and puts the saved-view schema in play.
- **Deep pagination or infinite scroll.** A hard cap (50 server, 200 on-device) and a "refine your
  query" affordance.
- **A second global keybinding.** Cmd-K stays the only one; no `/` shortcut.
- **Search-within-the-current-filter on the issue list**, scroll-to-match highlighting after
  navigating to a comment hit, and column-level result redaction — a document is either inside the
  caller's team scope or it does not exist to them.
- **A synced query, a mutator, or any ZQL.** Nothing about search is optimistic, so nothing about it
  needs a mutator, and no id is minted anywhere.
