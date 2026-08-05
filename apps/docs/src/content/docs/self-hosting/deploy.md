---
title: Deploy and harden
description: Taking a yapm instance from `docker compose up` to something you can expose — the secrets that must change and what each one protects, both published ports, TLS termination, sizing, and a first-run checklist.
---

yapm self-hosts as **exactly three containers**: the app (API, Zero endpoints and the built SPA in
one process), `zero-cache`, and Postgres. There is no Redis, no object store, no search cluster and
no required reverse proxy. This page is about the gap between "it came up" and "I can put a domain in
front of it".

## Install

From a clean checkout, on a host with Docker:

```bash
git clone https://github.com/thettwe/yapm.git && cd yapm

node scripts/init-env.mjs
docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait
```

`init-env.mjs` writes a repo-root `.env` from `.env.example`, replacing every secret this repository
publishes with 32 random bytes, and prints which variables it filled. It refuses to overwrite an
existing `.env` — your edits are safe to re-run against. It has no dependencies and runs before
`pnpm install`.

:::danger[`--env-file` is not optional]
`-f docker/…` makes `docker/` Compose's **project directory**, so Compose looks for `docker/.env` —
which does not exist. Without `--env-file .env` it reads no environment file at all and silently
applies every published default, including the secrets below. A stack booted that way is
indistinguishable from a stack with no secrets, and nothing about it looks wrong.
:::

