## Context

yapm stores rich text as TipTap JSON in `issue.description` and `comment.body`, and both columns
sync through Zero to every team member's IndexedDB. There is no byte store of any kind today. This
change adds one, plus the routes that serve from it, and stops there: the editor nodes that will
reference it are change 17.

Three existing pieces of the codebase are load-bearing precedent and the design leans on all three:

- **`apps/server/src/mail/`** is the seam shape. `Mailer` has exactly one method, deliberately
  shaped around what the *caller* needs rather than around what either transport offers, which is
  what makes SMTP and Resend peers rather than one being an adapter over the other's vocabulary.
  `createMailer(env, logger)` picks one at boot and returns `null` when the feature is off.
- **`apps/server/src/search/routes.ts`** is the refusal shape. Its `EMPTY` constant is *the* one
  shape every non-401 outcome collapses to, with a comment naming the reason: a different status or
  a different key on any one outcome is an oracle, and the caller learns something about rows they
  may not read from the *shape* of the refusal. Its Zod schema uses `.catch()` rather than
  validation errors for the same reason.
- **`apps/server/src/search/isolation.test.ts`** is how an absence is enforced. It derives its
  forbidden-name list from the guarded module's own exports, so a helper added later is covered on
  the day it is written, and it greps the AI paths for those names. That file exists because "no
  module under `ai/` may import `db/search.ts`" is a property no type checker and no runtime test
  can see.

The constraint that shapes everything else is CLAUDE.md #1: three containers. No MinIO, no reverse
proxy, no CDN. The app process is the only thing between a browser and a byte.

## Goals / Non-Goals

**Goals:**

- A byte store whose permission check is identical for local disk and S3, because it is the same
  code path executing over the same rows.
- A refusal on the read path that carries zero information about whether the row exists.
- Full functionality with zero object-storage configuration — local disk is the default and is
  complete, not a fallback.
- No stored string anywhere — in a document, in a row, in an index — that is itself a capability.
- Growth on a 2 GB VPS bounded by something other than the operator noticing.

**Non-Goals:** as listed in the proposal. Restating the two that shape the design: **no seam member
that returns a URL**, and **no editor consumer in this change**.

## Decisions

### D1 — The seam has four members and none of them is `getUrl()`

```ts
export interface StoredObject {
  readonly body: ReadableStream<Uint8Array>
  readonly size: number
}

export interface StorageProvider {
  readonly kind: 'local' | 's3'
  put: (key: string, body: ReadableStream<Uint8Array> | Uint8Array, contentType: string) => Promise<void>
  get: (key: string) => Promise<StoredObject | null>
  delete: (key: string) => Promise<void>
  health: () => Promise<void>
}
```

`get` returns `null` for a missing object rather than throwing, because "the row exists and the
bytes do not" must reach the route as a *value* it can fold into the single refusal, not as an
exception whose message could differ per provider. `delete` is idempotent — deleting an absent key
resolves — because the GC sweep must be safely re-runnable and a partial failure must not need a
reconciliation table. `health` resolves or rejects; the readiness check turns that into
`ready`/`not ready`, exactly as the existing checks do.

**Why no `getUrl()`, stated as an invariant rather than a preference:** the seam is the only place a
capability could be minted. If it can mint one, then the local provider must either mint one too
(inventing a signing scheme, a secret, and an expiry policy for a filesystem) or the two providers
stop being peers and the permission model becomes provider-dependent — at which point the
falsifiable check can pass under `local` and fail under `s3`, and CI only ever runs `local`.

*Alternatives considered.* (a) `getUrl()` returning `null` on local, with the route falling back to
proxying: this is worse than having it, because it produces two live code paths and CI exercises
only the one that is not the risk. (b) A `redirect` capability on the read route: a signed URL
wearing a `Location` header; also makes the refusal shape provider-dependent, because S3's own 403
would leak through on a mis-signed request.

### D2 — Key validation lives in the provider, and the key shape is fixed

Keys are `<teamId>/<attachmentId>` and `<teamId>/<attachmentId>.thumb` — team-sharded so a local
directory has bounded fan-out per directory and an operator can `du -sh` per team, and
UUID-component-only so the traversal defence is an allowlist rather than a blocklist. Each provider
validates against `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-…(\.thumb)?$/`
and throws on a mismatch, **before** touching the filesystem or building a request.

In the provider and not the caller, on the `Mailer` precedent: a validation the caller owns is a
validation the *next* caller forgets. The GC sweep, the upload route, the serve route and any future
export path all construct keys; one of them will eventually do it from a value that came out of the
database, and the provider is the only place that sees all four.

### D3 — S3 via `aws4fetch`, added to the catalog as a deliberate act

CLAUDE.md §5 makes a catalog addition something to justify, so: `aws4fetch@1.0.20` is MIT, has
**zero runtime dependencies**, and is roughly 4 KB. It does one thing — compute a SigV4
`Authorization` header for a `Request` — and leaves the transport to the platform `fetch` that Node
24 already has. S3's object API is four HTTP verbs against a path; PUT/GET/DELETE/HEAD with a signed
header is the whole implementation.

