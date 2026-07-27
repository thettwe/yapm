Sequenced so the app runs after every task, and so nothing in a later group is depended on by an
earlier one: configuration and dependencies (1) before anything reads them; the migration and schema
surface (2) — with the live-replica check *inside* it, before anything is built on top; the seam and
its providers (3) before the sniffing and thumbnail helpers that feed them (4); all of those before
the routes that compose them (5); wiring and the volume (6) before the sweep that deletes through it
(7); the capability guard (8) before the tests it constrains (9); documentation last (10).

`apps/web` and `packages/ui` are untouched by this change. If a task in this file edits either, the
task is wrong.

## 1. Dependencies and configuration

- [ ] 1.1 Add `aws4fetch: ^1.0.20` to the `catalog:` block in `pnpm-workspace.yaml`, alphabetically,
      with a comment recording the CLAUDE.md §5 justification in one line (MIT, zero runtime deps,
      ~4 KB, SigV4 over platform `fetch`; the `resend.ts` no-vendor-SDK precedent). Add `aws4fetch`
      and `sharp` to `apps/server/package.json` as `catalog:`. Run `node scripts/check-catalog.mjs`.
      **No `allowBuilds` entry** — sharp 0.35 has no `install`/`postinstall` script; confirm by
      reading the installed `sharp/package.json` rather than assuming.
- [ ] 1.2 Add the storage block to `apps/server/src/config/env.ts`: `STORAGE_PROVIDER`
      (`'local' | 's3'`, default `'local'`), `STORAGE_LOCAL_DIR` (default `/var/lib/yapm/files`),
      `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`
      (optional), `S3_FORCE_PATH_STYLE` (optional boolean), `ATTACHMENT_MAX_BYTES`
      (default `26214400`), `ATTACHMENT_ORPHAN_GRACE_HOURS` (default `24`), `ATTACHMENT_GC_CRON`
      (default `23 4 * * *`, validated by the existing `cronExpression` schema). Use the existing
      `optionalString` preprocessor so an unset `${VAR:-}` in compose reads as absent.
