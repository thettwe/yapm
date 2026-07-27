---
title: Attachments
description: Where uploaded files live, choosing between local disk and S3-compatible storage, the eleven environment variables, upload limits, the nightly orphan sweep, why there are no shareable links, and how SVGs are served.
---

Editor images and issue files need somewhere to put bytes. yapm ships two places: a **directory on
disk** and any **S3-compatible bucket**. They are peers, not a default and a fallback — the
permission check, the response headers and the refusal are literally the same code either way.

**There is nothing you have to configure.** Local disk is the default, it is complete, and a fresh
instance uploads and serves with an empty `.env`.

## What it adds to your deployment

**No container.** Not MinIO, not a reverse proxy, not a CDN. The deployment is still `postgres` +
`yapm` + `zero-cache`, and the app process is the only thing between a browser and a byte.

**One named volume.** `docker/docker-compose.yml` mounts `files` at `/var/lib/yapm/files`. That
volume is the whole of your attachment storage under the local provider — back it up, move it,
`du -sh` it.

**One table**, created by migration `0017_attachments`. It holds an id, the owning team, the
optional issue/comment it is attached to, the uploader, a filename, the sniffed content type, a byte
count and whether a thumbnail exists. It does **not** hold a storage key, a path or a URL: the key
is derived as `<team-uuid>/<attachment-uuid>` where the bytes are handled.

**A native module in the image.** `sharp` (thumbnails) is the first native dependency in the runtime
image — roughly +10 MB. It matters in one place only: **building for an architecture other than the
build host's** needs either a build on the target architecture or pnpm's `supportedArchitectures`,
because sharp ships prebuilt platform binaries. The published images are unaffected.

## Choosing a provider

| | `local` (default) | `s3` |
|---|---|---|
| Configuration | none | four variables, all four required |
| Where bytes live | `STORAGE_LOCAL_DIR` | your bucket |
| Backup | `tar` the directory | your bucket's own versioning/replication |
| Good for | one box, one volume, most self-hosters | many app replicas, or bytes you want outside the box |

**Pick `local` unless you have a reason not to.** A single VPS with a volume is a complete,
supported deployment; `s3` exists for operators who already run object storage or who want the bytes
somewhere the app container is not.

