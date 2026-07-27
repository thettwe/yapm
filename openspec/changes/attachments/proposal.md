## Why

TECHSTACK has promised the shape since day one — *"Local filesystem volume; optional S3-compatible.
MinIO-as-a-requirement is how Plane/Huly bloat their compose"* — and `yapm backup` at TECHSTACK:134
promises a `pg_dump` **plus an attachments tarball**. Neither exists. `grep -rn "attachment" apps
packages` returns nothing but the roadmap row. An issue tracker that cannot hold a screenshot is not
finished, and the editor work queued behind this (changes 16 and 17) cannot start until there is a
byte store with a permission model to hang an image node off.

The reason this is its own change rather than a section of the editor change is the crux below. It
is a permission surface, not a feature, and it has exactly one way to go quietly wrong.

### The crux: signed URLs are structurally unavailable here, not merely worse

An `<img src>` lives in a document that **syncs via Zero**. Whatever string sits in that node
replicates to every team member's IndexedDB and persists as long as the document does. A signed URL
there is:

1. a bearer capability at rest on every client, outliving the membership that justified it;
2. permanently broken the moment it expires — the image is simply gone from the document;
3. and if re-signed on a timer, a rewrite of `issue.description` on that timer: LWW churn, a mention
   diff and a `search_document` reindex per rewrite, and an `updated_at` that lies.

**So the stored node carries an opaque `attachmentId` and no URL at all** — not a signed one, not a
relative one. The renderer computes `/api/v1/files/${id}` and `/api/v1/files/${id}/thumb`. The app
proxies bytes for **both** providers, so the permission check and the refusal shape are literally
the same code whether the bytes came off a disk or out of a bucket.

This serves VISION **#1 Speed is the feature** (a proxied thumbnail with a five-minute private cache
paints instantly on revisit and never round-trips a signing service), **#2 Opinionated defaults,
real escape hatches** (local disk is the default and is *complete*; S3 is an escape hatch, not a
prerequisite), **#5 Your data, no lock-in** (files land in a directory an operator can `tar`, and
`yapm backup` finally has the second half of what it promised), and **#6 Self-hosting is a
first-class deployment** (still exactly three containers — no MinIO, no reverse proxy).

## What Changes

- **A `StorageProvider` seam shaped exactly like `Mailer`.** Four members: `put` / `get` /
  `delete` (idempotent) / `health`. **No `getUrl()`, ever** — the moment the seam can mint a URL the
  permission model becomes provider-dependent, and one provider's answer stops being checkable by
  the other's tests. Key validation (the traversal defence) lives *in the provider*, not in the
  caller, for the same reason the `Mailer` seam owns its own transport errors.

- **`LocalStorageProvider` is the default and is complete.** Team-sharded keys under
  `STORAGE_LOCAL_DIR` (default `/var/lib/yapm/files`). A self-hoster with no object store gets full
  functionality: upload, serve, thumbnails, GC, backup. This is not the degraded path.

- **S3 via `aws4fetch@1.0.20`** (MIT, zero runtime dependencies, ~4 KB) — SigV4 signing over the
  platform `fetch`. This is the `resend.ts` precedent applied verbatim: an HTTPS API reachable in a
  few dozen lines does not justify a vendor SDK. Adding it to the pnpm catalog is a deliberate act
  under CLAUDE.md §5 and is justified in design.md §D3.

- **One new table, `attachment`, in migration `0017_attachments`** — *not* `0016`, which
  `auto_status` already took. Server-minted UUIDv7 primary key returned in the upload response;
  `team_id` is the permission anchor and the `teamScoped` join target; `issue_id` and `comment_id`
  are nullable with `ON DELETE SET NULL`, so **a deleted comment orphans its files rather than
  cascading** and the GC sweep, not a foreign key, decides when bytes die.

- **Two routes, and one refusal.** `POST /api/v1/files` (multipart, streamed, bounded by
  `hono/body-limit`) and `GET /api/v1/files/:id[/thumb]`. Every non-401 failure on the read path —
  unknown id, malformed id, another team's file, a row whose bytes are missing from the provider —
  collapses to **byte-identical** bytes: same status, same body, same headers. No 404-vs-403 oracle.
  `search` hit exactly this class of bug and had to make a miss and an out-of-scope hit
  indistinguishable; this inherits that discipline rather than rediscovering it.