The alternative is `@aws-sdk/client-s3`: roughly 20 MB installed across 100+ transitive packages, a
middleware stack, its own retry and credential-chain machinery, and a release cadence that would
show up in this repo's dependency review every week. This is precisely the `resend.ts` judgement —
*"a dependency not added is a dependency not maintained"* — applied to a second HTTPS API, and it
is why `resend.ts` is 60 lines instead of a package.

Endpoint handling covers non-AWS S3-compatible stores (R2, Backblaze B2, Garage, SeaweedFS, a
self-hosted MinIO an operator already runs): `S3_ENDPOINT` is optional and defaults to
`https://s3.<region>.amazonaws.com`; `S3_FORCE_PATH_STYLE` selects `<endpoint>/<bucket>/<key>` over
`<bucket>.<endpoint>/<key>`. MinIO is supported as a thing an operator may already have; it is never
a thing yapm's compose file requires.

### D4 — One table, `attachment`, in migration **`0017`** — 0016 is taken

`0016_auto_status` already exists. The scope document says `0016_attachments`; that is stale by one
change and the migration is `0017_attachments`.

```
attachment
  id            uuid primary key                    -- server-minted UUIDv7
  team_id       uuid not null references team(id) on delete cascade
  issue_id      uuid     null references issue(id) on delete set null
  comment_id    uuid     null references comment(id) on delete set null
  uploader_id   text not null references "user"(id) on delete cascade
  filename      text not null                       -- as supplied, for download naming only
  content_type  text not null                       -- SNIFFED, never the client's claim
  byte_size     bigint not null
  has_thumbnail boolean not null default false
  created_at    timestamptz not null default now()
indexes: (team_id), (issue_id) where issue_id is not null, (created_at) where issue_id is null and comment_id is null
```

**`team_id` is the permission anchor, not `issue_id`.** An attachment uploaded from a
not-yet-created issue's editor has no issue for a while, and a permission model that depended on
`issue_id` would have a window where the row is unanchored. `team_id` is known at upload time —
it is a required field of the request — and it is what `teamScoped` joins on.

**`ON DELETE SET NULL` on both edges, never cascade.** A deleted comment orphans its files; the GC
sweep decides when the bytes die, which means deletion is a *sweep with a grace window* rather than
a foreign key firing inside somebody's transaction while the bytes are still on disk. A cascade
would delete rows and leave bytes, which is the worst of both: the orphan is now invisible.

**`content_type` stores the sniffed type, not the claimed one.** The client's `Content-Type` on a
multipart part is an attacker-controlled string; storing it and later serving it is the SVG hole
with extra steps. See D8.

No `storage_key` column: the key is `<team_id>/<id>`, derivable from two columns that are already
there. A stored key is a second source of truth that can disagree with the row, and — the reason
that matters here — a stored key is one refactor away from being *rendered*.

### D5 — `attachment` rows sync via Zero, read-only, with no mutator at all

Rows sync. The Files list in change 17 must be instant and must reorder as somebody else uploads,
and that is exactly what the sync engine is for; fetching it over REST would make a common
interaction wait on the network, which CLAUDE.md #9 calls a bug.

The read predicate is the ordinary `teamScoped` — one new query, `attachments.byIssue(issueId)`,
plus the relationship on `issue` so the detail query can pull them inline. Deny-by-empty-query for a
non-member, auth checked before existence, like every other synced query.

**There is no `attachment` mutator, and that is the interesting part.** Every other synced table has
at least one; `cycle_digest` has server-written ones. This table has none, because a row without
bytes is meaningless and a Zero mutator cannot carry bytes. Every write — insert on upload, attach
on save, delete — happens on the REST path, where the row and the object move together. Consequences,
all wanted: a client cannot forge an attachment row; there is no `MUTATOR_TOOL_KINDS` entry to add
(that registry is exhaustive by construction and its test would fail on a missing one, so the
*absence* is what must be asserted); and `ZERO_ENABLE_CRUD_MUTATIONS: "false"` in compose already
closes the generic write path.

The synced row carries **no storage key and no URL** — filename, content type, size, and the ids.
There is nothing in the synced set that is a capability; the id is a name, and naming a thing you
may not read gets you the same bytes as naming a thing that does not exist.

### D6 — `Cache-Control: private, max-age=300` (the maintainer's decision, with its cost)

Served bytes carry `Cache-Control: private, max-age=300`. Images render instantly on revisit and a
20-thumbnail issue costs zero requests on the second view.

**The cost, stated plainly:** for up to five minutes after being removed from a team, that person's
browser can still paint images it already downloaded. It cannot fetch new ones. This is accepted
because it is a five-minute window on bytes that person could equally have screenshotted while they
had access, and because the alternative is worse in a way users feel: `private, no-cache` + ETag
re-checks permission on every view but pays a 304 per image, and 20 thumbnails with no reverse proxy
in front of the app is a visible stutter against the sub-100ms posture.