`S3_ENDPOINT` makes the `s3` provider work against **Cloudflare R2, Backblaze B2, Garage, SeaweedFS,
or a MinIO you already run** — anything that speaks SigV4. yapm signs requests itself with
[`aws4fetch`](https://github.com/mhart/aws4fetch) (~4 KB, zero dependencies) rather than pulling in a
vendor SDK, exactly as the [Resend mailer](/self-hosting/email/) does.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_PROVIDER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_DIR` | `/var/lib/yapm/files` | Local provider only. Probed at boot — see below |
| `S3_BUCKET` | — | Required when `STORAGE_PROVIDER=s3` |
| `S3_REGION` | — | Required when `STORAGE_PROVIDER=s3`. Use `auto` for R2 |
| `S3_ACCESS_KEY_ID` | — | Required when `STORAGE_PROVIDER=s3` |
| `S3_SECRET_ACCESS_KEY` | — | Required when `STORAGE_PROVIDER=s3` |
| `S3_ENDPOINT` | — | Empty means AWS (`https://s3.<region>.amazonaws.com`) |
| `S3_FORCE_PATH_STYLE` | `false` | `true` addresses objects as `<endpoint>/<bucket>/<key>` (MinIO, Garage) |
| `ATTACHMENT_MAX_BYTES` | `26214400` (25 MiB) | Hard ceiling on one upload, 1 KiB–1 GiB |
| `ATTACHMENT_ORPHAN_GRACE_HOURS` | `24` | How long an unattached upload survives, 1–8760 |
| `ATTACHMENT_GC_CRON` | `23 4 * * *` | When the orphan sweep runs |

**The S3 four are all-or-nothing.** `STORAGE_PROVIDER=s3` with any of `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` missing **fails boot**, naming the ones that are absent.
A half-configured object store that silently falls back to disk is how bytes end up in two places.

**Storage is a gating readiness check.** At boot the configured provider writes, reads back and
unlinks a probe (local) or issues a `HEAD` on the bucket (s3). A missing mount, a read-only volume or
a wrong key means `/readyz` never goes green — deliberately, so the failure surfaces at deploy time
rather than at somebody's first paste. If you run the server outside the container, set
`STORAGE_LOCAL_DIR` to a path your user can write.

## Uploading and serving

Uploads go to `POST /api/v1/files` as `multipart/form-data` — one file per request, with the owning
`teamId` and optionally the `issueId`/`commentId` it belongs to. The response is an **id and three
facts** — the sniffed content type, the byte size and whether a thumbnail exists — and no URL of any
kind.

- **Members upload; viewers do not.** Viewers are read-only everywhere else and are read-only here.
  They can read every attachment their teams own.
- **The size limit is enforced before anything is buffered**, by whichever of two checks applies: an
  upload that declares a `Content-Length` over `ATTACHMENT_MAX_BYTES` is rejected before a byte is
  read, and one that declares no length at all (chunked) is counted as it arrives and cut off at the
  same ceiling.
- **The stored content type is sniffed from the bytes**, never taken from the upload's own claim.
  A file whose bytes are not one of PNG, JPEG, GIF, WebP or AVIF is stored as
  `application/octet-stream`.

Bytes come back from `GET /api/v1/files/<id>` and thumbnails from `GET /api/v1/files/<id>/thumb`,
both requiring a session and both checked against the same team scope as everything else you can
read. Responses carry `Cache-Control: private, max-age=300`: images render instantly on revisit, and
a twenty-thumbnail issue costs zero requests on the second view.

That five minutes is a real, stated trade. For up to five minutes after someone is removed from a
team, their browser can still paint images it had already downloaded. It cannot fetch new ones, and
those are bytes they could equally have screenshotted.

### SVGs are downloaded, never rendered

An SVG is a script delivery vector — an `<img src>` pointing at one that a browser renders in your
origin can carry JavaScript. yapm's sniffer has a **fixed allowlist of five raster formats**, and an
SVG matches none of them. So an uploaded SVG:

- is stored and served as `application/octet-stream`, never as `image/svg+xml`;
- comes back with `Content-Disposition: attachment`, so the browser downloads it;
- gets no thumbnail;
- is served under `Content-Security-Policy: default-src 'none'; sandbox` and
  `X-Content-Type-Options: nosniff`, so even a mis-sniffed response has no script capability.

The same is true of XML, HTML and anything else outside the allowlist. This is not configurable, and
there is no "trusted SVG" setting.

### There are no shareable links, and no setting turns them on

Every other tool in this category hands you a signed, expiring URL. yapm does not, and it is worth
knowing why before you go looking for the option.

An image in an issue description lives in a **document that syncs**. Whatever string sits in that
image node is replicated to every team member's device and stored there for as long as the document
exists. A signed URL in that position is:

- a **bearer token at rest on every client** — anyone who can read the local database of any
  teammate's browser has a link that works without a session;
- **permanently broken the moment it expires**, which is what "an old issue's images are all dead"
  looks like;
- unfixable without rewriting the issue description on a timer, which would churn the document,
  re-run mention resolution and reindex it for search on every rewrite, and leave a "last updated"
  timestamp that lies.

So the document stores an **opaque id and nothing else** — not a URL, not even a relative path — and
the app proxies the bytes for both providers. That is also what makes the permission model identical
whichever provider you pick: with a signed URL, `local` and `s3` would enforce access in two
different places, and only one of them would ever be tested.

The consequence to plan for: **an attachment is only reachable by someone signed in to your instance
with access to the owning team.** There is no link you can paste into a public bug report.

## The orphan sweep

Somebody pastes an image into a comment and then closes the tab. The bytes were uploaded; the comment
never existed. Nothing links them, and without a sweep they would accumulate forever.

A nightly job on `ATTACHMENT_GC_CRON` (default `23 4 * * *`) collects every attachment that has
**neither an issue nor a comment** and was created more than `ATTACHMENT_ORPHAN_GRACE_HOURS` ago
(default 24). It deletes the thumbnail, then the object, then the row — objects first, so an
interrupted pass leaves a row whose bytes are gone (already an ordinary "not found") rather than
bytes nobody can name. Each pass is bounded, idempotent and safe to re-run.

It shares the **existing** pg-boss scheduler with cycle rollover, the notification sweeps and
[search indexing](/self-hosting/search-index/) — no extra process, no extra container.

**The sharp edge, stated plainly:** somebody who pastes an image and leaves the tab open longer than
the grace window *without the document ever saving* loses that image. Twenty-four hours makes that
essentially impossible for a human. Raise `ATTACHMENT_ORPHAN_GRACE_HOURS` if you disagree.

**Deleting an issue or comment does not delete its files immediately.** The link is nulled instead
of cascading, which makes those files orphans — collected by a later sweep, not inside somebody's
transaction. Note that the grace window is measured from **upload**, not from when the link was
removed: a file attached to an issue you delete a month from now is collected by the very next
sweep, because it was created long before the cutoff.

## Watching storage grow

There are no per-team quotas, no usage dashboard and no refuse-when-full behaviour. Four things bound
growth instead:

- `ATTACHMENT_MAX_BYTES` per file — the only hard limit;
- the orphan sweep, which is what stops abandoned pastes accumulating;
- deleted issues and comments becoming orphans, so their bytes do go away — one sweep later;
- thumbnails being WebP at longest-edge 512, typically 15–40 KB — a few percent, not a doubling.

The honest way to see what attachments cost you is `du -sh /var/lib/yapm/files` (or your bucket's own
metrics) alongside `select count(*), sum(byte_size) from attachment;`.

## Backing them up

See [Backup and restore](/self-hosting/backup-restore/) — the answer differs by provider, and the
restore ordering matters.
