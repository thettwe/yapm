---
title: Search index
description: How yapm's server-side search index is maintained, how stale it can get, the five environment variables, forcing a reindex, and the /api/v1/search reference.
---

[Search](/features/search/) answers in two passes. The first runs in the browser over rows the sync
engine already replicated and needs nothing from you. The second runs against **Postgres full-text
search** over a server-side index, and this page is about that half.

**There is nothing you have to configure.** Every variable below is optional with a working default,
and a fresh instance indexes and searches with an empty `.env`.

## What it adds to your deployment

**No container.** Full-text search is Postgres's own, running in the database container you already
have. The deployment is still `postgres` + `yapm` + `zero-cache`.

**No `CREATE EXTENSION`.** Not `pg_trgm`, not `pgvector`, not anything. Some managed-Postgres hosts
will not grant that privilege, and trading the deployment promise for typo tolerance nobody asked
for is not a trade yapm makes. The consequence is that search is exact rather than fuzzy — see
[Ranking](/features/search/#ranking).

**No second job scheduler.** Both index passes register on the same Postgres-backed scheduler that
already runs [cycle rollover](/features/cycles/) and the
[notification sweeps](/self-hosting/email/).

**One table and one index**, created by migration `0015_search`. The table holds plain `text`
columns; the full-text vector is computed inside the index expression, so nothing exotic enters the
replication path to `zero-cache`. It is server-only: it exists in Postgres, and the sync schema
cannot name it, so no synced query can reach it.

## How the index is maintained

**Not on the write path.** Editing an issue title performs no index work at all — writes cost
exactly what they cost before search shipped. The index catches up behind them, which is why the
empty state mentions that recently edited items can take a few seconds to appear.

Two passes do it:

| Pass | Queue | Runs | Does |
|---|---|---|---|
| **Tail** | `search-index` | Every `SEARCH_INDEX_INTERVAL_SECONDS` (default 10) | Picks up rows whose update timestamp has moved past the index's watermark, in bounded batches |
| **Reconcile** | `search-reconcile` | On `SEARCH_RECONCILE_CRON` (default every 5 minutes) | Diffs the whole index against its sources, re-indexes anything that disagrees, removes orphans, verifies the index definition — and doubles as the first-boot backfill |

The tail worker re-arms itself rather than waiting on cron, because cron granularity is one minute
and "a few seconds" needs better than that. A fixed one-minute cron watchdog re-arms it if the chain
ever breaks; that watchdog is deliberately **not** tunable, because there is no reason to turn it.

So, in practice:

- **Typical staleness: about 10 seconds**, plus however long the pass takes.
- **Worst case if the self-re-arm chain breaks: about 60 seconds**, healed by the watchdog.
- **A row written with a backdated update timestamp** — a skewed client clock, a bulk import — is
  missed by the tail forever and healed by the reconcile, within 5 minutes by default. This is why
  the reconcile exists and why turning its cron down a long way is not free.

Both passes are **idempotent and bounded**: running either repeatedly over unchanged data changes
nothing, and neither can run away with the database.

**Deletion is the exception, on purpose.** Deleting a comment or an issue removes its searchable text
in the *same transaction*, through a database cascade. Deleted text must never stay findable, not
even until the next sweep.

### First boot after an upgrade

The migration creates the table and the index and **does not backfill**, so upgrading does not block
boot on a full index build. The first reconcile pass finds every row missing and fills the index in
bounded batches while the application serves traffic. Until it converges, the server group returns
fewer results; the on-device group is unaffected throughout.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `SEARCH_INDEX` | `true` | `false` stops index maintenance. The search route keeps answering from whatever the index already holds, and the on-device pass is untouched either way |
| `SEARCH_INDEX_INTERVAL_SECONDS` | `10` | Seconds between tail passes, 1–3600 |
| `SEARCH_RECONCILE_CRON` | `*/5 * * * *` | When the full reconcile runs |
| `SEARCH_TEXT_CONFIG` | `simple` | The Postgres text-search configuration used by the index **and** every query |
| `SEARCH_STATEMENT_TIMEOUT_MS` | `2000` | Per-request `statement_timeout` for one search query, 100–60000 |

Every one is validated at boot by the same schema the rest of yapm's configuration uses, and a value
it rejects **fails boot naming the variable** rather than booting a healthy-looking instance with
search quietly broken. The cron is parsed with the scheduler's own parser, so a typo is caught the
same way.

```bash
# .env — leave all of these out unless you have a reason
SEARCH_INDEX=true
SEARCH_INDEX_INTERVAL_SECONDS=10
SEARCH_RECONCILE_CRON=*/5 * * * *
SEARCH_TEXT_CONFIG=simple
SEARCH_STATEMENT_TIMEOUT_MS=2000
```

### Choosing a text-search configuration

The default is **`simple`**: no stemming, no stopword list, language-neutral. `english` ranks better
for English text — *running* finds *run* — at the cost of quietly optimising for English teams, and
of drifting further from the on-device pass's substring matching, which widens the visible seam
between the two groups.

Set `SEARCH_TEXT_CONFIG` to any configuration your Postgres has (`SELECT cfgname FROM pg_ts_config;`
lists them) and restart. **You do not have to rebuild anything by hand.** An expression index is
built against a *literal* configuration, so a changed variable would otherwise silently stop the
index being used and degrade search to a sequential scan — the classic version of this mistake. The
reconcile pass compares the live index definition against the configured value on every run and
rebuilds that one index when they differ, then re-indexing converges as usual.

Two rails guard it:

- The **shape** is validated at boot (`^[a-z_][a-z0-9_]{0,62}$`), failing fast by name.
- **Existence** is verified against `pg_ts_config` before any statement or DDL. An unknown
  configuration fails the reconcile pass loudly and **leaves the previous index in place** — search
  keeps answering with the old configuration rather than going dark.

### Turning indexing off

`SEARCH_INDEX=false` unregisters both passes. The route still answers, from whatever is in the table
at that moment; the on-device pass is entirely unaffected. Turning it back on resumes from the same
place — the reconcile catches up everything that changed while it was off.

## Watching index freshness

`/readyz` carries a **non-gating** `search` entry:

```
search: documents=8421 sources=8437 oldestUnindexedAgeSeconds=6
```

| Field | Means |
|---|---|
| `documents` | Rows currently in the index |
| `sources` | Issues + comments that should be there |
| `oldestUnindexedAgeSeconds` | Age of the oldest row the index has not caught up to, or `none` |

**Non-gating is deliberate**: a lagging index reports its gap and the instance still reports ready.
A stale index must never take a container out of rotation — search degrading is not the app being
down.

A steady `oldestUnindexedAgeSeconds` in the tens of seconds is normal. One that climbs without
bound means the tail is not keeping up or is not running: check for `search index tail ran` and
`search reconcile ran` lines in the app log.

```
search reconcile ran  indexed=0 stale=0 orphaned=0 missing=0 index=unchanged drained=true
```

- `missing` — source rows with no document (a backfill in progress, or something bypassing
  `updated_at`).
- `stale` — documents whose source has moved on. A persistently non-zero `stale` alongside a healthy
  tail means rows are being written with timestamps behind the watermark.
- `orphaned` — should always be zero. It is a canary for a future migration dropping the delete
  cascade, not a sweep.
- `index` — `unchanged`, `created` or `rebuilt`; `rebuilt` is what you see after changing
  `SEARCH_TEXT_CONFIG`.
- `drained=false` — the pass hit its wall-clock budget and will continue on the next run. Expected
  during a backfill; unexpected forever after.

A search query that exceeds `SEARCH_STATEMENT_TIMEOUT_MS` is answered as if it matched nothing —
deliberately, because a different status code for a timeout would let a caller measure the size of
a corpus they cannot read. It is logged server-side instead, **without the query string**:

```
search statement timed out; answered as a miss  statementTimeoutMs=2000
```

Repeated occurrences mean the index is not being used (check `SEARCH_TEXT_CONFIG` against the live
index definition) or the ceiling is too low for your corpus.

## Forcing a full reindex

The index owns no truth — it is a derived projection of issues and comments — so it can be emptied
and rebuilt at any time with no data loss. Nothing else in the schema references it.

```sql
-- Against the app's database, e.g.
--   docker compose -f docker/docker-compose.yml exec postgres psql -U yapm -d yapm
DELETE FROM search_document;
```

An emptied index has no watermark, so the **tail** picks the whole corpus up from the oldest row on
its next run — within `SEARCH_INDEX_INTERVAL_SECONDS` — and refills in bounded batches, several
passes if the corpus is large. The reconcile (within `SEARCH_RECONCILE_CRON`, 5 minutes by default)
is the backstop that guarantees convergence. Nothing needs restarting.

While it converges, the server group returns fewer results and the on-device group is unaffected.
Nothing errors, and search never goes down.

You only need this if something outside yapm has written to `issue` or `comment` in a way that did
not move `updated_at`. Ordinary operation, including a text-configuration change, is self-healing.

## `GET /api/v1/search`

Session-authenticated with the same session cookie the app uses. Additive under the existing
`/api/v1` contract.

**Query parameters**

| Name | Required | Notes |
|---|---|---|
| `q` | yes | The query. Parsed as a Postgres `websearch_to_tsquery`, so `"exact phrase"`, `or` and `-excluded` work |
| `teamId` | no | A team UUID. It can only **narrow** your effective scope, never widen it |
| `limit` | no | 1–50, default 50 |

**Response — `200`**

```json
{
  "results": [
    {
      "type": "comment",
      "id": "018f...",
      "issueId": "018f...",
      "teamId": "018f...",
      "issueKey": "ENG-42",
      "issueTitle": "Retry the sync token before it expires",
      "status": "in_progress",
      "needsTriage": false,
      "snippet": "…we should retry before the socket drops…",
      "updatedAt": "2026-07-25T09:12:44.031Z"
    }
  ],
  "truncated": false
}
```

- `type` is `issue` or `comment`. A comment result identifies **its issue** — `issueKey`,
  `issueTitle`, `status` and `needsTriage` all describe the issue, and `snippet` is from the comment.
- `snippet` delimits matched terms with `U+0001` (start) and `U+0002` (stop) — control characters,
  not markup, chosen so no consumer can be tempted to interpolate the value as HTML. Render it as
  segmented text.
- `truncated` is `true` when the result count reached `limit`. It is computed over rows you may read
  and nothing else. There is no total and no count of withheld rows.

**Every non-`200` outcome**

`401` — no valid session, refused before any table is read. **That is the only one.**

A miss, a match in a team you are not in, a blank or one-character query, an unparseable query, and
a query that exceeded `SEARCH_STATEMENT_TIMEOUT_MS` all return the same `200` with
`{"results": [], "truncated": false}`. This is not laziness — a `503` on timeout beside a `200` on a
miss is an oracle over the size of a corpus the caller cannot read, and so is any flag that is only
ever set when something big existed. See [Search cannot tell you what
exists](/features/search/#search-cannot-tell-you-what-exists).

**The query string is never logged**, by this route or by the request logger. There is no query log
table, no analytics, and no per-person search metric of any kind.

```bash
curl -s --cookie "$YAPM_SESSION" \
  'https://yapm.example.com/api/v1/search?q=retry+token&limit=10'
```
