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
(default 25 MiB), which **rejects on the `Content-Length` header before reading a byte** and also
bounds the stream, so a lying header cannot be used to exhaust memory. One file per request: batching
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
- Either way the backup is consistent-enough-by-ordering, not atomic: dump the database *after* the
  files, so every row in the dump has bytes that were already captured.

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