`private` (never `public`) so no intermediary may store it, and `Vary` is unnecessary because the
response never varies by anything but the session cookie that `private` already covers. **Refusals
carry `Cache-Control: no-store`** — a cached refusal would survive the membership change that fixed
it. That asymmetry is not an oracle: refusals are identical *to each other*, which is what the
falsifiable check asserts.

### D7 — One refusal shape, and it is the whole security story of the read path

`GET /api/v1/files/:id` and `/:id/thumb`:

- No session ⇒ `401 {"error":"unauthorized"}`. (Not about a row; safe to distinguish.)
- Everything else that is not a successful read ⇒ **exactly**
  `404`, body `{"error":"not_found"}`, headers `content-type: application/json; charset=UTF-8`,
  `cache-control: no-store`, `x-content-type-options: nosniff`. Byte-identical across: id that
  matches no row, id that is not a UUID at all, row belonging to a team the caller is not in, row
  whose bytes are absent from the provider, `/thumb` on a row with `has_thumbnail = false`.

Order matters and is fixed: **parse → session → scoped lookup → bytes.** The scoped lookup is a
single statement whose `WHERE` carries both the id and the caller's team scope, on the `db/search.ts`
rule — the scoping predicate lives beside the SQL it guards, never as a filter applied to an
already-fetched row. A row fetched and then rejected is a timing difference, and more importantly it
is a shape one refactor can turn into a `403`.

A malformed id is a `404`, not a `400`. `search`'s Zod schema uses `.catch()` to avoid exactly this:
a `400` for a malformed id and a `404` for a well-formed miss is a distinction the caller can
measure, and while a malformed id leaks nothing *today*, the rule "every read failure is one shape"
is checkable and "every read failure that could leak something is one shape" is a judgement someone
re-litigates in six months.

### D8 — Content type is sniffed, and SVG is never served as SVG

An SVG is an HTML document: `<script>` inside one executes with the origin's privileges if the
browser is allowed to treat the response as an image/document. Since yapm serves its own SPA from
the same origin, an inline-rendered SVG is stored XSS against every session.

The rule, applied at *serve* time and not only at upload:

1. Sniff the first bytes against a fixed magic-number table. Only PNG, JPEG, GIF, WebP and AVIF are
   recognised as raster images.
2. A sniffed raster image is stored and served with that exact type and
   `Content-Disposition: inline`.
3. **Everything else** — including anything whose bytes look like SVG, XML, or HTML — is stored and
   served as `application/octet-stream` with `Content-Disposition: attachment; filename="…"`. The
   browser downloads it; it never renders it in the origin.
4. Every byte response, both branches, carries `X-Content-Type-Options: nosniff` and a
   `Content-Security-Policy` of `default-src 'none'; sandbox` via `hono/secure-headers`, so even a
   mis-sniffed response has no script capability.

Rejecting SVG uploads outright was considered and declined: people legitimately attach diagrams, and
a refusal at upload teaches nothing while a download-only SVG is entirely usable. What is *not*
negotiable is that the origin never renders it.

`filename` is sanitised for the `Content-Disposition` header (RFC 6266 `filename*`, control
characters and quotes stripped) — a header-injection vector that is easy to miss because the value
round-trips through the database first.

### D9 — Thumbnails at upload, never on the read path; and a native module in the runtime image

`sharp` runs **once, at upload**, producing a longest-edge-512 WebP stored under
`<teamId>/<id>.thumb`. The read path is then a pure byte proxy for both variants. A read path that
decodes an image is a read path where 20 concurrent thumbnail requests are a CPU DoS on a 2-vCPU
VPS, and the whole point of `max-age=300` is that the second view costs nothing at all.

