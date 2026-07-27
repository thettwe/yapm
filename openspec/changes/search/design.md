## Context

Search is the last of the three v1 gaps named in `openspec/SCOPE-v1-gaps.md`. That document is the
mission input; **read its §2.3 and §6 with this file, not instead of it.** Where the two disagree,
this file says so and gives the reason — every disagreement here traces to a maintainer answer on an
H-question that the scope wrote before the answer existed.

**What already exists.** `packages/schema/src/rich-text/plaintext.ts` (shipped by `mentions`) is a
pure, import-free walk over TipTap document JSON exporting `richTextToPlainText(doc, {mentions,
names})`, `extractMentionIds` and `sanitizeRichText`; its header comment names `search` as the
expected second consumer. `apps/server/src/jobs/scheduler.ts` is a single `PgBoss` instance with
independently-gated feature blocks and "ONE PgBoss instance and ONE `boss.start()` in this file"
written on it. `packages/schema/src/db/` is a substantial Kysely layer (`cycle-facts.ts`,
`connector.ts`, `ai-config.ts`, `notification.ts`, `issue-subscription.ts`). The drift test already
carries a server-only-tables assertion with six entries. `apps/web/src/issues/command.tsx` is a
`cmdk` palette with a "Jump to issue" group at line 505, mounted only inside the team issue list.

**What does not exist.** `grep -rn "ilike\|tsvector\|to_tsquery\|websearch_to_tsquery" apps packages`
returns nothing. `matchesText` (`packages/schema/src/zero/filter.ts:71-80`) matches issue title and
issue key only — a token that appears only in a description already fails today. There is no
debounce/abort helper in `apps/web/src/lib/` (it holds `keyboard.ts` and `mutation.ts`).

**The maintainer's five answers, taken as given and not relitigated:** H9 `'simple'`,
env-configurable. H10 index maintenance is a **job**, not the write transaction, registered on the
existing scheduler. H11 results include `needs_triage` **and** `canceled`, visibly labelled. H12 the
seam is **shown** as two labelled groups. H13 **no `pg_trgm`**.

## Goals / Non-Goals

**Goals:**

- The first frame of a search is computed with no network, and search keeps working offline.
- The complete answer — comment bodies, other teams — arrives without ever moving a row that is
  above the keyboard cursor.
- Search cannot reveal the *existence* of a row the caller may not read: not by returning it, not by
  a count, not by a ranking artefact, and not by a status or timing difference.
- No search path can reach the retro anonymity boundary, provable by grep rather than by argument.
- The write path is not slowed by one microsecond of index maintenance.
- Zero new containers, zero new dependencies, zero `CREATE EXTENSION`.

**Non-Goals:** see the proposal's Non-goals section — it is the authoritative list.

## Decisions

### D1 — A read-only Postgres FTS route is outside CLAUDE.md #2, not a violation of it

Stated explicitly rather than left ambiguous, because a reviewer will ask.

CLAUDE.md #2 is *"All ZQL and all mutators live in `packages/schema`. Client and server import the
same mutator function. This keeps the sync layer swappable."* The search path contains **no ZQL and
no mutator**: no `defineQuery`, no `defineMutator`, no new synced query, no ZQL text operator (ZQL
has none: `reference/zero.md` §13 records "No first-class text search" and "No JSON filters" in the same list, which is why a synced
query could not search a TipTap body even in principle). A Kysely statement is not ZQL, and
`packages/schema/src/db/` is already a substantial Kysely layer the server reads through.

The constraint's *purpose* — keeping the sync layer swappable — is honoured by the same discipline,
applied by analogy and binding on this change:

- **The SQL and its scoping predicate live in `packages/schema/src/db/search.ts`**, never in
  `apps/server`. One file, greppable, beside the other Kysely modules.
- **Ranking, tokenizing, plaintext extraction and merge live in `packages/schema/src/search/`** as
  pure functions imported by `apps/web` (on-device pass) and `apps/server` (index write), so the two
  passes can never disagree about what a document contains.
- `apps/server` owns only the HTTP route, session auth and serialisation.
- `packages/schema` keeps zero UI imports; `scripts/check-boundaries.mjs` still passes.

Swapping the sync layer to Electric would leave `db/search.ts` and `search/` untouched. That is the
test the constraint actually cares about, and it passes.

### D2 — A server-only sidecar table, with the `tsvector` only inside the index expression

`search_document` carries **plain `text` columns**. The weighted `tsvector` exists only as the
expression of a GIN index:

```sql
create index search_document_fts_idx on search_document using gin (
  (setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', body), 'B'))
);
```

Rejected: a `tsvector` column (generated or otherwise) on `issue` / `comment`. The compose stack runs
`postgres:18` with Zero's default `FOR TABLES IN SCHEMA public` publication, and `reference/zero.md`
§13 records that `generated stored` columns **do** sync on PG18 — so a tsvector column would enter
the replication path toward zero-cache's SQLite replica carrying an exotic type, churn the drift test,
and put an unverified type mapping on the critical sync path. Indexes are not logically replicated
and `text` maps trivially, so a sidecar of plain text columns is a non-event for the replica. The
other alternative — excluding the table via a custom publication — is rejected outright:
`ZERO_APP_PUBLICATIONS` changes force a **full replica resync**, which is an ops event on every
self-hosted upgrade.

