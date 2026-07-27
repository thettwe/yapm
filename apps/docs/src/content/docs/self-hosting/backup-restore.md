---
title: Backup and restore
description: What a complete yapm backup contains, the procedure for each storage provider, why files are captured before the database, and what you can safely throw away.
---

A yapm instance holds durable state in **two** places, and only two: the Postgres database, and —
under the local storage provider — the [attachment](/self-hosting/attachments/) directory. Everything
else in the stack is derived and can be rebuilt from those.

:::caution[`yapm backup` is not implemented yet]
The one-command backup promised in the README is still unwritten. Its contract is settled and written
down below, and the manual procedure on this page is exactly what that command will automate. Follow
it in the meantime.
:::

## What has to be captured

| Data | Where | In a backup? |
|---|---|---|
| Issues, comments, teams, cycles, accounts, sessions | Postgres (`pgdata` volume) | **Yes** — `pg_dump` |
| Attachment metadata | Postgres, `attachment` table | **Yes** — part of the same dump |
| Attachment bytes, local provider | `files` volume, `STORAGE_LOCAL_DIR` | **Yes** — `tar` |
| Attachment bytes, s3 provider | your bucket | **Your bucket's own backup** — see below |
| zero-cache replica | `zero-replica` volume | **No.** Rebuilt from Postgres on first boot |
| Search index | Postgres, `search_document` | Captured with the dump; rebuilt anyway if lost |

**The `zero-replica` volume is disposable.** It is a SQLite copy of Postgres that zero-cache
rebuilds by initial sync. Backing it up buys nothing, and restoring a stale one is worse than not
having it.

## Order matters: files first, then the database

Neither procedure below is atomic across the two stores, and it does not need to be — as long as you
capture in the right order.

**Capture the files first, then dump the database.** Then every row in the dump refers to bytes that
were already in the file backup. The reverse order leaves a window where a row is in the dump and its
bytes are not, which is a broken image.

**Restore the database first, then the files.** A row whose bytes are missing already serves an
ordinary "not found" and is repaired the moment the files land; bytes with no row are unreachable
garbage that nobody ever asks for.

That asymmetry — files before rows on the way out, rows before files on the way in — is deliberate.
Every intermediate state is one the running application already handles.

## Local provider (the default)

```bash
# 1. Files first.
docker run --rm -v yapm_files:/files -v "$PWD:/backup" busybox \
  tar czf /backup/yapm-files.tar.gz -C /files .

# 2. Then the database.
docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U yapm -d yapm --clean --if-exists > yapm-db.sql
```

Restore, into a stack whose containers are running but which has no data yet:

```bash
# 1. Database first.
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U yapm -d yapm < yapm-db.sql

# 2. Then the files.
docker run --rm -v yapm_files:/files -v "$PWD:/backup" busybox \
  tar xzf /backup/yapm-files.tar.gz -C /files

# 3. Discard the stale replica and let zero-cache resync from Postgres.
docker compose -f docker/docker-compose.yml stop zero-cache
docker volume rm yapm_zero-replica
docker compose -f docker/docker-compose.yml up -d zero-cache
```

Step 3 is not optional. zero-cache's replica was built from the *old* database; after a restore it
must be rebuilt, and the shortest correct way to do that is to delete it.

Volume names are prefixed with the compose project name — `yapm_files`, `yapm_pgdata`,
`yapm_zero-replica` for the shipped `docker/docker-compose.yml`. `docker volume ls` confirms yours.

## S3 provider

**`pg_dump` only.** yapm does not stream your bucket through the app container to produce a tarball:
that would be slow, expensive, and worse than what the bucket already offers. Versioning, lifecycle
rules and cross-region replication are bucket features, and they are the right tool.

What yapm gives you instead is a **manifest**. Every row in the `attachment` table names an object
that must exist, at the key `<team_id>/<id>` (and `<team_id>/<id>.thumb` when `has_thumbnail` is
true). So you can *verify* a bucket backup rather than trust it:

```sql
select id, team_id, filename, byte_size, has_thumbnail from attachment order by created_at;
```

The same ordering rule applies: snapshot or verify the bucket first, dump the database second.

## What a restore does not bring back

- **Sessions.** Everyone signs in again. Session rows are in the dump, but cookies are bound to
  `BETTER_AUTH_SECRET` — if that changed, sessions are void.
- **In-flight jobs.** The pg-boss queues are in the dump; scheduled work simply runs on its next
  cron tick.
- **The search index, if you dumped without it.** It rebuilds itself in the background; see
  [Search index](/self-hosting/search-index/).

## Verifying a backup

The cheap check that actually catches the common failure — a database backup with no file backup:

```sql
select count(*) from attachment;
```

Compare it against the number of files in the tarball (`tar tzf yapm-files.tar.gz | wc -l`, which
counts thumbnails too, so expect it to be larger). A count of attachments with an empty file archive
means you have backed up the metadata and lost the bytes.