`limitInputPixels` is set (268 MP, sharp's default, stated explicitly rather than inherited) and
failure is non-fatal: a file that sharp cannot decode is stored with `has_thumbnail = false` and the
upload succeeds. A thumbnail is an optimisation, not a validity condition.

**The native-module consequence, stated because this is the first one in the runtime image.**
`sharp` 0.35 has **no install script** — the `build` script in its `package.json` is not `install` or
`postinstall`, so **no `allowBuilds` entry is needed** in `pnpm-workspace.yaml`. It ships prebuilt
platform packages (`@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`, …) as optional
dependencies. The Dockerfile's build and runtime stages are both `node:24-slim` — same libc, same
arch — so the binaries `pnpm install` resolves in build are valid in runtime, and
`pnpm deploy --prod --legacy /app` carries them across. Costs and caveats: roughly +10 MB image
size; a cross-architecture build (`--platform linux/arm64` on an x64 host) must either build on the
target arch or configure pnpm's `supportedArchitectures`, which is a **new** constraint on the
release pipeline and is called out in TECHSTACK; and an Alpine base would need the musl variants,
which is one more reason the base stays `node:24-slim`.

### D10 — The GC sweep is a fourth block on the existing scheduler

`startScheduler` already registers cycles / notifications / search independently, each in its own
`try`, on one `PgBoss` with one `boss.start()`. Attachments become a fourth optional block, same
shape. **Never a second `PgBoss`** — the comment in `scheduler.ts` says why: a third instance in the
process is a third concurrent install of the `pgboss` schema on a fresh volume, a boot race
invisible in dev and ugly exactly once, on a self-hoster's first `docker compose up`.

The sweep, on `ATTACHMENT_GC_CRON` (default `23 4 * * *`), does two passes, both bounded by a `LIMIT`
so one pass can never be unbounded work:

1. **Unattached rows** — `issue_id IS NULL AND comment_id IS NULL AND created_at < now() -
   ATTACHMENT_ORPHAN_GRACE_HOURS`. Delete the object and the thumbnail, then the row. Object-first,
   so a crash between the two leaves a row whose bytes are gone (which the read path already folds
   into the standard refusal) rather than bytes nobody can name.
   The window runs from `created_at`, deliberately: there is no record of when an edge was removed,
   and a `unattached_at` column would have to be maintained on every path that nulls one. The
   consequence is that a file whose issue or comment is deleted long after the upload is collected
   by the next sweep with no further grace — its bytes were already about to be unreachable.
   That listing is a **snapshot**, so each row is re-checked under a `for update` claim before
   anything is deleted (`collectOrphanedAttachment`), and the bytes and the row are removed in that
   one transaction. Without the claim, a file attached between the listing and its turn in the loop
   would be destroyed anyway — the one thing "an attached file is never collected" forbids outright.
2. **Dangling objects** are *not* swept. Listing a bucket to find objects with no row is an
   O(objects) operation against a paid API on a cron, and pass 1's ordering makes the leak
   one-directional and small. An operator-run reconciliation belongs with `yapm backup`, not here.

The grace window has a real sharp edge and it is written down rather than smoothed over: a user who
uploads an image, then leaves the tab open for longer than the window without the document saving,
loses the image. Default 24 hours makes that essentially impossible for a human, and change 17's
editor attaches on the same autosave that persists the node — but it is a *policy*, not a proof, and
`ATTACHMENT_ORPHAN_GRACE_HOURS` is env-tunable for an operator who disagrees.

### D11 — Upload: bounded, streamed, and scoped to a team the caller belongs to

`POST /api/v1/files`, `multipart/form-data`, fields `file` (required), `teamId` (required),
`issueId` / `commentId` (optional). Wrapped in `hono/body-limit` at `ATTACHMENT_MAX_BYTES`
(default 25 MiB). Its two paths are **exclusive**, which is worth stating precisely because the
comfortable phrasing ("header check *and* stream check") is not what 4.12.31 does: with a usable
`Content-Length` it rejects **before reading a byte** and then passes the body through uncounted —
a header understating the body is bounded by the HTTP layer's own content-length framing — and only
when there is no usable `Content-Length` (chunked) does it count bytes while reading and refuse the
moment the total passes the ceiling. Either way an over-size body is refused before it is buffered.
See `reference/server-stack.md` §5.3.1. One file per request: batching
would make partial failure a shape the client has to reason about, and the browser can issue N
requests.

Authorisation is membership in `teamId` — the same predicate as writing a comment there — checked
before anything is read from the body. Viewers may not upload (they are read-only everywhere else);
they may read. `issueId`/`commentId`, when supplied, must resolve to rows *in the same team*, or the
request is refused: this is the one place a cross-team edge could be forged into existence.

`PATCH /api/v1/files/:id` sets `issue_id`/`comment_id` exactly once, from null, within the same team.
It is how change 17 attaches an image to the issue that did not exist when the paste happened. Never
re-parents an already-attached row.

`DELETE /api/v1/files/:id` removes object, thumbnail and row; it is idempotent and returns the same
`404` refusal for anything the caller may not see.

### D12 — Storage growth on a small VPS

Four bounds, none of which is a quota system:

- `ATTACHMENT_MAX_BYTES` per file (default 25 MiB) — the only hard limit.
- The orphan sweep (D10), which is what stops abandoned pastes accumulating.
- Deleting an issue nulls the edges rather than cascading, so those files become orphans and are
  swept — a deleted issue's bytes do go away, one sweep later.
- Thumbnails are WebP at longest-edge 512, typically 15–40 KB — a few percent, not a doubling.

What is deliberately absent: per-team quotas, a usage dashboard, and any refusal-when-full behaviour.
The honest operator answer is `du -sh /var/lib/yapm/files` and the `attachment` table, and that is
documented rather than papered over with a number in a UI.

### D13 — `yapm backup` (still unimplemented) now has a written contract

Recorded here so the export change inherits it rather than rediscovering it:

- **Local provider:** `pg_dump` **plus** `tar` of `STORAGE_LOCAL_DIR`. Restore order is database
  first, then files: a row whose bytes are missing already refuses cleanly, while bytes with no row
  are unreachable garbage.
- **S3 provider:** `pg_dump` only. The bucket is the operator's own backup domain (versioning,
  lifecycle, replication are all bucket features), and yapm streaming an entire bucket through the
  app container to produce a tarball would be both slow and expensive. The `attachment` table is the
  **manifest**: every row names an object that must exist, so an operator can verify a bucket backup
  rather than trust it.
