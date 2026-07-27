Sequenced so the app runs after every task. Nothing in a later group is depended on by an earlier
one: the pure core (1) is written before the two passes that import it, the schema surface (2) before
the SQL that reads it, the SQL (3) before the jobs (4) and the route (5) that call it, and every
client group (7–10) after the server contract it consumes exists.

## 1. The shared search core, pure and consumer-free

- [x] 1.1 Create `packages/schema/src/search/tokenize.ts`: split a raw query into lowercased tokens,
      report the non-whitespace length, and expose the **minimum server-query length (2)** as a named
      constant so the client and the route cannot disagree about when the server pass is skipped.
- [x] 1.2 Create `packages/schema/src/search/score.ts`: the on-device tier ladder — issue-key exact >
      title prefix > title substring > body substring — extending `matchesText`'s semantics
      (`packages/schema/src/zero/filter.ts:71`) rather than forking them, with `updatedAt desc` as the
      only tiebreak. Pure, no imports.
- [x] 1.3 Create `packages/schema/src/search/merge.ts`: the deterministic merge and dedupe over
      on-device candidates (an issue reached through two synced queries appears once), plus the
      on-device cap (200) as a named constant.
- [x] 1.4 Create `packages/schema/src/search/index.ts` and export the module from `@yapm/schema`'s
      public surface. Confirm `scripts/check-boundaries.mjs` still passes — this directory must import
      nothing.
- [x] 1.5 Extend `packages/schema/src/rich-text/plaintext.ts` with whatever the indexer and the
      on-device pass need (do **not** write a second walker), preserving `mentions: 'strip'` and the
      comment that makes it mandatory on model-facing paths.
- [x] 1.6 **Test** `packages/schema/src/search/*.test.ts` (unit, no DB): tier ordering including the
      `@lov`-style word-start case, issue-key matching with and without the team prefix, ties broken
      only by `updatedAt`, dedupe across sources, the cap, the minimum-length constant, and the same
      input producing the same order twice.
- [x] 1.7 **Test** extend `packages/schema/src/rich-text/plaintext.test.ts` for the new indexer needs,
      asserting a mention resolves to the supplied name and that `'strip'` still removes it entirely.

## 2. Migration `0015_search` and the schema surface

- [x] 2.1 Write `packages/schema/src/migrations/0015_search.ts` creating `search_document`:
      `entity_type text not null check (entity_type in ('issue','comment'))`, `entity_id uuid not
      null`, `team_id uuid not null references team(id) on delete cascade`, `issue_id uuid not null
      references issue(id) on delete cascade`, `comment_id uuid references comment(id) on delete
      cascade`, `title text not null default ''`, `body text not null default ''`,
      `source_updated_at timestamptz not null`, `indexed_at timestamptz not null default now()`,
      primary key `(entity_type, entity_id)`, and the shape CHECK from design D3. Comment the two
      CHECKs (why the allowlist is enforced here and not only in TypeScript) and the `team_id`
      denormalisation (citing the invariant, not restating it).
- [x] 2.2 Add the three indexes in the same migration: the GIN **expression** index over
      `setweight(to_tsvector('simple', title),'A') || setweight(to_tsvector('simple', body),'B')`, a
      btree on `team_id`, and a btree on `(entity_type, source_updated_at)` for the watermark read.
      No backfill in the migrator.
- [x] 2.3 Register `0015_search` in `packages/schema/src/migrations/index.ts`.
- [x] 2.4 Add `SearchDocumentTable` to `packages/schema/src/db/types.ts` and `search_document` to the
      `DB` interface. **Do not touch `packages/schema/src/zero/schema.ts`.**
- [x] 2.5 **Test** extend `packages/schema/src/db/schema-drift.test.ts`: add `search_document` to
      `KYSELY_DB`, to the column-shape map, and to the **server-only** list beside `retro_card_author`
      — asserting it is in the Kysely `DB` and absent from the Zero introspection. Add an assertion
      that its compound primary key and its two CHECK constraints match Postgres.
- [x] 2.6 **Verify the replica before anything is built on top of it.** Bring the compose stack up
      from empty volumes with the migration applied and confirm zero-cache replicates, starts and
      serves synced queries past the new table and its GIN expression index, with no publication
      change. Record the result in design.md's implementation log. If it fails, stop and re-scope —
      the fallback (a custom publication) costs a full replica resync on every self-hosted upgrade.