Then edit `.env` for your host — at minimum the three origin variables under
[Origins must agree](#origins-must-agree) — and bring the stack back up with the same command.

## What has to change before you expose it

Four values are secrets this repository publishes. They are printed in `.env.example`, in
`docker/docker-compose.yml` and in every copy of this repo on GitHub, which makes an instance still
running on one **exactly as protected as an instance with no secrets at all**.

| Variable | What it protects | What a known value gets an attacker |
|---|---|---|
| `BETTER_AUTH_SECRET` | Session cookies, the Zero sync JWT, **and the JWKS private key at rest** | This one plus any database read is the ability to mint a sync token **for any user** — the whole workspace, as anybody. It is the sharpest value in the stack. |
| `POSTGRES_PASSWORD` | The database, for both the app and zero-cache | Every row: issues, comments, sessions, and the encrypted key material above. |
| `ZERO_QUERY_API_KEY` | `/api/zero/query` — the endpoint every read is authorised through | The ability to speak to the sync layer's read endpoint directly. |
| `ZERO_MUTATE_API_KEY` | `/api/zero/mutate` — the endpoint **every write** goes through | The same, for writes. |

A fifth, `ZERO_ADMIN_PASSWORD`, guards the zero-cache inspector and `/statz`. Only the `zero-cache`
container ever reads it, so the app cannot detect it for you — `init-env.mjs` fills it, and the
checklist below is where you confirm it.

`node scripts/init-env.mjs` sets all five. If you are hardening an instance that already has data,
change them by hand in `.env` and restart; note that **changing `BETTER_AUTH_SECRET` signs every user
out** and invalidates the stored JWKS (see [Upgrade and
rollback](/self-hosting/upgrade/#breaking-upgrades)), and that changing `POSTGRES_PASSWORD` on a live
database needs an `ALTER ROLE` inside Postgres, not just an env edit.

### The boot refusal

Under `NODE_ENV=production` — which the compose file sets — the app **refuses to start** while any of
those four is still at its shipped value. It exits non-zero before it listens and before migrations
run, so a refusal never leaves a half-migrated database behind, and the log names every offending
variable at once with the remedy for each:

```
FATAL: refusing to start: BETTER_AUTH_SECRET, DATABASE_URL, ZERO_MUTATE_API_KEY,
ZERO_QUERY_API_KEY still hold the values this repository ships, which are public;
run `node scripts/init-env.mjs` and restart with --env-file .env, or set
YAPM_ALLOW_INSECURE_DEFAULTS=true to run anyway
```

It names variables and never prints a value — the message is going into a log.

Outside production the same detection is a single `warn` and never blocks boot. `pnpm dev` needs no
configuration at all.

**The one escape hatch** is `YAPM_ALLOW_INSECURE_DEFAULTS=true`, which downgrades the refusal to that
same warning. It exists for evaluation boxes and for the compose stack a reviewer boots for ten
minutes. It is not a production setting: it warns by name on every boot and `/readyz` reports it for
as long as it is set. Choosing it is an explicit line in your own `.env`, which is the property the
old silent default lacked.

### Checking a running instance

If you missed the boot log, ask the instance:

```bash
curl -s localhost:3000/readyz | jq '.checks[] | select(.name == "configuration")'
```

```json
{
  "name": "configuration",
  "ok": true,
  "durationMs": 0.04,
  "detail": "shipped defaults still in use: BETTER_AUTH_SECRET"
}
```

The `configuration` entry is deliberately **non-gating**: it reports, it never fails readiness. An
instance holding a published secret is misconfigured, not unable to serve, and taking it out of
load-balancer rotation would turn a warning into an outage.

## Both ports are published, on all interfaces

`docker/docker-compose.yml` publishes **two** ports on `0.0.0.0`:

| Port | Service | Who talks to it |
|---|---|---|
| `3000` (`YAPM_HOST_PORT`) | app — API, auth, `/api/v1`, the SPA | Every browser |
| `4848` (`ZERO_CACHE_HOST_PORT`) | zero-cache — the sync WebSocket | Every browser, **directly** |

Postgres is not published at all in the production stack.

The second row is the one that surprises people: the browser opens its sync socket to zero-cache
itself, not through the app. **Both ports have to be reachable by your users, and both should be
terminated by the same TLS.** A deployment that proxies 3000 and leaves 4848 bare is a page served
over HTTPS trying to open a `ws://` socket, which every browser blocks as mixed content.

There is no fourth container here. yapm does not ship or require a proxy; this is the shape of the
one you already run.

### Terminating TLS in front of both

Caddy, as the shortest complete example:

```caddy
yapm.example.com {
    reverse_proxy localhost:3000
}

sync.yapm.example.com {
    reverse_proxy localhost:4848
}
```

Caddy proxies WebSocket upgrades with no extra configuration. With nginx you need the upgrade headers
explicitly on the sync host, and a read timeout long enough that an idle sync socket is not culled:

```nginx
location / {
    proxy_pass http://127.0.0.1:4848;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
}
```

Once a proxy is in front, bind the published ports to loopback so nothing reaches them directly. In
`.env`:

```bash
YAPM_HOST_PORT=127.0.0.1:3000
ZERO_CACHE_HOST_PORT=127.0.0.1:4848
```

Both are interpolated into the left-hand side of the port mapping, so a host-address prefix works as
written.

### Origins must agree

Three variables describe what a **browser** reaches. They are separate because they can legitimately
differ, and every one of them being wrong looks like a different bug:

| Variable | Set it to | Getting it wrong looks like |
|---|---|---|
| `BETTER_AUTH_URL` | `https://yapm.example.com` | OAuth callbacks land on the wrong origin; sign-in loops |
| `WEB_ORIGIN` | `https://yapm.example.com` | CORS rejections from the API for a page that otherwise loads |
| `ZERO_CACHE_PUBLIC_URL` | `https://sync.yapm.example.com` | The app renders, and stays empty: sync never connects |

`ZERO_CACHE_PUBLIC_URL` is served to the SPA at runtime by `GET /api/config`, so **changing it needs
no rebuild** — edit `.env`, restart, reload the tab. Confirm what an instance is actually serving:

```bash
curl -s https://yapm.example.com/api/config
{"zeroCacheUrl":"https://sync.yapm.example.com"}
```

Never point it at `http://zero-cache:4848`. That name resolves inside the compose network and nowhere
else; a browser cannot reach it.

If you serve the app and the sync socket from one hostname on different paths, put the path in the
URL (`https://yapm.example.com/sync`) and proxy that path to 4848 — zero-cache is addressed by
origin, so anything a browser can reach works.

## Sizing

Measured on an Apple-Silicon test box, idle, three containers together: **~0.85 GiB RAM**. Postgres
and zero-cache dominate; the app process is the smallest of the three. 2 GiB is a comfortable floor
for a small team, 4 GiB gives Postgres room for a working set that is not trivial.

CPU is unremarkable — two cores is plenty. The one spiky workload is zero-cache's **initial sync**,
which replicates the whole database into its SQLite replica on first boot and after a replica reset.

Disk is three volumes:

| Volume | Holds | Growth |
|---|---|---|
| `pgdata` | Everything durable: issues, comments, accounts, the search index | The whole of your data. Bounded by usage; retention sweeps bound notifications and disclosure records |
| `zero-replica` | zero-cache's SQLite copy of Postgres | Roughly tracks `pgdata`. **Disposable** — rebuilt by initial sync, never worth backing up |
| `files` | Attachment bytes under the local storage provider | `ATTACHMENT_MAX_BYTES` per upload (25 MiB default) × what your team pastes. `du -sh` it |

Budget for `pgdata` + `zero-replica` together, i.e. roughly **twice** your database size, plus
attachments. Only `pgdata` and `files` are in a [backup](/self-hosting/backup-restore/).

## First-run checklist

Before the first person who is not you signs in:

- [ ] `.env` exists at the **repo root** and every compose command passes `--env-file .env`.
- [ ] `node scripts/init-env.mjs` has run, or all five secrets are set by hand: `BETTER_AUTH_SECRET`,
      `POSTGRES_PASSWORD`, `ZERO_QUERY_API_KEY`, `ZERO_MUTATE_API_KEY`, `ZERO_ADMIN_PASSWORD`.
- [ ] `YAPM_ALLOW_INSECURE_DEFAULTS` is **unset or `false`**. If the stack boots, the four the app can
      see are genuinely changed.
- [ ] `curl -s localhost:3000/readyz` reports `ready`, and its `configuration` entry says
      `no shipped defaults in use`.
- [ ] `BETTER_AUTH_URL`, `WEB_ORIGIN` and `ZERO_CACHE_PUBLIC_URL` all name origins a browser reaches,
      over `https` if anything is.
- [ ] `curl -s https://<your-host>/api/config` returns the public sync origin, not `localhost`.
- [ ] Both proxied hosts serve TLS, and the sync host forwards WebSocket upgrades.
- [ ] Ports 3000 and 4848 are bound to loopback (or firewalled) now that a proxy fronts them.
- [ ] `YAPM_BOOTSTRAP_ADMIN_EMAIL` is set to your address, or you have signed in first — the first
      authenticated user becomes the workspace admin.
- [ ] A [backup](/self-hosting/backup-restore/) has run once, and you have restored it once somewhere
      disposable. An untested backup is a belief, not a backup.
- [ ] You know the [upgrade path](/self-hosting/upgrade/) for your deployment shape, and that
      **rollback after a migration means restoring from that backup**.

## What this page does not ask you to install

No Redis. No Elasticsearch. No MinIO — the local storage provider is complete, and if you already run
an object store, `S3_ENDPOINT` points at it. No sidecar, no agent, no fourth container. Every optional
feature in the [configuration reference](/self-hosting/configuration/) is off by default and turning
it on adds a variable, not a service.