- Either way the backup is consistent-enough-by-ordering, not atomic — and the ordering follows from
  how an upload is written, object before row: dump the database **first**, then capture the files.
  Every row in a dump taken at T1 names bytes that were on disk before T1 and are therefore still
  there at T2, so the file capture is a superset of what the dump refers to. The reverse order is
  the broken one: a file uploaded between the file capture and the dump lands in the dump as a row
  whose bytes were never captured. The superset costs nothing — objects with no row are exactly the
  orphans the sweep collects. One residual case: an attachment *deleted* between the dump and the
  file capture restores as a row whose bytes are gone, which is already an ordinary refusal.

### D14 — The guard test, on the `search/isolation.test.ts` precedent

`apps/server/src/storage/no-capability.test.ts`, structured like the search isolation test:

1. No file under `apps/server/src/storage/` may contain `presign`, `signedUrl`, `getSignedUrl`,
   `X-Amz-Signature`, `createPresignedUrl` or `getUrl` (case-insensitive, word-boundary).
2. The exported `StorageProvider` interface's member list, read out of `provider.ts` source, must be
   exactly `kind, put, get, delete, health` — so *adding* a member is what fails, whatever it is
   called, rather than only the six names somebody thought of.
3. No attribute value in any rich-text fixture or stored image node may contain `http` — enforced
   here as a source grep over `packages/schema/src/rich-text/` and `packages/ui/src/editor/`, which
   is where change 17 will add the image node, so the guard is in place *before* the code it guards
   exists.

Rule 2 is the one that matters. Rules 1 and 3 catch the words; rule 2 catches the idea.

## Risks / Trade-offs

- **A signed URL creeps back in as a clean-looking refactor** → D14's rule 2. The scope predicted
  the exact failure mode and predicted that it would pass review, so the mitigation cannot be
  review.
- **Five-minute stale-permission window on cached bytes** (D6) → accepted with its cost written down;
  the alternative regresses a user-visible interaction budget. Reversible: it is one header, and the
  ETag path is a small change if a deployment ever wants it.
- **The orphan grace window can eat an image from a very long-lived unsaved editor session** (D10) →
  24-hour default, env-tunable, and change 17 attaches on autosave. Documented as a sharp edge, not
  claimed to be impossible.
- **A native module in the runtime image constrains cross-arch builds** (D9) → same base image in
  both stages; the constraint is written into TECHSTACK so a future `linux/arm64` release build does
  not discover it at publish time.
- **The new table replicates into zero-cache's SQLite replica** → verified live before anything is
  built on it, on the `search` I1 / `auto-status` I1 precedent. `bigint` is the one column type here
  that is not already on the replication path for some other table; it is checked explicitly, and
  the fallback (store `byte_size` as `integer`, capped by `ATTACHMENT_MAX_BYTES` anyway) is cheap.
- **`sharp` on the upload path is synchronous CPU in a request** → bounded by `limitInputPixels` and
  by `ATTACHMENT_MAX_BYTES`, and failure is non-fatal. If it ever becomes a problem the correct fix
  is to move thumbnailing onto the pg-boss queue that this change already touches, not onto the read
  path.
- **Local provider on a container with no persistent volume silently loses files on restart** →
  `STORAGE_PROVIDER` is explicit (default `local`) rather than inferred, the compose files ship the
  volume, and the readiness check calls `provider.health()`, which for local is a write-and-unlink
  probe in the configured directory — so a read-only or missing mount fails `/readyz` at boot rather
  than at the first upload.

## Migration Plan

Forward-only, additive, no data migration. `0017_attachments` creates one table nothing references.
Deploying it to a running instance is a `CREATE TABLE` plus three indexes on a live zero-cache —
verified before the change is built on top of it (tasks group 2). Rollback is `down()` dropping the
table; bytes on disk become unreferenced and an operator deletes the directory. No client is
affected: `apps/web` is untouched by this change.

## Open Questions