## 3. Postgres full-text in `packages/schema/src/db/search.ts`

- [x] 3.1 Create `packages/schema/src/db/search.ts` with a header comment stating the three rules it
      carries: every Kysely statement over `search_document` lives here; the scoping predicate lives
      beside the SQL it guards; and **this table is never an AI data source**.
- [x] 3.2 Implement `resolveSearchScope(db, userId)` → `{teams: string[], isAdmin: boolean}` from
      `workspace_member` / `team_membership`, mirroring `teamScoped`'s admin bypass exactly, returning
      an **empty array** for a non-member, and `intersectScope(scope, teamId?)` which can only narrow.
- [x] 3.3 Implement `searchDocuments(db, {scope, query, limit, textConfig})`: `websearch_to_tsquery` +
      `ts_rank_cd(…, 32)` + `ts_headline` with `StartSel=U+0001 StopSel=U+0002 MaxFragments=1
      MaxWords=18 MinWords=5 HighlightAll=false`, `team_id = any($teams)` applied **inside** the
      indexed scan, a join to `issue` (and `team` for the key) for display fields including `status`
      and `needs_triage`, ordering `rank desc, source_updated_at desc, entity_type asc, entity_id
      asc`, and a hard `limit`. Snippets are produced in the same statement, after the filter.
- [x] 3.4 Implement the index-maintenance helpers: `searchWatermark`, `staleIssueBatch`,
      `staleCommentBatch`, `reconcileDiffBatch`, `orphanedCommentDocuments`, `upsertSearchDocuments`
      (a single multi-row `insert … on conflict (entity_type, entity_id) do update`), and
      `deleteSearchDocuments`. Every one bounded by an explicit limit.
- [x] 3.5 Implement `ensureSearchIndex(db, textConfig)`: verify the configuration exists in
      `pg_ts_config`, compare `pg_indexes.indexdef` against the configured value, and rebuild the one
      index when they differ. On an unknown configuration, throw with the variable name and leave the
      existing index in place.
- [x] 3.6 **Test** `packages/schema/src/db/search.pg.test.ts` (integration, live Postgres,
      `describe.skipIf(DATABASE_URL === undefined)`) — **this file carries the falsifiable check**.
      Seed `qzt-alpha` into a T1 comment body, `qzt-bravo` into a T2 issue description, `qzt-charlie`
      into a `retro_draft.body` in T1, `qzt-delta` into a `retro_card.body` in T1. As a member of T1
      only: `qzt-alpha` returns the comment with a snippet; the response for `qzt-bravo` is
      **byte-identical** to the response for `qzt-echo` (present nowhere); `qzt-charlie` and
      `qzt-delta` return nothing, **including to a workspace admin**. Re-running the indexer leaves
      every result set unchanged.
- [x] 3.7 **Test** in the same file: a non-member gets zero rows; a `teamId` for a team the caller is
      not in yields the identical empty response; an admin's scope covers every team; a token in an
      issue title returns the issue **once** and not each of its comments; a `needs_triage` issue and
      a `canceled` issue are both returned and carry their state; ordering is byte-stable across two
      runs; and `ensureSearchIndex` rebuilds on a changed configuration and refuses an unknown one
      without dropping the existing index.

## 4. Configuration and the background index jobs

- [x] 4.1 Add to `apps/server/src/config/env.ts`, with the existing Zod patterns and a description
      entry for each: `SEARCH_INDEX` (`'true'|'false'`, default `'true'`),
      `SEARCH_INDEX_INTERVAL_SECONDS` (int 1–3600, default 10), `SEARCH_RECONCILE_CRON`
      (`cronExpression`, default `*/5 * * * *`), `SEARCH_TEXT_CONFIG`
      (`^[a-z_][a-z0-9_]{0,62}$`, default `simple`), `SEARCH_STATEMENT_TIMEOUT_MS` (int 100–60000,
      default 2000).
- [x] 4.2 Create `apps/server/src/jobs/search.ts`: `runSearchIndexTail` (watermark read, bounded
      batches per entity type, plaintext extraction via `richTextToPlainText(doc, {mentions:'label',
      names})` with one `select id, name from "user" where id = any($ids)` per batch, upsert, loop
      until drained or a wall-clock budget is spent) and `runSearchReconcile` (`ensureSearchIndex`,
      the full diff, the orphan delete, and the structured `{indexed, stale, orphaned, missing}` log
      line). Both tolerate `23503 foreign_key_violation` from a source row deleted mid-pass by
      dropping the batch, never by failing the pass.