- [ ] 1.3 Add the all-or-nothing refinement on the `GITHUB_APP_VARS` precedent: `STORAGE_PROVIDER=s3`
      requires `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and boot
      fails naming each missing one. `local` requires nothing. Add every new variable to
      `EXPECTED_FORMAT`. Export `storageEnv(env): StorageEnv` mirroring `githubAppEnv`/`mailEnv`:
      a discriminated union on `provider`, complete when non-null.
- [ ] 1.4 **Test (unit)** extend `apps/server/src/config/env.test.ts`: defaults with nothing set;
      each of the four S3 variables individually missing produces a boot failure naming it; an
      out-of-range `ATTACHMENT_MAX_BYTES` and a malformed `ATTACHMENT_GC_CRON` each fail naming the
      variable; whitespace-only values read as absent.

## 2. Migration `0017_attachments` and the schema surface

- [ ] 2.1 Write `packages/schema/src/migrations/0017_attachments.ts` — **`0017`, not `0016`**, which
      `auto_status` already took. One table per design.md §D4, three indexes (`team_id`; partial on
      `issue_id`; partial on `created_at` where both edges are null — the sweep's index). `ON DELETE
      CASCADE` on `team_id` and `uploader_id`, **`ON DELETE SET NULL`** on `issue_id` and
      `comment_id`. `down()` drops the table. Register it in `migrations/index.ts`.
- [ ] 2.2 Add `attachment` to the hand-written Kysely `DB` interface in
      `packages/schema/src/db/types.ts`. Follow the connectors decision: DB-defaulted columns are
      plain `Timestamp`/`boolean`, never `Generated<…>` (kysely 0.28.17's `Generated` does not
      unwrap and mis-types both select and update).
- [ ] 2.3 Add the `attachment` table to the Zero schema in `packages/schema/src/zero/schema.ts` with
      `team`, `issue` and `comment` relationships, plus the reverse `attachments` relationship on
      `issue` and on `comment`. `byte_size` as `number()`; the nullable edges `.optional()`.
- [ ] 2.4 Add `attachments.byIssue` to `packages/schema/src/zero/queries.ts`, wrapped in
      `teamScoped`, ordered by `createdAt asc`. **No mutator** — and add a one-line comment saying
      the absence is deliberate and why, since every other synced table has one.
- [ ] 2.5 Create `packages/schema/src/db/attachment.ts` with the server-only accessors the REST path
      needs: `createAttachment`, `findAttachmentForReader` (id + reader scope in **one** statement,
      per design §D7), `attachAttachment`, `deleteAttachment`, `listOrphanedAttachments`. Export from
      the `@yapm/schema/db` subpath only. No `apps/server` module writes SQL against this table —
      the `db/search.ts` one-file rule.
- [ ] 2.6 **Test (integration)** extend `packages/schema/src/db/schema-drift.test.ts` so the table
      and every column are asserted present in Postgres and in the Zero schema.
- [ ] 2.7 **Verify on the live stack before building on it** (the `search` I1 / `auto-status` I1
      precedent). From `down -v`:
      `POSTGRES_HOST_PORT=5447 ZERO_CACHE_HOST_PORT=4855 YAPM_HOST_PORT=3007 docker compose -p yapm-at -f docker/docker-compose.dev.yml up -d`.
      Apply the migration against a **live** zero-cache and read the write-worker log; then delete
      the replica volume and restart to exercise the fresh-install copy path. `bigint` is the one
      column type here not already on the replication path — confirm it is copied and replicated
      rather than assuming. Record what the write-worker actually applied in design.md
      §"Decisions made during implementation". Tear down with
      `docker compose -p yapm-at -f docker/docker-compose.dev.yml down -v`.

## 3. The storage seam and its two providers

- [ ] 3.1 Create `apps/server/src/storage/provider.ts`: the `StorageProvider` interface with exactly
      `kind`, `put`, `get`, `delete`, `health`, plus `StoredObject`, the exported key-shape regex and
      a `validateKey` helper. Carry a file-header comment stating the invariant the way
      `db/search.ts` does — **no member of this interface may return a URL**, and why (a
      capability at rest in a Zero-synced document; a permission model that becomes
      provider-dependent; a check that would pass under `local` and fail under `s3`).
- [ ] 3.2 Create `apps/server/src/storage/local.ts`: `createLocalStorageProvider({ dir })`.
      `validateKey` first, then `node:fs/promises` over `<dir>/<teamId>/<id>`. `put` writes to a
      temporary name in the same directory and renames, so a crashed upload leaves no half file.
      `get` returns `null` on `ENOENT`. `delete` swallows `ENOENT`. `health` writes, reads back and
      unlinks a probe file, so an unwritable or missing mount fails readiness at boot.
- [ ] 3.3 Create `apps/server/src/storage/s3.ts`: `createS3StorageProvider({ bucket, region,
      accessKeyId, secretAccessKey, endpoint?, forcePathStyle?, fetch? })` using `AwsClient` from
      `aws4fetch`. `validateKey` first. PUT/GET/DELETE/HEAD, `fetch` injected exactly as
      `resend.ts` injects it so tests need no credentials and make no network call. `get` returns
      `null` on 404. `delete` treats 404 as success. `health` is a `HEAD` on the bucket. A non-2xx
      elsewhere throws a typed error carrying status and body, mirroring `ResendSendError`.
- [ ] 3.4 Create `apps/server/src/storage/index.ts` with `createStorageProvider(env, logger)` on the
      `createMailer` precedent: reads `storageEnv`, returns exactly one provider, logs which one at
      `info`. Re-export the public types. **Never returns `null`** — unlike email, storage is not an
      optional feature; the local default is always available.
- [ ] 3.5 **Test (unit)** `apps/server/src/storage/local.test.ts` and `s3.test.ts`: round-trip
      put/get/delete; `get` on a missing key is `null`; double `delete` succeeds; the traversal table
      (`..`, leading `/`, backslash, null byte, non-hex characters, a key with three segments, a
      `.thumb.thumb`) rejects **before** any filesystem or fetch call — assert the injected `fetch`
      was never invoked; `health` fails on an unwritable directory. Same table drives both
      providers, because the guarantee is that they are peers.

## 4. Content sniffing and thumbnails

- [ ] 4.1 Create `apps/server/src/storage/sniff.ts`: a fixed magic-number table for PNG, JPEG, GIF,
      WebP and AVIF returning the media type, and `null` for everything else. Pure, no imports.
      Plus `contentDispositionFor(filename, inline)` producing an RFC 6266 header with a sanitised
      ASCII fallback and a `filename*` UTF-8 form, stripping control characters and quotes.
- [ ] 4.2 Create `apps/server/src/storage/thumbnail.ts`: `sharp` at `limitInputPixels: 268402689`
      (stated, not inherited), longest-edge 512, WebP output, `withoutEnlargement`. Returns `null` on
      any decode failure rather than throwing — a thumbnail is an optimisation, not a validity
      condition. Also strips metadata (EXIF GPS on a pasted phone screenshot is a privacy leak the
      thumbnail should not carry forward).
- [ ] 4.3 **Test (unit)** `sniff.test.ts`: each allowlisted format from real magic bytes; an SVG, an
      XML document, an HTML document and a zip each sniff to `null`; a PNG with a `.jpg` name and an
      `image/jpeg` claim sniffs `image/png`; a file shorter than the longest signature does not
      throw. `contentDispositionFor` with quotes, CR/LF, a null byte and a non-ASCII name produces a
      well-formed single-line header.
- [ ] 4.4 **Test (unit)** `thumbnail.test.ts`: a generated PNG produces a WebP within the bound; a
      non-image buffer returns `null`; an image smaller than the bound is not enlarged; EXIF is
      absent from the output.

## 5. The routes

- [ ] 5.1 Create `apps/server/src/storage/routes.ts` exporting `createFileRoutes(options)` and
      `FILES_API_BASE = '/api/v1/files'`. Define **one** module-level `REFUSAL` constant — status,
      body and headers together — with a comment on the `search/routes.ts` `EMPTY` model naming why
      it is one shape. Every non-401 failure returns it.
- [ ] 5.2 `GET /:id` and `GET /:id/thumb`: parse → session → **single scoped statement** →
      `provider.get`. `Cache-Control: private, max-age=300` on success, `no-store` on the refusal.
      `X-Content-Type-Options: nosniff` and `default-src 'none'; sandbox` via `hono/secure-headers`
      on both. `Content-Disposition` from §4.1 — `inline` only for a sniffed raster type. Stream the
      body; never buffer a 25 MiB file to serialise it.
- [ ] 5.3 `POST /` under `hono/body-limit` at `ATTACHMENT_MAX_BYTES`: session → team membership with
      write access (viewers refused) → optional `issueId`/`commentId` must be in the same team →
      read the part → sniff → `newId()` → `put` original → thumbnail → `put` thumb → insert row →
      respond with `{ id, contentType, byteSize, hasThumbnail }` and **no URL**. On any failure after
      the object is written, delete what was written before responding.
- [ ] 5.4 `PATCH /:id` (attach once, from null, same team) and `DELETE /:id` (object, thumbnail, row;
      idempotent). Both refuse with the same `REFUSAL` for anything the caller may not see.
- [ ] 5.5 Mount in `apps/server/src/app.ts` as an optional `files?: Hono` beside `search`, and build
      it in `apps/server/src/index.ts` from the provider, the db and the auth service.
- [ ] 5.6 Add a `storage` readiness check calling `provider.health()` to the `readinessChecks` array
      in `index.ts`, following the existing checks' shape.

## 6. Deployment surface

- [ ] 6.1 `docker/Dockerfile`: create `/var/lib/yapm/files` in the runtime stage and `chown` it to
      `yapm:yapm` **before** `USER yapm`, so a bind-mounted host path is not silently unwritable by
      uid 1001.
- [ ] 6.2 `docker/docker-compose.yml` and `docker/docker-compose.dev.yml`: a `files` named volume
      mounted at `/var/lib/yapm/files` on the `yapm` service, plus the `STORAGE_*` and `ATTACHMENT_*`
      environment lines. Follow the existing convention exactly: `${VAR:-}` for things that are
      cleanly off when empty, **literal defaults** for the numeric and cron values (an empty cron
      fails `min(1)` and an empty number coerces to 0). Still three services.
- [ ] 6.3 Update `.env.example` with the full storage block, commented: local is the default and is
      complete; the S3 quartet is all-or-nothing; `S3_ENDPOINT` covers R2/B2/Garage/a MinIO you
      already run; and a line saying there are no shareable links by design.
- [ ] 6.4 Run the compose smoke test (`node scripts/smoke.mjs` or its documented invocation) against
      the `yapm-at` project on ports 5447/4855/3007 and confirm it still passes with the new volume
      and the native module in the image.

## 7. The orphan sweep

- [ ] 7.1 Create `apps/server/src/jobs/attachments.ts`: `ATTACHMENT_GC_QUEUE` and
      `runAttachmentGc({ db, provider, graceHours, logger, now, limit })`. Select orphans via the
      §2.5 accessor, bounded by `limit`; for each, delete the thumbnail, then the object, then the
      row — **objects before rows**, so a crash leaves a row whose bytes are gone (already the
      standard refusal) rather than bytes nobody can name. Contains its own per-row failures and
      never rejects.
- [ ] 7.2 Register it as a fourth independent block in `apps/server/src/jobs/scheduler.ts`:
      `attachments?: AttachmentSchedulerOptions` on `StartSchedulerOptions`, its own `try`, on the
      **shared** `boss`. No second `PgBoss`, no second `boss.start()`. Wire it in `index.ts`.
- [ ] 7.3 **Test (unit)** `jobs/attachments.test.ts` against a fake provider and a fake db: an
      unattached row past the grace window is collected (thumbnail, object, row, in that order); one
      inside the window is untouched; an attached row is untouched however old; a provider failure on
      one row does not abort the pass; the pass respects `limit`.
- [ ] 7.4 **Test (unit)** extend `scheduler`'s existing topology test — with the injected `boss` —
      that the attachment queue is created and scheduled on the configured cron, that a throwing
      attachment registration still leaves cycles/notifications/search registered, and that exactly
      one `PgBoss` is constructed.

## 8. The capability guard

- [ ] 8.1 Create `apps/server/src/storage/no-capability.test.ts`, structured like
      `apps/server/src/search/isolation.test.ts`. Three assertions: (a) no file under
      `apps/server/src/storage/` contains `presign`, `signedUrl`, `getSignedUrl`,
      `createPresignedUrl`, `X-Amz-Signature` or `getUrl`, case-insensitively on a word boundary;
      (b) the `StorageProvider` member list, **parsed out of `provider.ts` source**, is exactly
      `kind, put, get, delete, health` — so an added member fails whatever it is called; (c) no
      `http` appears in an attribute value under `packages/schema/src/rich-text/` or
      `packages/ui/src/editor/`, so the guard is in place before change 17 writes the image node.
- [ ] 8.2 Add a self-check to that file, on the isolation test's precedent: assert the derived member
      list is non-empty and contains `put`, so a parse that silently returns nothing cannot make the
      guard vacuously pass.

## 9. Tests

- [ ] 9.1 **Test (integration, live Postgres)** `apps/server/src/storage/routes.pg.test.ts` — **the
      falsifiable check.** Seed two workspaces' worth of teams and members. Upload a known PNG as a
      member of team A. Then capture three full responses as a member of team B: the real
      attachment id, a random UUID that was never uploaded, and a non-UUID string. Assert all three
      are **byte-identical** — same status, same body bytes, same header set and values excluding
      `Date`. Then assert the positive leg as a member of team A: `200`, the exact uploaded bytes,
      `Cache-Control: private, max-age=300`, `Content-Type: image/png`, `Content-Disposition:
      inline`, `X-Content-Type-Options: nosniff`. **This fails on `main`** — there is no upload
      route, so the positive leg cannot pass — and it is the single check that says the change is
      correct.
- [ ] 9.2 **Test (integration)** the rest of the route contract in the same file: a viewer cannot
      upload; an upload naming a team the caller is not in is refused; an upload whose `issueId` is
      in a different team is refused; an oversized `Content-Length` is refused before the body is
      read; a lying `Content-Length` is aborted mid-stream and leaves no readable object; an SVG
      round-trips as `application/octet-stream` + `Content-Disposition: attachment` and never as
      `image/svg+xml`; `/thumb` on a `has_thumbnail: false` row is the standard refusal; `DELETE` is
      idempotent and the second call is the standard refusal.
- [ ] 9.3 **Test (integration)** `attachments.byIssue` scoping in the schema package's synced-query
      test style: a member of the owning team sees the rows; a member of another team gets empty;
      an unauthenticated context gets empty; a workspace admin sees them under the existing
      `teamScoped` bypass.
- [ ] 9.4 **Test (unit)** assert the two absences the design depends on: the shared mutator map
      contains no mutator writing `attachment`, and `MUTATOR_TOOL_KINDS` therefore has no attachment
      entry while its exhaustiveness check still passes.
- [ ] 9.5 **Test (e2e, Playwright)** `apps/web/e2e/attachments.spec.ts` — one focused spec, not a
      suite. Against the real three-container stack with the **local** provider and the real named
      volume: a signed-in member uploads a PNG through `/api/v1/files`, fetches it back and gets the
      same bytes with the expected headers; a signed-in member of another team gets the byte-
      identical refusal. This is the only place the docker volume, the non-root uid and the native
      module are exercised together. Per PROCESS §3 this change touches a synced entity **and** a
      permission surface — two of the four — so all three tiers apply.

## 10. Documentation

- [ ] 10.1 New `apps/docs/src/content/docs/self-hosting/attachments.md`: the two providers and how to
      choose; the full env block; the volume; upload limits; what the orphan sweep does and its
      grace window; **why there are no shareable links** (the Zero-replication argument, stated for
      an operator rather than for a reviewer); and the SVG download-not-render behaviour.
- [ ] 10.2 Update `apps/docs/src/content/docs/self-hosting/backup-restore.md` (or create it if
      absent) with design §D13: what backup covers per provider, restore ordering, and the
      attachment table as the manifest for an S3 operator's own bucket backup.
- [ ] 10.3 Add the sidebar entry in `apps/docs/astro.config.mjs`.
- [ ] 10.4 Update `README.md` ("What works today") and `ROADMAP.md` — row 15 to shipped, and the
      §Known gaps one-command-export paragraph at line 54, which now has half its substrate.
- [ ] 10.5 Update `TECHSTACK.md`: the attachments line (both providers, no signed URLs) and a note
      that the runtime image now contains a native module, with the cross-architecture build
      constraint from design §D9. Update the `yapm backup` line at ~134 to point at the written
      contract.
- [ ] 10.6 Update `CLAUDE.md` §"Non-negotiable constraints" only if this change makes a listed
      constraint stale — it should not; verify rather than assume, and say so in the PR description.
- [ ] 10.7 Run `pnpm turbo lint typecheck test build` and `node scripts/check-boundaries.mjs`,
      `node scripts/check-catalog.mjs`. Report actual output; never claim a gate passed without
      running it.