None blocking. The two decisions the scope flagged for a human — the `Cache-Control` policy and the
schema-skew question — are respectively settled here (D6, by the maintainer) and out of scope
(schema skew is change 17's, since it is about node types the editor introduces).

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

### I1 — Task 2.7: `bigint` replicates cleanly on both paths; the two PARTIAL indexes do not, and do not need to

Run against a `yapm-at` compose project on ports 5447/4855/3007, from `down -v`, `postgres:18` +
`rocicorp/zero:1.8.0`, no publication change — the default `FOR TABLES IN SCHEMA public` throughout.
Migrations `0001`–`0016` were applied first and allowed to reach `"stage":"Replicating"`, and a
workspace + team were seeded so the copy had a parent row to hang off.

**(a) The upgrade path — DDL applied to a live zero-cache.** `0017_attachments` ran while zero-cache
was replicating. The change-streamer logged the `CREATE TABLE` and the `CREATE INDEX` statements off
the WAL (`ddlStart` → `ddlUpdate` → `n schema change(s)`), and the **write-worker applied**:

```
write-worker  create-table attachment
write-worker  create-index attachment_pkey
write-worker  create-index attachment_team_id_idx
write-worker  PRAGMA optimized after schema change (0 ms)
```

`"status":"OK"` / `"stage":"Replicating"` throughout, no error, no resync.

**`bigint` is a non-event, which is the fact task 2.7 exists to establish.** `byte_size` is in the
table the write-worker created, is in the copy `SELECT` list below, and carries its row's value. No
fallback to `integer` is needed and none was taken.

**What zero-cache SKIPPED, silently, is both PARTIAL indexes.** `attachment_issue_id_idx`
(`where issue_id is not null`) and `attachment_orphan_idx` (`where issue_id is null and comment_id
is null`) appear in the change-streamer log and are **absent from the write-worker's applied list** —
the same shape of finding as the `search` I1 GIN expression index, with no error and no warning.
This is fine, and it is written down rather than left to be rediscovered: an index is not logically
replicated, the two skipped ones exist for the **Postgres-side** sweep and Files read, and the
replica's own `attachments.byIssue` scan is over a table bounded by one team's uploads. If that scan
ever matters, the fix is a non-partial index, not a publication change.

**(b) The fresh-install path — an empty replica against a schema that already has the table.** The
`yapm-at_zero-replica` volume was deleted and zero-cache restarted (postgres untouched). Initial sync
copied the table with **every column, `byte_size` included**:

```
Starting binary copy stream of attachment: SELECT "byte_size","comment_id","content_type","created_at","filename","has_thumbnail","id","issue_id","team_id","uploader_id" FROM "public"."attachment"
Finished copying 1 rows into attachment (flush: 0.016 ms)
Creating index 1/106: CREATE UNIQUE INDEX "attachment_pkey" ON "attachment" ("id" ASC);
Creating index 2/106: CREATE  INDEX "attachment_team_id_idx" ON "attachment" ("team_id" ASC);
```

`"stage":"Indexing"` → `"stage":"Replicating"`, `"status":"OK"`, container `healthy`. The partial
indexes are skipped here too — consistent with (a) rather than a second behaviour.

The one `ERROR` in the log is `getLitestream` → `Unexpected undefined value`, zero-cache looking for
a litestream backup dev has never configured. Pre-existing, unrelated, present on `main`, and named
in the `search` I1 finding for the same reason.

**Conclusion: no fallback needed.** No custom publication, no `ZERO_APP_PUBLICATIONS` change, no
full replica resync on upgrade. The rest of the change is built on this.

### I2 — `uploader_id` carries NO foreign key to `user`, because it cannot

Design §D4 and task 2.1 both specify `uploader_id ... references "user"(id) on delete cascade`. That
migration **cannot apply on a fresh instance**, and it failed exactly that way the first time it was
run against the live stack: `error: relation "user" does not exist`. The `user` table is
better-auth's, created by *its* `getMigrations()` at boot — which `apps/server/src/index.ts` runs
**after** the Kysely migrator, deliberately, since better-auth's migration is not advisory-locked.

Every other user-shaped column in this repo already resolves this the same way and says so:
`issue.creator_id` and `issue.assignee_id` are bare `text` (`0004_issue_core`), and
`0013_notifications` carries the comment verbatim — *"No FK: `user` is better-auth's table, created
by its own migrator, and this repo's migrations never reference it (matching `retro.facilitator_id`
/ `retro.created_by`)."* So `uploader_id` is `text not null` with no reference.

The consequence is deliberate rather than merely tolerated. `on delete cascade` would have meant
*deleting an account destroys the files they uploaded* — including a design diagram attached to a
live issue, deleted because the person who pasted it left. Permission here is anchored on `team_id`,
not on the uploader, so with no cascade a departed colleague's attachments stay readable by the team
that owns them. That is the better answer regardless of the boot-order constraint that forced it.

### I3 — `byte_size` reads back as a STRING, and is converted in exactly one place

`bigint` is the right column type — a byte count is not an `int4` on principle — but node-postgres
hands `int8` back as a **string** (`"4096"`, observed on the live stack), and no global type parser
is registered in `db/client.ts`. Registering one would change how every other `int8` in the process
reads, which is a far larger blast radius than this change is entitled to.

So `AttachmentTable.byte_size` is typed `ColumnType<string, number | string, number | string>` — the
honest shape — and `db/attachment.ts` converts with `Number()` at its boundary, so `AttachmentRow`
carries a `number` and nothing outside that file ever sees the string. This is the same judgement
`db/search.ts` made about `Generated<Timestamp>` not unwrapping: type the column as it actually
behaves, and fix it once at the one boundary that owns the table.

### I4 — `docker-compose.dev.yml` gains nothing, and two host-run harnesses gain one env line each