- [x] 4.3 Extend `startScheduler` with an independently-gated `search?: SearchSchedulerOptions` block
      registering `search-index` (pg-boss policy `exclusive`, worker re-arms with
      `startAfter: intervalSeconds`, plus a fixed one-minute cron watchdog) and `search-reconcile`
      (on `SEARCH_RECONCILE_CRON`). **No second `PgBoss` and no second `boss.start()`.** Registration
      failure is caught and logged, exactly as the cycle and notification blocks are.
- [x] 4.4 Wire the block in `apps/server/src/index.ts`, gated on `SEARCH_INDEX`.
- [x] 4.5 Add a **non-gating** `search` readiness check reporting document count, source count and the
      age of the oldest un-indexed row.
- [x] 4.6 **Test** `apps/server/src/jobs/search.test.ts` (unit, injected `boss`, no DB): the queue
      topology — both queues exist, `search-index` is `exclusive`, the watchdog cron is registered,
      the reconcile cron comes from env, only **one** scheduler instance is started, and a search
      registration failure does not prevent the cycle and notification blocks from registering.
- [x] 4.7 **Test** `apps/server/src/jobs/search.pg.test.ts` (integration): a fresh instance backfills
      from empty in bounded batches; an edited title is re-indexed on the next tail pass; a row
      written with a backdated `updated_at` is missed by the tail and healed by the reconcile; a
      deleted comment's document is gone **immediately** via the FK cascade with no sweep; and
      running either pass twice changes nothing.

## 5. The `/api/v1/search` route

- [x] 5.1 Create `apps/server/src/search/routes.ts` mounting `GET /api/v1/search`, using the
      `auth.getSessionUser` middleware shape the AI and connector admin routes already use: no session
      ⇒ `401` **before any table is read**, and that is the route's only non-200 outcome.
- [x] 5.2 Validate `q`, `teamId?` and `limit?` with Zod. A blank, whitespace-only, sub-minimum-length
      or unparseable query returns `200 {"results": [], "truncated": false}` **before** touching the
      index — never a 400.
- [x] 5.3 Resolve the scope with `resolveSearchScope` / `intersectScope` and run `searchDocuments`
      inside a transaction carrying `set local statement_timeout = $SEARCH_STATEMENT_TIMEOUT_MS`.
      Catch the timeout and return the **same status and shape** as a miss, counting and logging it
      server-side without the query string.
- [x] 5.4 Serialise the invariant response shape: `{results: [{type, id, issueId, teamId, issueKey,
      issueTitle, status, needsTriage, snippet, updatedAt}], truncated}` where `truncated =
      results.length === limit`, computed over post-scoping rows only. No totals, no counts of
      withheld rows, no partial flag.
- [x] 5.5 Mount it in `apps/server/src/app.ts` beside the other `/api/v1` surfaces.

## 6. The oracle, logging and AI-isolation assertions

- [x] 6.1 **Test** `apps/server/src/search/routes.pg.test.ts`: an unauthenticated request is `401`
      identically whether the token would have matched or not; an authenticated non-member gets the
      standard empty body; a member's out-of-scope token response is byte-identical to a
      nowhere-token response; a `teamId` outside the caller's set narrows to empty rather than
      widening; and a forced statement timeout returns the same status and body as a miss.
- [x] 6.2 **Test** the response shape is invariant: assert the exact JSON body for miss,
      out-of-scope, blank query, one-character query, unparseable query and timeout are all equal.
- [ ] 6.3 **Test** a retro draft token and a retro card token return nothing to a member, a
      facilitator and a workspace admin.
- [ ] 6.4 **Test** `truncated` is `true` only when the post-scoping result count reaches the limit,
      and never varies with rows outside the caller's scope.
- [ ] 6.5 **Test** search adds no agent tool: the registry derived from `defineMutators` is unchanged.
- [ ] 6.6 **Test** no AI path reads the index: assert that no module under `apps/server/src/ai/`, and
      neither `packages/schema/src/zero/{digest,ai-tools,cycle-facts}.ts` nor
      `packages/schema/src/db/cycle-facts.ts`, imports `db/search.js` or names `search_document`.
- [ ] 6.7 **Test** queries are never logged: drive a request carrying a distinctive token through the
      app with a capturing logger and assert **no** emitted entry contains it — the request-logger
      line included.