- **`Cache-Control: private, max-age=300` on served bytes** — the maintainer's decision, recorded
  with its cost in design.md §D6: for up to five minutes after being removed from a team, that
  person's browser can still paint images it already downloaded, which it could equally have
  screenshotted. `no-cache` + ETag would re-check permission per view and pay a 304 per image; 20
  thumbnails without a reverse proxy is a visible stutter against the sub-100ms posture.

- **`sharp` thumbnails, generated at upload, never on the read path.** `sharp` is already in the
  catalog at `0.35.3` but depended on only by `apps/docs`; this adds `"sharp": "catalog:"` to
  `apps/server`. **That puts a native module into the runtime image for the first time** — design.md
  §D9 states exactly what that means for the Docker build and what it does not mean (no
  `allowBuilds` entry: sharp 0.35 ships prebuilt platform packages and has no install script).

- **SVG is never served as SVG.** It is a script delivery vector, so the served `Content-Type` comes
  from a magic-byte sniff against a fixed allowlist, never from the client's claim; only sniffed
  raster images (PNG/JPEG/GIF/WebP/AVIF) are served `inline`, everything else is
  `application/octet-stream` + `Content-Disposition: attachment`, under `nosniff` and a
  `sandbox` CSP.

- **An orphan GC sweep on the EXISTING pg-boss scheduler** — a fourth block in
  `startScheduler`, never a second `PgBoss` and never a second `boss.start()`, which is a boot race
  on a fresh volume that is invisible in dev and ugly exactly once, on a self-hoster's first
  `docker compose up`.

- **`attachment` rows sync via Zero, read-only, team-scoped** — and are the first synced table in
  the schema with **no client mutator at all**. Every write happens on the REST path, because the
  row is meaningless without bytes that a mutator cannot carry.

- **A guard test, because an absence is not self-enforcing.** `db/search.ts`'s AI boundary is
  protected by `apps/server/src/search/isolation.test.ts` — a grep, derived from the guarded
  module's own exports, that fails when a later change reaches across the line. This adds the same
  thing for signed URLs: no `presign|signedUrl|getSignedUrl|X-Amz-Signature|getUrl` anywhere under
  the storage directory, and no `http` in any stored rich-text image attribute. The scope predicted
  exactly how this gets undone — someone adds `getUrl()` "just for S3", or writes a `src` into the
  document "so the renderer is simpler" — and predicted that **it would pass review, because the
  code looks clean.**

- **`yapm backup` gets its contract written down** (it is still unimplemented): with the local
  provider it is `pg_dump` **plus** a tarball of `STORAGE_LOCAL_DIR`; with S3 it is `pg_dump` only,
  and the `attachment` table is the manifest that makes an operator's own bucket backup verifiable.

## Capabilities

### New Capabilities

- `attachments`: the provider-neutral storage seam and its deliberate absence of a URL-minting
  member; the local and S3 implementations and the key-validation contract they share; the
  `attachment` entity, its team anchor, its orphaning-not-cascading edges and its sync story; the
  upload route's size, count and content-type contract; the serve route's single refusal shape and
  cache policy; thumbnail generation; and the orphan GC sweep.

### Modified Capabilities

- `local-first-sync`: `attachment` is a new team-scoped synced entity that is **client-read-only by
  construction** — it has no mutator in the shared map at all, unlike `cycle_digest` which has
  server-written mutators. The rows carry no URL and no storage key, so the synced set can never
  become a capability.
- `self-host-deploy`: still exactly three containers; a fourth named volume on the existing `yapm`
  service; the new `STORAGE_*` environment block and its all-or-nothing S3 quartet; the first native
  module in the runtime image; and what `yapm backup` must now include under each provider.
- `ci-pipeline`: the no-signed-URL invariant becomes a gate rather than a review convention, on the
  `search` isolation-test precedent.

