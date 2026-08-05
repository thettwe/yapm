---
title: Upgrade and rollback
description: The upgrade command for each of the two deployment shapes, which upgrades are operationally breaking, and the honest answer about rolling back — there is no down-migration.
---

Migrations are **forward-only** and apply automatically at boot: the app container runs Kysely's
migrator (advisory-locked, transactional), then better-auth's `getMigrations()`, then the workspace
seed, and only then serves traffic. There is no manual migration step in either upgrade path below —
and, for the same reason, no downgrade path. Read [Rollback](#rollback) before you need it.

## Which shape are you running?

| | Locally built | Prebuilt image |
|---|---|---|
| `YAPM_IMAGE` in `.env` | unset (or `yapm:local`) | `ghcr.io/thettwe/yapm:<tag>` |
| Where the image comes from | `docker/Dockerfile`, built on your host | GHCR |
| You need | a checkout of this repository | the compose file and your `.env` |

Both run the same three containers and the same compose file.

## Back up first

Every upgrade applies migrations at boot, and that is the step you cannot undo. Take a backup
**before** you pull:

```bash
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres \
  pg_dump -U yapm -d yapm --clean --if-exists > yapm-$(date +%F).sql
```

That is deliberately the **same artifact** [Backup and restore](/self-hosting/backup-restore/) takes
and the same one its restore step consumes with `psql` — one round trip, described in one place.
`--clean --if-exists` is what lets it be restored over a database that already has the newer schema,
which is exactly the situation a rollback is. The full procedure, including attachment bytes, is on
that page.

## Upgrading a locally-built stack

```bash
cd yapm
git pull

docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait
```

`--build` is what makes this an upgrade rather than a restart: without it Compose reuses the image it
already has. `--wait` blocks until the app's healthcheck passes, so the command failing is the
migration or the boot failing, not something you discover later.

Check the new version came up, and that nothing regressed in configuration:

```bash
curl -s localhost:3000/readyz | jq '.status, (.checks[] | select(.name == "configuration") | .detail)'
docker compose --env-file .env -f docker/docker-compose.yml logs yapm | grep 'migration applied'
```

## Upgrading a prebuilt-image stack

Set the tag you want in `.env`, then pull and recreate:

```bash
# .env
YAPM_IMAGE=ghcr.io/thettwe/yapm:edge
```

```bash
docker compose --env-file .env -f docker/docker-compose.yml pull yapm
docker compose --env-file .env -f docker/docker-compose.yml up -d --wait
```

Two details that a bare `docker compose pull && docker compose up -d` gets wrong against this stack:
the `-f docker/…` and `--env-file .env` pair (without it Compose reads no environment file and
interpolates published defaults — see [Deploy and harden](/self-hosting/deploy/)), and `pull yapm`
rather than `pull`, which would also re-pull Postgres and zero-cache and is rarely what you want in
the same step.

### Which tag

| Tag | Published when | Use it for |
|---|---|---|
| `edge` | every push to `main` | tracking development |
| `sha-<short-sha>` | every push to `main` | pinning an exact commit |
| `<major>.<minor>.<patch>` | a release is cut | production, pinned exactly |
| `<major>.<minor>`, `<major>`, `stable`, `latest` | a release is cut | production, following patches |

`ZERO_IMAGE` pins zero-cache separately, and it must stay in step with the `@rocicorp/zero` version
the app was built against — the wire protocol and schema shape have to agree. Change it only when a
release says to.

## Rollback

**There is no down-migration, and there is no plan to add one.** Once a newer image has booted
against your database, the schema has moved forward. An older image against that schema does not
degrade gracefully: it crash-loops at boot, restarts under `restart: unless-stopped`, and keeps
crash-looping.

Re-running the previous tag is therefore **not** a rollback. It is a second outage on top of the
first.

The real procedure, in the order it has to happen:

1. **Stop the stack.** `docker compose --env-file .env -f docker/docker-compose.yml down` — without
   `-v`, which would delete your volumes.
2. **Restore the database** from the backup you took before the upgrade, following [Backup and
   restore](/self-hosting/backup-restore/). This is the step that undoes the migration; nothing else
   does.
3. **Restore attachment bytes** if the upgrade window included uploads and you are restoring an older
   `pgdata` — the database first, then the files, for the reason that page explains.
4. **Pin the older tag** in `.env` (`YAPM_IMAGE=ghcr.io/thettwe/yapm:1.2.3`) or check out the older
   commit for a locally-built stack.
5. Bring it up and confirm `/readyz`.

Everything written between the backup and the rollback is **lost**. That is the actual cost, stated
plainly, and it is why the backup step above is not optional politeness.

The `zero-replica` volume needs no special handling: it is a derived SQLite copy of Postgres, and
zero-cache rebuilds it by initial sync. If a rollback leaves it inconsistent, delete it and let it
resync.

:::caution[If you have no backup]
There is no supported way back. Your options are to stay on the newer image, or to reconstruct the
older schema by hand — which is not a procedure this project can document, because it depends on
which migrations ran.
:::

## Breaking upgrades

Operationally breaking changes — ones where a stack that was running comes back up differently, or
does not come back up at all — are listed here.

### Shipped-default secrets now refuse to boot

**Applies to:** any instance upgrading past the `deployment-hardening` change.

An instance still running on the secrets this repository publishes now **exits at boot** under
`NODE_ENV=production` instead of starting. That is deliberate: those values are printed in this
repository, and `BETTER_AUTH_SECRET` encrypts the JWKS private key at rest, so a known value plus any
database read forges a sync token for any user.

If your stack stops starting after an upgrade and the log says `refusing to start: …`, you were
affected. Two ways forward:

- **Fix it** (do this): set `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `ZERO_QUERY_API_KEY` and
  `ZERO_MUTATE_API_KEY` in `.env` to random values and restart. See [Deploy and
  harden](/self-hosting/deploy/#what-has-to-change-before-you-expose-it).
- **Defer it**, for an evaluation box only: set `YAPM_ALLOW_INSECURE_DEFAULTS=true`. It boots, warns
  by name every time, and `/readyz` counts the defaulted variables for as long as it is set — the
  names are behind the admin-only `/api/v1/configuration`.

**Changing `BETTER_AUTH_SECRET` on an instance with users signs everyone out.** It invalidates every
session cookie and makes the stored JWKS unreadable, so the key material is regenerated on the next
boot. Users sign in again; nothing else is lost. Do it in a maintenance window and tell people first.

Changing `POSTGRES_PASSWORD` on a database that already exists needs the role changed inside Postgres
too — the variable is read at container creation, not applied to an existing role:

```bash
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres \
  psql -U yapm -d yapm -c "ALTER ROLE yapm WITH PASSWORD 'the-new-value';"
```

Then update `.env` to match and restart both the app and zero-cache — they read the same variable, so
they cannot disagree once it is right.

### The sync origin is no longer baked into the image

**Applies to:** anyone who set `VITE_ZERO_CACHE_URL`, or who built their own image to change it.

That variable is gone. The browser-facing sync origin is now **runtime** configuration served by the
app at `GET /api/config`, read from `ZERO_CACHE_PUBLIC_URL`. Set that instead; no rebuild is needed,
and one prebuilt image now serves any host.

If you were carrying a local image build solely to set the old variable, you can move to the
published `edge` or `stable` tags.