## 7. Presentation primitives in `packages/ui`

- [x] 7.1 Add `SnippetText`: split on the `U+0001`/`U+0002` delimiters and render alternating spans.
      **Never `dangerouslySetInnerHTML`.** Unknown or unbalanced delimiters degrade to plain text.
- [x] 7.2 Add `SearchResultRow`: entity glyph, mono issue key, title, optional snippet, optional state
      labels (triage, canceled), truncating not wrapping, at the issue-row density. Data-agnostic —
      it takes resolved display values and knows nothing of queries, teams or permissions. Active
      state uses the wash-plus-rule idiom (`bg-accent-soft` + a 2px `--accent-strong` left rule, ink
      stays `text-1`/`text-2`), not accent-coloured ink.
- [x] 7.3 Add both to the themed showcase across all three presets, light and dark, including the
      active, snippet-bearing and state-labelled variants.
- [x] 7.4 **Test** `SnippetText` renders markup-looking characters literally and interprets nothing;
      extend `packages/ui/src/styles/contrast.test.ts` to cover the result row's ink and its
      highlighted snippet segment over the active-row background in every preset and mode.

## 8. The two shared client passes

- [x] 8.1 Add `apps/web/src/lib/debounce.ts` (or fold it into the hook — there is no such helper in
      `apps/web/src/lib/` today, which holds only `keyboard.ts` and `mutation.ts`).
- [x] 8.2 Add `apps/web/src/search/use-local-corpus.ts`: `useLocalSearchCorpus(teamId?)` subscribing to
      `issues.byTeam` + `triage.inbox` + `cycles.byTeam` + `labels.byTeam` when a team is in context,
      and to `issues.mine` + `projects.all` + `teams.all` always; deduping issues by id; and holding a
      plaintext cache memoised on `issue.id + updatedAt`, built incrementally as rows are first seen
      rather than eagerly on the first keystroke.
- [x] 8.3 Add `apps/web/src/search/use-server-search.ts`: 150 ms debounce, `AbortController`, a
      superseded response discarded rather than rendered, the minimum-length constant from group 1
      honoured client-side so a short query issues no request, and the existing sync connection state
      read to produce the offline state rather than a second notion of "online".
- [x] 8.4 **Test** both hooks: no request below the minimum length; a superseded response never
      renders; abort on unmount; the offline state follows the existing connection state; the corpus
      dedupes an issue reachable through two queries; and the on-device pass finds a description-only
      token that `matchesText` misses.
- [x] 8.5 **Measure** the plaintext cache: the cost of the first keystroke over a seeded corpus of a
      few thousand issues, and the steady-state per-keystroke cost. Record both numbers in design.md's
      implementation log. If the first keystroke exceeds the budget, the fallback is to build the
      cache lazily per matched row rather than over the corpus — decide with the number, not before.

## 9. The command palette

- [x] 9.1 Set `shouldFilter={false}` on the palette's `Command` and move filtering and ordering of
      **every** group, action rows included, onto the group-1 core over a stable declaration order.
- [x] 9.2 Control the cursor: `value={active} onValueChange={setActive}` keyed to a **row identity**,
      with the stated fallback (first row of the first group) when the active row leaves the list.
- [x] 9.3 Replace the "Jump to issue" group (`apps/web/src/issues/command.tsx:505`) with the "On this
      device" group fed by `useLocalSearchCorpus(teamId)`, capped at ~5 rows.
- [x] 9.4 Append the "From the server" group below a divider, fed by `useServerSearch` with
      `teamId` = the open team so both groups mean the same scope, with the D17 state line.
- [x] 9.5 Add the persistent `Search everything for "q" →` row navigating to `/search?q=`.
- [x] 9.6 **Verify `cmdk` behaves as assumed** under `shouldFilter={false}`: that `CommandEmpty`
      counts mounted items, and that a controlled `value` is not reset when a group is appended.
      Record what was found in design.md's implementation log; if either is false, render the empty
      state from the palette itself and keep the cursor in local state.
- [x] 9.7 **Test** (unit/component): the existing action rows still filter and execute; a
      description-only token surfaces in the on-device group; the active row keeps its position when
      the server group is appended; the cursor falls to the first row when the active row disappears;
      and ordering is identical across two identical queries.

## 10. The `/search` route