## Impact

- **Schema** (`packages/schema`): migration `0017_attachments` (one table, three indexes); the
  `attachment` entry in the hand-written Kysely `DB` interface and in the drift test; the table plus
  its `team` / `issue` / `comment` relationships in the Zero schema; one new `teamScoped` synced
  query (`attachments.byIssue`); server-only accessors in a new
  `packages/schema/src/db/attachment.ts`. **No mutator, therefore no `MUTATOR_TOOL_KINDS` entry and
  no `ai-tools.ts` args entry** — asserted, since that registry is exhaustive by construction.
- **Server** (`apps/server`): a new `src/storage/` directory (`provider.ts`, `local.ts`, `s3.ts`,
  `index.ts`, `sniff.ts`, `thumbnail.ts`, `routes.ts`), wired in `app.ts` / `index.ts` beside the
  search routes; a `STORAGE_*` block in `config/env.ts`; a readiness check calling
  `provider.health()`; an `ATTACHMENT_GC_QUEUE` block in `jobs/scheduler.ts` and a new
  `jobs/attachments.ts`.
- **Web** (`apps/web`): **none.** This change ships the contract; change 17 consumes it.
- **UI** (`packages/ui`): **none.**
- **Dependencies**: `aws4fetch` added to the catalog (`^1.0.20`, MIT, zero deps) and to
  `apps/server`; `sharp` (already catalogued at `^0.35.3`) added to `apps/server`. No new container,
  no `allowBuilds` entry.
- **Docker**: a `files` named volume mounted at `/var/lib/yapm/files` on the `yapm` service in both
  compose files; the Dockerfile creates and chowns that directory to `yapm:yapm` so a bind-mounted
  host path is not silently unwritable by uid 1001.
- **Docs:** `apps/docs/src/content/docs/self-hosting/attachments.md` (new — the two providers, the
  env block, the volume, backup/restore, and why there are no shareable links),
  `apps/docs/src/content/docs/self-hosting/backup-restore.md` (the tarball half of the promise),
  `apps/docs/astro.config.mjs` (one sidebar entry), `README.md` ("What works today"), `ROADMAP.md`
  (row 15 → shipped, and the one-command-export gap paragraph at 54 which now has half its
  substrate), `TECHSTACK.md` (the attachments line, plus a native-module note on the runtime image),
  `.env.example` (the `STORAGE_*` block), and `CONTRIBUTING.md` if the storage dir needs a
  `.gitignore` entry for local dev.

## Non-goals

- **Signed, presigned or shareable URLs of any kind.** Not for S3, not for local, not "just for the
  admin export". This is the crux of the change, restated as a boundary: the seam has no member that
  can return one, and a test fails if the words appear.
- **Public or unauthenticated links.** There is no anonymous read path to a byte. An image in a
  public issue is still behind a session.
- **302-redirect-to-S3 byte serving.** It is a signed URL wearing a `Location` header, and it makes
  the refusal shape provider-dependent — the exact property the falsifiable check asserts against.
- **The TipTap image and file nodes, the slash menu, and the issue Files UI.** All change 17. This
  change ships a contract with no consumer, deliberately.
- **Avatars.** Different lifecycle (workspace-scoped, public-within-workspace, tiny, one per user),
  and folding them in would force `team_id` to be nullable — which is the permission anchor.
- **Per-team or per-workspace storage quotas, and any UI that shows usage.** A per-file cap and an
  orphan sweep bound growth; a quota system is a billing primitive, and "free means free".
- **Virus scanning, and any dependency that would need a fourth container** (ClamAV et al.).
- **Client-side image compression or resizing before upload.** Change 17's territory if at all.
- **Attachment versioning, renaming, or replace-in-place.** Files are immutable once uploaded;
  changing one means uploading another and pointing the node at it.
- **Any per-person metric over attachments** — who uploads most, storage by user. `uploader_id`
  exists for attribution on a single row and is never aggregated.
- **Implementing `yapm backup` itself.** This change writes down what it must include; the export
  change (ROADMAP §Known gaps, still unscheduled) builds it.