`search_document` joins `issue_sequence`, `cycle_sequence`, `connector_config`, `connector_secret`,
`connector_installation` and `retro_card_author` on the drift test's server-only list.

### D3 — The allowlist is a Postgres CHECK, deliberately inverting `notification.kind`'s precedent

```sql
entity_type text not null check (entity_type in ('issue', 'comment'))
```

`notifications` deliberately gave `kind` **no** CHECK so that adding a kind costs a TypeScript union
member rather than a migration in a different change. That reasoning does not transfer, and the
inversion is the point: here the closed set **is the security property**. An index built as "every
text column" is how the retro anonymity guarantee dies, and making a new indexable entity type cost
a forward-only migration and a reviewer's eye is exactly the friction this table wants. A second
CHECK pins the entity/FK shape so the invariant is a database fact rather than a convention:

```sql
check ((entity_type = 'issue'   and comment_id is null and entity_id = issue_id)
    or (entity_type = 'comment' and comment_id = entity_id))
```

### D4 — The index is maintained by a job; the write path is untouched (H10)

**This supersedes `openspec/SCOPE-v1-gaps.md` §2.3's bullet** *"`createServerMutators()` maintains the
sidecar for `issue.create` / `issue.update` / `comment.create` / `comment.edit` / `comment.delete`"*.
The maintainer answered H10 the other way: index maintenance is a pg-boss job, accepting seconds of
staleness. Editing a title is among the most common interactions in the product, CLAUDE.md #9 is
non-negotiable, and search freshness is not a stated promise. `SCOPE-v1-gaps.md` §2.3 is corrected in
place by this change (task 12.8), the way `mentions` corrected §0.

No mutator changes. `createServerMutators()` is not touched.

**How the job knows what is stale.** A **watermark tail** plus a **full reconcile**, both driven by
`updated_at` — no outbox table, no trigger, no extra write anywhere:

- *Tail* (`search-index` queue): for each entity type, read the watermark as
  `select max(source_updated_at) from search_document where entity_type = $t` (one index-only lookup
  on the `(entity_type, source_updated_at)` btree), then
  `select … from issue where updated_at >= $watermark order by updated_at limit $batch`. `>=` rather
  than `>` so rows sharing a timestamp are never skipped; re-indexing a row is idempotent, so the
  overlap costs nothing. Loop batches until drained or a wall-clock budget is spent.
- *Reconcile* (`search-reconcile` queue): the full diff —
  `left join search_document … where d.entity_id is null or d.source_updated_at <> src.updated_at` —
  plus an orphan pass. This is also the **first-boot backfill**: on a fresh upgrade every row is
  missing, the diff finds them, and running it repeatedly converges. Bounded and resumable **because
  it is a diff**, which is why it needs no cursor table.

The reconcile is not optional decoration. `updated_at` is minted at the client call site
(`args.updatedAt`), so a skewed client clock can write a row *behind* the watermark, which the tail
would miss forever. The reconcile is the only thing that heals it, and that is why it exists.

**Cadence, stated honestly.** pg-boss cron granularity is one minute, and "seconds of staleness"
needs better than that. So the `search-index` queue is created with pg-boss's **`exclusive`** policy
(one job queued *or* active, v12 `QueuePolicy`) and the worker **re-arms itself** with
`boss.send(queue, {}, {startAfter: SEARCH_INDEX_INTERVAL_SECONDS})` at the end of each pass, with a
one-minute cron as a **watchdog** so a lost or failed job cannot stop indexing forever. `exclusive`
is what makes the two arming paths safe to overlap.

- Typical lag: **~10 s** (the default interval) plus pass duration.
- Worst case if the re-arm chain breaks: **~60 s**, healed by the watchdog.
- A backdated `updated_at`: healed by the reconcile (default every 5 minutes).

The watchdog cron is **not** exposed as an environment variable — it exists only to heal a broken
re-arm chain and there is no reason to tune it. Everything an operator would plausibly turn is.

### D5 — The one deliberate write-path cost: an FK cascade on delete

`comment.delete` exists (`packages/schema/src/zero/mutators.ts:1423`). If deletion were left to the
reconcile pass, a deleted comment would keep returning a snippet of its own text for up to five
minutes. That is worse than the cost of fixing it, so `search_document.comment_id` carries a real
`references comment(id) on delete cascade` and Postgres removes the document inside the deleting
transaction.

Named as an exception to D4 rather than hidden: it is one indexed row delete on a rare operation,
not the every-title-edit amplification H10 refused. `issue_id` carries the same cascade
(there is no `issue.delete` mutator today — belt and braces, and it also cleans up a whole issue's
comment documents in one statement).

The indexer must therefore tolerate a source row deleted mid-pass: a batch upsert can hit
`23503 foreign_key_violation`. The pass catches it, drops the batch, and lets the next pass converge
rather than failing the whole sweep.

### D6 — What is searchable, and why each inclusion and exclusion

**Server index — allowlist of two:**

