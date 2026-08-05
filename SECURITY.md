# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](../../security/advisories/new), or email
**thettweaung@gmail.com** with `[yapm security]` in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. A proof of
concept helps but isn't required.

You'll get an acknowledgement within 72 hours and an assessment within a week. If the report is
valid, we'll agree on a disclosure timeline with you — the default is a fix released before
public disclosure, with credit to you unless you'd rather stay anonymous.

## Supported versions

yapm is pre-alpha. Until a 1.0 release, only the latest version receives security fixes.

## Scope

In scope: the yapm application, its container images, and its default self-hosted configuration.

Out of scope: vulnerabilities in third-party dependencies (report those upstream, though we
appreciate a heads-up), and issues that require an already-compromised host or database.

## For self-hosters

### Change the shipped secrets

This repository publishes default values for `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`,
`ZERO_QUERY_API_KEY`, `ZERO_MUTATE_API_KEY` and `ZERO_ADMIN_PASSWORD` so that an empty `.env` boots
for evaluation. They are printed in `.env.example` and in `docker/docker-compose.yml`, so an instance
still running on one is as protected as an instance with no secrets at all. `BETTER_AUTH_SECRET` is
the sharpest: it encrypts the JWKS private key at rest, so a known value plus any database read mints
a sync token for any user.

`node scripts/init-env.mjs` generates all five. Under `NODE_ENV=production` the app **refuses to
start** on the four it can observe, naming each one, unless `YAPM_ALLOW_INSECURE_DEFAULTS=true` is set
— which is for evaluation boxes, warns by name on every boot, and is reported by `/readyz`. See
[Deploy and harden](apps/docs/src/content/docs/self-hosting/deploy.md).

Note that `docker compose … -f docker/docker-compose.yml` must be passed `--env-file .env`: `-f
docker/…` makes `docker/` Compose's project directory, so without it your environment file is not
read and the published defaults apply silently.

### Images

Images are published to GHCR on **every push to `main`** as `edge` and `sha-<short-sha>`, and on a
release as `<major>.<minor>.<patch>` (plus the `<major>.<minor>` and `<major>` moving tags), `stable`
and `latest`. Multi-arch (linux/amd64, linux/arm64). Publishing does not depend on
the release job succeeding, so there is always a current artifact.

**What is not claimed:** the images are **not signed**, carry **no provenance attestation**, and are
**not vulnerability-scanned** by this pipeline. Verify them yourself if your threat model requires it.

### Upgrades

Security fixes ship in patch releases. Watch releases, or pin the `stable` tag and pull regularly:

```bash
docker compose --env-file .env -f docker/docker-compose.yml pull yapm
docker compose --env-file .env -f docker/docker-compose.yml up -d --wait
```

Migrations apply automatically on boot and are **forward-only**. Rolling back to an older image after
a migration has applied crash-loops; the recovery is a database restore. See [Upgrade and
rollback](apps/docs/src/content/docs/self-hosting/upgrade.md).