- [x] 10.1 Add `apps/web/src/routes/search.tsx` (`/search?q=`) inside `Authenticated` + `AppShell`,
      workspace-wide (no `teamId` sent), with the query in the URL so it is shareable and the back
      button is correct.
- [x] 10.2 Build the surface: results grouped by the same two labels, `SearchResultRow` +
      `SnippetText`, the D17 states, the cap message, and one polite live region for the whole surface.
- [x] 10.3 Add a keyboard-reachable search entry to the app shell header (beside the inbox badge) so
      the route is reachable from every surface **without** adding a second keybinding.
- [x] 10.4 Full keyboard model: Arrow keys move across group boundaries as one list, Enter opens,
      Escape returns focus, and `ownsKeyboard` is respected so a single-letter key never hijacks the
      input.
- [x] 10.5 **Test** `apps/web/src/routes.test.tsx` covers the new route; the surface renders each of
      the D17 states; and the offline state appears when the connection state says so.

## 11. End-to-end

- [ ] 11.1 **Test** `apps/web/e2e/search.spec.ts`, the *instant* half of the falsifiable check: with
      `/api/v1/search` blocked at the route level, Cmd-K and a description-only token for the current
      team produces the row with **zero in-flight requests to the search route** and a `performance`
      mark under 100 ms from keypress to paint, while the "From the server" group renders its offline
      label instead of hanging.
- [ ] 11.2 **Test** the *complete* half: seed a comment on another team's issue, wait for the index,
      search from `/search`, and assert the hit with its snippet — then assert a member of one team
      never sees the other team's hit.
- [ ] 11.3 **Test** cursor stability against the real stack: arrow into the third row while the server
      request is in flight, and assert the same row is active after it resolves.
- [ ] 11.4 **Test** keyboard-only escalation: palette → `Search everything` → `/search` → open a
      result → browser back, with no pointer.

## 12. Documentation

- [ ] 12.1 `apps/docs/src/content/docs/features/search.md` — what is searchable and what is not (and
      why retros never are), the two groups and why the seam is shown, triage/canceled labelling, the
      keyboard model, the empty and offline states, and the promise that queries are never recorded.
- [ ] 12.2 `apps/docs/src/content/docs/self-hosting/search-index.md` — how the index is maintained and
      how stale it can be, the five environment variables, changing `SEARCH_TEXT_CONFIG` and what the
      job does about it, forcing a full reindex, reading the readiness freshness entry, and the
      `/api/v1/search` request/response reference (this is where the other `/api/v1` surfaces are
      documented today).
- [ ] 12.3 Add both pages to `apps/docs/astro.config.mjs`'s sidebar and confirm
      `pnpm --filter @yapm/docs build` passes.
- [ ] 12.4 `.env.example` — the five variables with their defaults and one-line descriptions; confirm
      the mechanical drift check against the Zod schema passes.
- [ ] 12.5 **`TECHSTACK.md`** — its Search row currently reads "Postgres FTS (`tsvector` + `pg_trgm`)".
      `pg_trgm` is refused (it needs `CREATE EXTENSION`, which some managed-Postgres self-hosters
      cannot run); replace it with the `'simple'` default, the env override, and the
      no-extension promise.
- [ ] 12.6 `README.md` — add search to the feature list; "What's next" no longer opens with Search.
- [ ] 12.7 `ROADMAP.md` — row 13's status, **and** its now-false "index maintained in the
      server-mutator wrapper" claim (H10 answered the other way), and the "V1 is not complete"
      paragraph, whose second bullet this change closes.
- [ ] 12.8 `openspec/SCOPE-v1-gaps.md` §2.3 — correct in place the bullet that puts index maintenance
      in `createServerMutators()`, and the group labels, citing the H10 and H12 answers, exactly as
      `mentions` corrected §0.

## 13. Verification

- [ ] 13.1 `pnpm turbo lint typecheck test build` green, with the integration tests run against live
      Postgres (`DATABASE_URL` set) so nothing self-skips.
- [ ] 13.2 The compose smoke test passes from empty volumes, re-confirming task 2.6's finding on the
      integrated branch.
- [ ] 13.3 Walk every scenario in `openspec/changes/search/specs/**` and confirm it is true.
- [ ] 13.4 Confirm the falsifiable check fails on `main` and passes here, and record in design.md's
      implementation log which plausible-but-wrong implementations were perturbed to prove the check
      bites (at minimum: snippet generated before the scoping filter, and a 503 on timeout).