| Entity | Indexed as | Why |
|---|---|---|
| `issue` | `title` (weight A) + description plaintext (weight B) | The primary object of the product, and descriptions are the highest-value text the on-device pass can only partly reach (other teams' issues never sync). |
| `comment` | comment plaintext (weight B); `title` is empty | The **only** high-value text a client structurally cannot search: comments sync only for the issue currently open (`queries.ts:126`), and bulk-syncing every comment of every team to every client is exactly the antipattern Zero exists to avoid. |

A comment document indexes **only the comment's own text**. The parent issue's title is *not* copied
in — otherwise searching an issue title would return the issue plus every comment on it. The route
joins `issue` for display (key, title, status, `needs_triage`), which also means no denormalised
title can go stale.

**On-device only — no index, no route, no permission risk by construction** (title/name substring
over rows already synced under existing permissioned queries): `project` (`projects.all`,
workspace-wide), `cycle` and `label` (`*.byTeam`, current team), `team` (`teams.all`). Indexing them
server-side would duplicate data the client already holds and add a second permission predicate for
no gain.

**Excluded from both passes, permanently:** every `retro_*` table, including the `retro` entity's own
title. The title names nobody, so this is stricter than the anonymity boundary requires — deliberately.
A retro is a handful of rows per team, all one click from the cycle view, so the value is near zero;
and excluding the whole family turns *"no search path can reach `retro_card_author`"* from a
judgement about which retro column is safe into a one-line grep any reviewer can run. Also excluded:
`saved_view` (a filter, not content — the list's own view picker is its surface), `cycle_digest`,
every connector/PR/CI/deployment row, `user` / `workspace_member` / `invite` (a people index invites
directory scraping), and attachments (there is no upload path).

### D7 — Hybrid, with the seam shown (H12)

Pure client-side **structurally cannot** answer the highest-value search in a tracker (comments are
not synced; ZQL has no JSON filters). Pure server-on-every-keystroke is a direct hit on CLAUDE.md #9
— search-as-you-type in Cmd-K is a common interaction and making its first frame wait on a round trip
is the bug the constraint names. So: **on-device first, server appended.**

Two labelled groups, never a merged list. The two passes have genuinely different match semantics —
on-device is substring, server is full-text — and pretending otherwise produces the confusing case
where the server "finds something the on-device pass should have". More decisively: a merged list
reflows when the second half lands, and a list that moves between the arrow key and Enter is a defect
under CLAUDE.md #10, not a polish item.

**Group labels:** `On this device` and `From the server`. `SCOPE-v1-gaps.md` §2.3 proposed
`Results` / `From the server`; "Results" does not *show* a seam, which is the whole point of the H12
answer, and "On this device" makes the offline state (`Offline — on-device results only`) read in the
same vocabulary. Recorded as a deviation.

### D8 — Cursor stability: the palette takes filtering and ordering away from `cmdk`

The palette renders `<Command>` with `cmdk`'s default `shouldFilter` (true), which **scores and
re-sorts items within a group and groups by their best item's score**. Appending a "From the server"
group 150 ms later would therefore re-sort the groups above it — precisely the reflow H12's answer
exists to prevent.

So the palette sets **`shouldFilter={false}`** and owns both halves:

- **Filtering and ordering** come from `packages/schema/src/search/` — a deterministic scorer over a
  stable declaration order, applied to action rows as well as result rows, so nothing anywhere in the
  palette reorders for a reason the code does not state.
- **The cursor is controlled**: `<Command value={active} onValueChange={setActive}>`, where `active`
  is a **result id**, not an index. Appending a group cannot move it, and if the active row does
  leave the list (the query narrowed), the cursor falls to the first row of the first group — one
  stated rule instead of `cmdk`'s implicit one.

`cmdk`'s `CommandEmpty` counts *mounted* items when `shouldFilter` is false; that behaviour is
**verified at build time** (task 9.6), not assumed, with the fallback being an explicit empty state
rendered by the palette itself.

Ordinary palette behaviour must not regress: the `command-palette` spec's "typing filters, Arrow keys
move the active item, Enter executes, Escape closes and restores focus" scenarios all still hold —
only the implementation of "filters" moves.

### D9 — The route, and the four ways it refuses to be a permission oracle

`GET /api/v1/search?q=&teamId?=&limit?=`, session-authenticated with the `auth.getSessionUser`
middleware shape the AI and connector admin routes already use.

1. **Auth before existence.** No session ⇒ `401` before any table is read. This is the *only*
   non-200 outcome the route has.
2. **Scope resolved server-side, never from the client.** The actor's team set comes from
   `workspace_member` (admin ⇒ every team in the workspace, mirroring `teamScoped`'s bypass exactly)
   or `team_membership`. Every statement filters `team_id = any($teams)`. An authenticated
   non-member's set is empty and yields zero rows — the deny-by-empty-set analogue of `denyAll`'s
   empty `or()`. `teamId` **intersects** that set and can never widen it, exactly as `issues.byTeam`
   re-evaluates its membership predicate server-side.
3. **One response shape for every non-401 outcome.** Miss, out-of-scope, blank query, sub-minimum
   query, and **statement timeout** all return `200 {"results": [], "truncated": false}`. A
   `503`-on-timeout beside a `200`-on-miss is an oracle over corpus size; so is a `partial` flag that
   is only ever true when the corpus is big. **No partial flag is exposed at all.** The accepted cost:
   a self-hoster whose searches time out sees an empty server group with no in-band signal — so the
   timeout is counted and logged server-side (without the query) and surfaced in the operator-facing
   freshness signal (D13). That is the honest trade, and it is written here so nobody "fixes" it
   later by adding a status code.
4. **Snippets after the filter, never before.** `ts_headline` runs in the same `SELECT` as, and
   after, the `team_id = any($teams)` predicate — never over a pre-filter CTE. No counts, no totals,
   no "N more results you can't see". `truncated` is `results.length === limit`, computed over
   **post-scoping** rows only, so it can never depend on a row the caller may not read.

**Hunted for, and closed, beyond the one the scope named** — the mission asked for others of the
status-oracle class, so here is the list and what each does about it:

- *Error text.* A malformed `q` that `websearch_to_tsquery` cannot parse must not produce a 400 that
  a valid-but-absent token would not. Empty/whitespace/sub-minimum/unparseable all collapse to the
  same `200 []` before any table is read.
- *Timing.* The dominant timing signal is corpus size, which is bounded by the same statement timeout
  for every caller regardless of scope, and the scoping predicate is applied *inside* the indexed
  scan rather than as a post-filter, so a token that exists only out-of-scope costs the same index
  probe as a token that exists nowhere. This is the weakest of the four defences — timing is never
  fully closable — and it is named as a residual risk below rather than claimed as solved.
- *Ranking artefacts.* Ranks are computed over the scoped row set only; no global IDF, no corpus-wide
  statistic, and no `ts_rank` normalisation flag that reads a document count leaks in.
- *`truncated`.* Post-scoping only, per above.
- *Log lines.* The request logger records `c.req.path`, which in Hono excludes the query string, and
  the route logs no `q`. **Asserted by a test** (task 6.7), because it is one middleware change from
  being false and nothing else in the repo would notice.

### D10 — Ranking, and how recency factors in

`ts_rank_cd(vector, websearch_to_tsquery($cfg, $q), 32)` — `32` is the `rank/(rank+1)` normalisation,
which bounds the score into `(0,1)` without consulting any corpus-wide statistic (see D9's ranking
artefacts). Recency is a **tiebreak only**, not a blended weight: ordering is
`rank desc, source_updated_at desc, entity_type asc, entity_id asc`. A recency *weight* needs a
coefficient only real usage data can calibrate, and inventing one now would be a number nobody can
defend. Fully deterministic ordering is also what makes the integration tests assertable and the
cursor stable.

The on-device scorer is a separate, simpler tier ladder in `packages/schema/src/search/`: issue-key
exact > title prefix > title substring > body substring, then `updatedAt desc`. It extends
`matchesText`'s semantics (`filter.ts:71` — title + issue key, substring, lowercased) rather than
forking them, so the list's text filter and the palette agree about what "matches" means.

### D11 — `'simple'`, env-configurable, and the job owns the rebuild (H9)

`SEARCH_TEXT_CONFIG` defaults to `simple`. The catch nobody should discover in production: an
expression index is built with a **literal** configuration, so changing the variable without
rebuilding the index silently stops the index being used and search degrades to a sequential scan.

So the **`search-reconcile` job owns the index definition**. On each run it compares the live index
definition (`pg_indexes.indexdef`) against the configured value and, when they differ, rebuilds the
one index. That makes H9's "cheap to reverse (rebuild one index)" a real property rather than a
runbook step. At the scale yapm targets this is a sub-second `CREATE INDEX`, taken inside the job and
never at boot.

Two safety rails, because the configuration is interpolated as a SQL literal (a parameter cannot
appear in an index expression):

- Zod validates the *shape* at boot against `^[a-z_][a-z0-9_]{0,62}$`, failing fast by name.
- Before any DDL or query, the job verifies the value exists in `pg_ts_config`. An unknown
  configuration **fails the ensure step loudly and leaves the previous index in place** — search
  keeps working with the old configuration rather than going dark.

Rejected: making the variable affect only the query (silently slow), and rebuilding at boot (DDL on
the boot path of every self-hoster, for a variable almost nobody changes).

### D12 — The plaintext walker is extended, not duplicated, and it stays mention-aware

`packages/schema/src/rich-text/plaintext.ts` gains only what search needs; no second walker is
written. The indexer calls `richTextToPlainText(doc, {mentions: 'label', names})`, loading the
id→name map for the mention ids in the batch with one
`select id, name from "user" where id = any($ids)`. Two consequences, both wanted:

- A mention is findable by the person's **current** name, and a rename propagates on the next
  reindex — the same anti-spoof property the renderer has, since the stored `label` is only a
  fallback.
- `search_document.body` therefore contains colleagues' names. **`search_document` is never an AI
  data source** (`SCOPE-v1-gaps.md` §1.9). The AI substrate's guarantee is that it is fed only
  team-level aggregates that structurally cannot name a person; a searchable projection of every
  description and comment is exactly the shape that would break it. The rule ships as a comment on
  the table and on `db/search.ts`, as a spec scenario, and as a **test** asserting that no module
  under `apps/server/src/ai/`, and neither `zero/{digest,ai-tools,cycle-facts}.ts` nor
  `db/cycle-facts.ts`, imports `db/search.js` or names `search_document`. `richTextToPlainText`'s
  `'strip'` mode remains mandatory on model-facing paths; search is not one, which is precisely why
  it must not become one.

This change adds **no mutator**, and `zero/ai-tools.ts` derives the agent tool set from
`defineMutators` — so adding none is structurally what keeps search out of the agent surface. That is
worth stating because it is an absence, and absences are not self-enforcing.

### D13 — Silent index drift is made visible

If a future write path bypasses `updated_at` (a bulk import, a connector that authors issue text),
those rows become invisible to server search while looking perfectly normal on-device, and users
report it as "search is flaky" — nearly unreproducible. Two mitigations, both cheap:

- The reconcile pass logs `{indexed, stale, orphaned, missing, timedOutSearches}` every run.
- `/readyz`'s existing report gains a **non-gating** `search` entry carrying the document count, the
  source count, and the age of the oldest un-indexed row. Non-gating is deliberate: a stale index
  must never take an instance out of rotation.

### D14 — The `team_id` denormalisation invariant is cited, not restated

`search_document.team_id` is a denormalised copy of the owning issue's team and is only sound because
**an issue can never change team**. That invariant, its verification and its guard test are owned by
`notifications` (`SCOPE-v1-gaps.md` §1.5; `routeIssue`'s doc comment in
`packages/schema/src/zero/mutators.ts` refuses team reassignment explicitly). This change cites it on
the column and adds nothing. If a future change makes issues movable, it must move every derived row
— notification rows, subscription rows, and now every one of the issue's documents — or they silently
leak to the old team.

### D15 — One surface, two depths

Cmd-K stays the action launcher it is and gains results capped at ~5 per group plus a persistent
`Search everything for "q" →` row; Enter there navigates to `/search?q=`, a real route (shareable,
back-button correct) where fifty comment hits with snippets are legible. Two competing entry points
would mean two keybindings and two mental models for one question.

The two surfaces differ in **scope**, and that difference is what makes each honest:

- **The palette is this team.** Its on-device group reads `issues.byTeam` + `triage.inbox` +
  `cycles.byTeam` + `labels.byTeam` for the open team, plus workspace-wide `projects.all` and
  `teams.all` (which are navigation targets, not team-scoped work data). Its server group sends
  `teamId` = the open team, so both groups mean the same scope.
- **`/search?q=` is everywhere** — every team the caller may read, `teamId` omitted. Its on-device
  group is necessarily thinner (`issues.mine` across all the caller's teams, `projects.all`,
  `teams.all`) and is labelled as such; the server group is where completeness comes from. That is
  the thesis working as designed, not a gap.

Both surfaces consume one `useLocalSearchCorpus(teamId?)` hook and one `useServerSearch(query, opts)`
hook, so there is one implementation of each pass.

### D16 — Snippets are segments, never HTML

`ts_headline` returns markup. Rendering it with `dangerouslySetInnerHTML` would be a stored-XSS
vector fed directly by user-authored comment bodies. So the route asks `ts_headline` for
`StartSel=U+0001, StopSel=U+0002` — control characters that cannot occur in normal prose, and whose
worst failure if they somehow did is a mis-highlight rather than injected HTML — and
`packages/ui`'s `SnippetText` splits on them and renders alternating `<span>`s. No HTML is ever
interpolated. Also passed: `MaxFragments=1, MaxWords=18, MinWords=5, HighlightAll=false`.

### D17 — Empty, offline and still-indexing states, decided rather than left to the implementation

| Situation | What the surface says |
|---|---|
| Query shorter than 2 non-whitespace characters | On-device group renders; server group reads `Keep typing to search everything`. **The rule never depends on whether any row existed.** |
| Server pass in flight | `Searching…`, announced politely to assistive tech |
| Server answered, no hits, on-device has hits | The server group is present and reads `No further matches` |
| Both empty | One empty state: `No matches for "<q>".` + `Try fewer or different words.` + `Recently edited items can take a few seconds to appear.` |
| Connection not established (existing sync-recovery state) | Server group replaced by `Offline — on-device results only`; the on-device group is unaffected |
| Result set hit the cap | `Showing the first 50 — refine your query` |

The "recently edited" line is how the D4 staleness bound reaches the user without a per-query
freshness flag (which would be an oracle).

### D18 — Keyboard and accessibility model

Arrow keys move between rows **across group boundaries** (one list, two headings), Enter opens the
hit, Escape dismisses and restores focus to the prior surface. Nothing requires a pointer. Group
headings are `cmdk` group labels, so the seam is announced structurally rather than only visually.
The result count and the arrival of the server group are announced through one polite live region —
one, not two, so a late-arriving group does not interrupt a user mid-arrow. Every colour and font is
a token; the active row uses the wash-plus-rule idiom `mentions` established in I19 (`bg-accent-soft`
plus a 2 px `--accent-strong` left rule with `text-1`/`text-2` ink) rather than accent-coloured ink,
because `text-accent-strong` over `--accent-soft` measures 3.94–3.95 in three preset/mode
combinations — below AA. `styles/contrast.test.ts` already asserts that pairing.

### D19 — Big-feature rule: all three tiers, and the judgement is not close

PROCESS.md §3 asks for all three tiers iff the change touches **≥2 of** {synced entity/schema,
mutator, permission surface, signature UI}. Counted honestly:

- **Synced entity / schema — partly.** A forward-only migration, a new table, the hand-written Kysely
  `DB` and the drift test all move. The *Zero schema* does not, and no entity newly syncs. Counted as
  a schema touch, not a synced-entity touch.
- **Mutator — no.** H10 removed the mutator wrapper writes entirely; `createServerMutators()` is not
  opened.
- **Permission surface — yes, and it is the crux.** A new read path with its own team-scoping
  predicate, its own admin bypass, and an oracle risk sharp enough that the scope singled it out.
- **Signature UI — yes.** The command palette is the product's signature surface, plus a new route.

Two unambiguous plus one partial ⇒ **all three tiers**, and E2E is not reflexive here: the *instant*
half of the falsifiable check is only expressible against the real stack (zero in-flight requests and
a sub-100 ms paint from a keypress), and cursor stability across an asynchronous group arrival is not
observable in jsdom.

## Risks / Trade-offs

- **Search becomes an anonymity break** → the single most dangerous failure mode. Mitigated by an
  allowlist enforced *in Postgres* (D3), by excluding the entire `retro_*` family from both passes
  (D6), by the drift test's server-only assertion, and by a pg test asserting a distinctive token in
  a `retro_draft` and in a `retro_card` is invisible to every actor **including a workspace admin**.
- **A permission oracle by omission** → D9's four defences, each asserted by a test rather than
  reasoned about. **Residual, and named rather than claimed solved:** timing. A statement timeout
  bounds the worst case identically for every caller and the scoping predicate is inside the indexed
  scan, but response *time* can never be made perfectly independent of what is in the database. What
  is closed is every discrete signal — status, shape, count, ranking, log.
- **zero-cache destabilised by the new table** → the default publication copies `search_document`
  into the replica whether Zero knows about it or not. Plain `text` columns keep the type mapping
  trivial and indexes are not logically replicated, so this should be a non-event — but "should be"
  is doing work. **This is verified in the compose smoke test before anything is built on top of it
  (task 2.6), not after.** The fallback (a custom publication) costs a full replica resync on every
  self-hosted upgrade and is therefore a fallback nobody wants to take.
- **The on-device pass gets expensive** → walking every synced issue's TipTap description on every
  keystroke is real CPU at a few thousand issues, and the interaction it would slow is the one this
  design exists to keep instant. Mitigated by a plaintext cache memoised on `issue.id + updatedAt`,
  built incrementally as rows are first seen rather than eagerly on the first keystroke, and by the
  200-row on-device cap. The cost of building that cache is itself unmeasured — task 8.5 measures it
  and records the number.
- **Silent index drift** → D13.
- **The re-arm chain breaks and nobody notices** → the one-minute cron watchdog is the floor, and
  D13's freshness signal is what makes a persistently-stale index visible.
- **`cmdk` with `shouldFilter={false}` behaves differently than assumed** → `CommandEmpty` and
  auto-selection are verified at build time (task 9.6) with an explicit fallback, not assumed.
- **Scope gravity toward the filter model** → `IssueFilter`, `saved_view` and search all answer
  "narrow this set". Unifying them mid-build doubles the change and puts the saved-view schema in
  play. Named a non-goal now precisely so it can be pointed at later.
- **Two new pg-boss queues on a shared instance** → registered in one independently-gated
  `registerSearchJobs` block whose failure is caught and logged, exactly as the cycle and
  notification blocks are, so a bad search cron cannot take cycle rollover or notification email
  down with it.

## Migration Plan

`0015_search` creates the table and its three indexes only — **no backfill in the migrator**, so an
existing instance's boot is not blocked by a full index build. On first boot after the upgrade the
`search-reconcile` pass finds every row missing and converges in bounded batches; until it does,
the server group returns fewer results and the on-device group is unaffected. Rollback is
`down()` dropping the table; nothing else in the schema references it.

## How we will know this worked

**The single falsifiable check.** `packages/schema/src/db/search.pg.test.ts`, the scenario
`"a member of one team cannot tell an out-of-scope hit from a miss"`, run with
`DATABASE_URL=postgres://yapm:yapm@localhost:5445/yapm pnpm --filter @yapm/schema test search.pg`.

It seeds four distinctive tokens into live Postgres — `qzt-alpha` into a **comment body** on an issue
in team T1; `qzt-bravo` into an **issue description** in team T2; `qzt-charlie` into a
**`retro_draft.body`** in T1; `qzt-delta` into a **`retro_card.body`** in T1 — runs the indexer to
convergence, and then, as a member of T1 only:

1. `qzt-alpha` returns exactly the T1 comment, with a snippet.
2. The response for `qzt-bravo` (exists, out of scope) is **byte-identical** to the response for
   `qzt-echo` (exists nowhere).
3. `qzt-charlie` and `qzt-delta` return nothing — **and nothing to a workspace admin either**.
4. Re-running the indexer leaves every result set unchanged (idempotency).

On today's `main` this fails at import: `packages/schema/src/db/search.ts` does not exist, and
`grep -rn "ilike\|tsvector\|to_tsquery" apps packages` returns zero hits. Assertion 2 is the one that
bites hardest — it is the assertion a plausible-but-wrong implementation (filter after ranking,
snippet over a pre-filter CTE, 404-vs-empty, count in the payload) fails.

**The second half of the thesis, which only an E2E can check.** `apps/web/e2e/search.spec.ts`: with
`/api/v1/search` blocked at the route level, press Cmd-K and type a token that appears only in the
**description** of an issue already synced for the current team. The row is present with **zero
in-flight requests to the search route** and a `performance` mark under 100 ms from keypress to
paint, and the "From the server" group renders its offline label instead of hanging. On `main` this
fails twice over: there is no server route to block, and `matchesText` matches title and issue key
only, so a description-only token already misses.

**Supporting gates:** the drift test shows `search_document` present in Postgres and absent from the
Zero schema; the compose smoke test still passes, proving zero-cache replicates cleanly past the new
table and its GIN expression index; a test asserts the request logger never records the query string;
and a test asserts no AI path names the table.

**What is not agent-checkable, and belongs to a human.** Whether the two-group seam reads as *honest*
rather than as *bureaucratic* — whether a first-time user understands why some results arrive late,
or just sees a palette that looks unfinished — is a judgement no assertion can make. The same is true
of whether the result rows feel Linear-grade against the Warm mockups, and of the ranking's felt
quality on a real corpus (the tests can prove the ordering is deterministic; they cannot prove it is
*good*). These are flagged for review, not automated, and if the answer to the first one is "it reads
as unfinished", the fix is the labels and the copy — not merging the groups, which H12 already
decided.

## Open Questions

None blocking. The two the scope left genuinely open are answered above and recorded here so the
answers are findable: recency is a tiebreak, not a weight (D10); the on-device pass **does** search
descriptions, behind a memoised plaintext cache whose build cost task 8.5 measures (Risks). Two more
are resolved by deliberate choice rather than measurement and could be revisited with data: whether
issues in **archived** teams should be searchable — they are, because `teamScoped` does not filter
`archivedAt` and search's predicate mirrors `teamScoped` exactly rather than inventing a third
behaviour (`teams.all`'s `archivedAt IS NULL` filter is a *navigation* concern, and the existing
inconsistency is pre-existing, now merely visible); and whether search should open a low-TTL synced
query covering issue titles across all of the caller's teams — no, because Zero has no `select()`, so
"titles across my teams" necessarily syncs full descriptions too, which is a lot of client data for a
marginal gain over the server pass that already covers it.

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

### I1 — Task 2.6: the replica survives the new table. Verified, on both paths, before anything was built on top

Run against a `yapm-sr` compose project on ports 5445/4853/3005, from `down -v` (empty volumes),
`postgres:18` and `rocicorp/zero:1.8.0`, with **no publication change** — the default
`FOR TABLES IN SCHEMA public` throughout. Both paths that matter were exercised, because they fail
differently:

**(a) The upgrade path — DDL applied to a live zero-cache.** `migrateToLatest` ran while zero-cache
was already replicating. The change-streamer logged the `CREATE TABLE search_document` and all three
`CREATE INDEX` statements off the WAL, and the write-worker applied
`create-table search_document`, `create-index search_document_pkey`,
`create-index search_document_team_id_idx` and `create-index search_document_watermark_idx` to the
SQLite replica. `search_document_fts_idx` — the **GIN expression index** — appears in the
change-source log and is **absent from the write-worker's applied list**: zero-cache skips it
silently, with no error and no warning, and reports `"status":"OK","stage":"Replicating"`.

**(b) The fresh-install path — an empty replica against a schema that already contains the table.**
The `zero-replica` volume was deleted and zero-cache restarted. Initial sync copied the table
(`Starting binary copy stream of search_document`, `syncMode:"initial"`), recreated its pkey and its
two btree indexes (`87/106`, `88/106`, `89/106`), skipped the GIN index again, reached
`stage":"Replicating"` and the container went `healthy`.

**And it serves.** `apps/web/e2e/sync.spec.ts` — 4 tests, including the disconnect/reconnect one —
passed against that stack (`E2E_SERVER_PORT=3005`, `E2E_ZERO_CACHE_URL=http://localhost:4853`), with
synced queries over `workspace`, `team`, `team_membership`, `notification`, `workspace_member`,
`invite` and `user_preference` materializing from the server. So this is "serves synced queries past
the new table", not "the health check is green".

The one `ERROR` in the log is `getLitestream` → `tryRestore` → `Unexpected undefined value`, which is
zero-cache looking for a litestream backup that dev has never configured. Pre-existing, unrelated,
and present on `main`.

**Conclusion: D2 holds and the fallback is not needed.** No custom publication, no
`ZERO_APP_PUBLICATIONS` change, no full replica resync on upgrade. Plain `text` columns are the
reason: the tsvector never enters the replication path, and an index is not logically replicated at
all. The rest of the change can be built on this.

Two smaller facts observed in the same session, both worth having: the GIN index is genuinely used
(`Bitmap Index Scan on search_document_fts_idx` for a `websearch_to_tsquery('simple', …)` probe, so
the index expression and the query expression match exactly — the mismatch D11 exists to prevent is
not present at the default), and **D5's cascade works**: deleting the probe issue removed its
`search_document` row in the same statement, with no sweep.

### I2 — `score.ts` imports `normalizeQuery` from `./tokenize.js`, against task 1.2's "no imports"

Task 1.2 says the scorer is "pure, no imports". Taken literally, that means `score.ts` re-implements
`trim().toLowerCase()`, or takes an already-normalised needle and trusts every caller to have
normalised it. Both are the fork the same task forbids one clause earlier: two normalisations that
can drift, or a footgun where passing a raw query silently mis-ranks.

So `score.ts` imports exactly one thing, from inside the directory. The property the mission states —
*"a new directory that imports nothing outside itself"* — is intact and is what
`scripts/check-boundaries.mjs` and the whole design actually rest on; "no imports at all" was the
shorthand, not the requirement.

### I3 — A fifth tier, `issue-key-partial`, appended BELOW the four rather than inserted among them

`matchesText` matched a **substring** of the issue key (`filter.ts:71-80`), and the specified ladder
tops out at "issue-key **exact**". Those cannot both be true of one function: a four-tier ladder
whose top rung is exact-only either drops key-substring matching — silently narrowing the issue
list's text filter, a regression in a change that is supposed to widen search — or keeps it as a
second, un-ranked predicate, which is precisely the fork task 1.2 forbids.

`issue-key-partial` is therefore appended as the lowest tier, and `matchesSearchText` is **defined
as** `scoreSearchText(...) !== undefined`. Consequences, all wanted: the maintainer's stated ordering
(issue-key exact > title prefix > title substring > body substring) is untouched; the list filter's
predicate is byte-for-byte the same set of matches it has always returned; and a query like `ng-1`
still finds `ENG-12` but ranks below every real title hit rather than above them — which is the
right answer, because ranking key fragments above titles would put every issue whose key contains the
letter you just typed at the top of the palette.

`filter.ts` keeps exactly one thing of its own: the blank-needle rule (`text.trim()` empty ⇒ every
issue matches). That is the **filter's** meaning of an unset text axis, not search's — search returns
nothing for a blank query — so it stays at the call site rather than being pushed into the ladder.

### I4 — The `@lov`-style word-start case needs no tier of its own

Task 1.6 names it as a case to test without saying what it is. Read against D12, it is the mention
one: the plaintext projection renders a mention as `@` + the person's resolved name, so typing
`@lov` or `lov` finds what Lovisa was mentioned on. Plain substring already reaches a word start,
and the `@` is what makes the intent unambiguous — so the case is a **test**
(`score.test.ts`, "finds a mention by the start of the mentioned person name") rather than a fifth
ranking rule. Adding a `title-word-start` tier would have reordered the four the maintainer fixed,
which was not on offer.

### I5 — The plaintext walker gained exactly one thing: `maxLength`

Task 1.5 says "whatever the indexer and the on-device pass need", which invites scope. Walking the
existing file against both consumers, everything else was already there: `{mentions: 'label', names}`
resolves a mention to a person's current name (D12), `extractMentionIds` is how the indexer knows
whose names to load, and `'strip'` plus its shouting comment stay untouched and mandatory on
model-facing paths.

What was missing is a **bound**. The indexer writes the result into a row and the on-device cache
holds one per synced issue, so a pasted 400 KB document must cost a known number of bytes rather than
however many its author had. `maxLength` truncates *and* short-circuits the walk, so a document
twenty times the budget does not cost twenty times the work. Omitting it is unbounded, which is what
the two human-facing callers already wanted — no existing behaviour moved.

### I6 — The allowlist CHECK cannot be tested in isolation, and the test says so instead of pretending

The first version of the drift assertion (task 2.5) expected an out-of-allowlist insert to be
refused by `search_document_entity_type_check`. It is refused by
`search_document_entity_shape_check` — because an unknown `entity_type` satisfies neither branch of
D3's shape CHECK, so both constraints reject the row and Postgres reports whichever it evaluated
first. There is no insert that violates the allowlist alone.

Rather than reorder the constraints to make an assertion pass, the test now asserts the three things
that are actually true and actually matter: the row **cannot exist** (SQLSTATE `23514`, from one of
the two named `search_document` checks — not a foreign-key violation, which would have proven
nothing about the allowlist); the allowlist's *definition* names `'issue'` and `'comment'` and does
not name `retro`, `retro_card`, `retro_draft`, `project` or `cycle`; and the shape CHECK bites on its
own for an **allowlisted** row with the wrong shape (an `issue` document carrying a `comment_id`, a
`comment` document whose `comment_id` is not its `entity_id`).

### I7 — `search_document` is exported from `@yapm/schema/db`'s type surface now, not when the SQL lands

`SearchDocument` / `NewSearchDocument` / `SearchDocumentUpdate` and `SearchDocumentTable` are
re-exported from `packages/schema/src/db/index.ts` in this stage even though nothing imports them
until group 3. The alternative — adding the table to `DB` here and its types two groups later — leaves
a window where the only way to write the table is with an inline row type, which is how a second
definition of the row shape gets written. The types cost nothing and the row shape has exactly one
home from the first commit.