Task 6.2 says "both compose files". `docker/docker-compose.dev.yml` has **no `yapm` service** — the
dev loop runs the server on the host under `tsx watch`, which is why its zero-cache points at
`host.docker.internal`. There is no container to mount a volume on, so the dev compose file is
unchanged and only `docker/docker-compose.yml` gains the `files` volume and the env block.

That exposes a real problem the task did not anticipate. `STORAGE_LOCAL_DIR` defaults to
`/var/lib/yapm/files`, which is right for the container and impossible for a normal user on a
developer machine — and the storage readiness check is **gating**, so a host-run server would sit at
`not_ready` forever. Two harnesses set it instead:

- `scripts/dev.mjs`, alongside the `DATABASE_URL` / `VITE_ZERO_CACHE_URL` defaults it already
  computes, pointing at the gitignored `data/files`.
- `apps/web/playwright.config.ts`'s server `webServer.env`, which is a fixed object with no
  `process.env` spread — so without a line there, **every existing e2e spec** would fail at
  `url: ${SERVER_ORIGIN}/readyz` on this branch.

That second edit touches `apps/web`, which the task list forbids. The prohibition is about building
change 17's editor and Files UI in this change; a one-line env addition to a test harness that this
change would otherwise break is the narrower of two rules the plan asks for, and "do not regress a
prior change" is the wider one. It is one line plus a comment, and no `apps/web` source file is
touched.

### I5 — The storage readiness check is GATING, and `health.ts` grew one helper to say so

`health.ts` had `databaseCheck` (gating, fixed name), `replicationCheck` (gating, fixed name) and
`nonGatingCheck` (generic). There was no generic *gating* check, so storage would have had to
either invent a fourth named one-off or be silently non-gating.

Added `gatingCheck(name, probe, timeoutMs)` — which `databaseCheck` now delegates to, since it was
already that function with a literal name. Storage is gating deliberately, and differs from search
freshness for a reason worth stating: a stale search index degrades results, while an unwritable
attachment volume means every upload fails and every image 404s. §Risks calls for exactly this — a
read-only or missing mount must fail `/readyz` at boot rather than at somebody's first paste.

### I6 — The capability guard's word grep covers SHIPPED source only

Rule (a) greps for `presign`, `signedUrl`, `getSignedUrl`, `createPresignedUrl`, `X-Amz-Signature`
and `getUrl` under `apps/server/src/storage/`. `s3.test.ts` legitimately asserts that a signed query
string is **never** produced, which means it has to name `X-Amz-Signature` — and
`no-capability.test.ts` itself is the extreme case, since it must contain every forbidden word in
order to forbid it.

So (a) filters `.test.ts` out and says why in the file. The invariant is about what the server can
do, not about what its tests may say — and rule (b), the one that actually matters, reads
`provider.ts` source directly and is unaffected. Proven to bite: adding a `shareLink(key): Promise<string>`
member — a name no wordlist contains — fails (b) immediately.

### I7 — `canUploadToTeam` and `targetsAreInTeam` live in `db/attachment.ts` too

Task 2.5 names five accessors, all over the `attachment` table. The routes also need two predicates
that read *other* tables: may this caller upload into this team (membership, minus `viewer`), and is
this `issueId`/`commentId` in the same team as the row.

Written in `storage/routes.ts` they would be a **second definition of membership**, sitting beside
`findAttachmentForReader`'s inlined scope fragment and free to disagree with it — which is the exact
failure the one-file rule exists to prevent, just one table over. They live in `db/attachment.ts`
with the read predicate they must agree with. No `apps/server` module writes SQL about attachment
permission.

### I8 — Upload / PATCH / DELETE authorisation failures return the READ path's refusal

Design §D7 fixes the refusal for `GET`. It does not say what a `POST` naming a team the caller is
not in returns. Both available answers are defensible; this one is the same shape, because the
alternative reintroduces the oracle on a different verb: a `403` for "that team exists and you are
not in it" beside a `404` for "no such team" is a team-existence probe, and `PATCH`/`DELETE` name a
row directly, so anything but the standard refusal there leaks precisely what `GET` refuses to.

Request-**shape** failures keep their own statuses, because they describe the caller's own input and
can say nothing about any row: `413` for a body over `ATTACHMENT_MAX_BYTES` (from `hono/body-limit`,
on the `Content-Length` header before a byte is read), and `400 {"error":"invalid_request"}` for a
missing `file` part, a missing `teamId`, a malformed multipart body, or a `PATCH` naming neither
edge. All of them carry `cache-control: no-store`.

### I9 — Task 9.1 was written in this phase, not deferred, because group 5 is otherwise unproven

Groups 9 and 10 belong to the close phase. `apps/server/src/storage/routes.pg.test.ts` was written
here anyway: it is the change's falsifiable check, and shipping seven route handlers with no test
over any of them would mean the phase's own claim — "the routes work" — rested on nothing.

It passes against live Postgres on the `yapm-at` stack, 15 tests, including the three legs the check
names: a member of team B gets **byte-identical** responses (status, body, and the full header set
minus `Date`) for the real attachment id, a UUID never uploaded, and `not-a-uuid`; and a member of
team A gets `200`, the exact uploaded bytes, `Cache-Control: private, max-age=300`,
`Content-Type: image/png`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`.
Task 9.2's contract items are in the same file. Tasks 9.3–9.5 are still the close phase's.

### I10 — The e2e tier does NOT exercise the Docker image, and the spec says so

Task 9.5 and the phase brief both describe the e2e spec as the one place "the docker named volume,
the non-root uid 1001 and the sharp native module in the runtime image are exercised together". That
is not what the harness does, and writing the spec as if it were would have made a false claim in a
comment that nobody re-checks.

`apps/web/playwright.config.ts` boots the server on the **host** under `tsx` against a Postgres and
zero-cache started from `docker-compose.dev.yml`, and CI's `e2e` job does exactly the same. The
runtime image, its `files` named volume and its uid-1001 user are the **`smoke` job's** ground —
`docker compose -f docker/docker-compose.yml up -d --build` — and that job already gates the merge.

So `apps/web/e2e/attachments.spec.ts` claims only what it proves: a real better-auth session cookie,
a real multipart body over HTTP through the vite proxy, the real `sharp` binding decoding real
bytes, the local provider writing to a real filesystem, and the falsifiable check across two
accounts in two teams. The comment names the gap rather than implying coverage.

### I11 — Task 10.6: no CLAUDE.md constraint is made stale, verified rather than assumed

Walked all ten. The two that could plausibly have moved:

- **#1 three containers.** `docker/docker-compose.yml` still declares exactly `postgres`, `yapm` and
  `zero-cache`. The change adds a named *volume*, which is not a service.
- **#4 client-minted UUIDv7 at the mutator call site, never inside a mutator body.** The attachment
  id is **server**-minted, in the upload route. That does not touch the constraint, which is a rule
  about mutators and rebase: there is no attachment mutator at all (§D5), nothing re-runs, and the
  id is returned in the response rather than reconciled optimistically. The constraint's text is
  still exactly right for every mutator in the repo.

#2 (ZQL/mutators only in `packages/schema`) holds — the synced query is in `zero/queries.ts` and
every statement over the table is in `db/attachment.ts`. #5 is satisfied by the catalog entry with
its justification. #6, #7, #8, #9 and #10 are untouched: no TS-Compiler-API tool, no gate, no
per-person metric, no new network wait on a common interaction, no UI at all.

### I12 — `reference/server-stack.md` gained a verified §5.3.1

The reference's Hono section documented routing, `createMiddleware`, static files, validation,
OpenAPI and errors — and nothing about the built-in middleware this change needed. Rather than leave
the next reader to rediscover it, §5.3.1 now records what was read out of the installed
`hono@4.12.31` `.d.ts` files: `bodyLimit`'s complete two-option shape (no `unit`, no `message`), the
fact that `secureHeaders` defaults **most** headers on so an unopinionated call adds HSTS and COOP,
its CSP-as-arrays form, and the two-registration rule for scoping a path-mounted middleware.

### I13 — `backup-restore.md` is new, and is honest that `yapm backup` does not exist

Task 10.2 allowed for the page being absent; it was. It is written as the **manual procedure** an
operator runs today, with a `caution` aside saying the one-command version is unwritten, because a
page that reads like a command reference for a command that does not exist is worse than no page.
Design §D13's contract is the page's structure: local = `pg_dump` + `tar`, s3 = `pg_dump` only with
the `attachment` table as the manifest, the database dumped before the files are captured and
restored before they are unpacked, and the `zero-replica` volume deliberately not backed up (and
deleted on restore, since a replica built from the old database must be rebuilt).

### I14 — Two tasks are deliberately left unticked, and CI owns both

**6.4 (compose smoke test)** and the `build` leg of **10.7** were not run locally. The PR is open, so
every push runs the full suite: CI's `smoke` job builds and boots the three-container stack — which
is the only place the runtime image, the `files` named volume and the uid-1001 write are exercised
together (see I10) — and its `build` job runs `pnpm turbo build`. Running either here duplicates
something already in flight and would have cost more wall clock than it bought.

What WAS run locally, with actual output reported: `turbo typecheck` (8/8), `biome ci .`
(483 files, no fixes), `turbo test` against a live Postgres on 5447 (schema 47 files / 696 tests,
server 39 / 341, web 30 / 288, ui 6 / 85, email 3 / 23 — **zero skipped**, so every `.pg.test.ts`
actually executed), `pnpm --filter @yapm/docs build` (20 pages), `check-boundaries.mjs` and
`check-catalog.mjs`. The Postgres was torn down with `-p yapm-at … down -v`.

**The new scoping test was falsified before being trusted.** Removing the `teamScoped` wrapper from
`attachments.byIssue` — the exact one-line change the test exists to catch — fails four of its eight
assertions (other-team member, unauthenticated, teamless member, foreign `issueId`) while the four
positive legs keep passing. Reverted after the check.
