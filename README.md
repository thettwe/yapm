<div align="center">

# yapm

**Yet Another Project Management** — because the good ones rent you your own data.

An open-source project management tool where **shipping work and delivery quality live in one place**.
Issues, pull requests, CI runs, deploys, and incidents in a single work graph — so DORA and
code-review health are just views, not a $30/developer/month add-on.

</div>

---

> **Status: pre-alpha.** The walking skeleton runs end-to-end — a synced `workspace` entity
> round-trips Postgres → zero-cache → browser and back through an optimistic shared mutator —
> but there are no product features yet. Architecture and direction are settled
> ([VISION.md](VISION.md), [TECHSTACK.md](TECHSTACK.md), [ROADMAP.md](ROADMAP.md)).

## Quickstart

You need **Docker** and **Node 24** with Corepack enabled. Nothing else — no accounts, no
tokens, no cloud services.

### Run it (self-host)

```bash
git clone https://github.com/thettwe/yapm.git && cd yapm
docker compose -f docker/docker-compose.yml up -d --build --wait
```

Open <http://localhost:3000>. This is the whole production deployment: **exactly three
containers** — the app (API + Zero endpoints + static SPA in one process), `zero-cache`, and
Postgres. No Redis, no reverse proxy, no object store.

### Hack on it (dev loop)

```bash
pnpm install
pnpm dev        # Postgres + zero-cache in Docker, server + Vite on the host, one command
```

Open the URL Vite prints (default <http://localhost:5173>). Edits to `apps/web` or
`apps/server` hot-reload. `pnpm dev:reset` wipes the dev database volumes.

### Honest numbers

Measured on this repo, Apple Silicon / Docker Desktop (Docker VM capped at ~7.6 GiB), with
base images already pulled. Not rounded in our favour.

| | Measurement |
|---|---|
| Containers (production) | 3 — `yapm`, `zero-cache`, `postgres` |
| `yapm` image size | 545 MB |
| Idle RAM, all three | ~0.85 GiB total (postgres ~97 MiB · app ~59 MiB · zero-cache ~700 MiB) |
| Disk for all three images | ~1.8 GB (`yapm` 545 MB + `postgres:18` 665 MB + `rocicorp/zero` 625 MB) |
| `pnpm install` | ~6 s with a warm pnpm store |
| `pnpm dev` → app reachable | ~14 s (Docker deps up, migrate, seed, Vite ready) |
| `docker compose up --build --wait` → all healthy | ~20 s with build cache; ~23 s cold-build with a warm BuildKit pnpm cache |

**First run on a genuinely cold machine is slower**: Docker pulls ~1.8 GB of base images and
pnpm downloads its store over the network before any of the times above apply. `zero-cache`
is the RAM floor of the stack (~700 MiB idle); the app process itself is ~60 MiB.

## Why another one

Jira is slow and charges full price for the 40 people who log in twice a month. Linear is
genuinely excellent but closed, and you still bolt a second tool on for reporting. The
"open source" alternatives cap your self-hosted instance at 12 seats and put SSO behind a
paywall — on hardware you own.

Meanwhile the tools that tell you how your engineering is *actually* going — LinearB,
Swarmia, Jellyfish — spend most of their engineering effort re-joining data your tracker
already threw away, and bill you per developer for the privilege.

yapm's bet: keep `issue ↔ PR ↔ CI run ↔ deploy ↔ incident` in **one graph**, and the hard
part of engineering metrics disappears.

## The promise

- **Free means free.** No seat caps. No SSO tax. No features waiting behind a license key.
  No upgrade nags in the UI you self-host. 100% AGPL — there is no `ee/` directory.
- **Free viewer seats, forever.** Stakeholders should never be a line item.
- **Fast.** Local-first sync: reads come from memory, not the network.
- **Three containers.** `docker compose up` on a small VPS. Not thirteen.
- **Your data.** One-command export, no lock-in, no phone-home you didn't agree to.

## Planned for v1

Teams and issues · keyboard-first list and board · cycles with rollover · triage inbox ·
projects and roadmap · command palette · GitHub App that links PRs to issues and moves
status from reality instead of memory.

Then: DORA and review-health metrics computed from the graph — team-level only, never
individual scorecards.

## Built with

TypeScript 7 · [Zero](https://zero.rocicorp.dev) sync engine · Postgres · React 19 + Vite ·
Hono · Kysely. See [TECHSTACK.md](TECHSTACK.md) for the reasoning behind each choice.

## Contributing

Specs and plans live in [`openspec/`](openspec/) — read a change proposal before writing
code for it. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and the DCO sign-off
requirement.

## License

[AGPL-3.0](LICENSE) — and it will stay that way. Contributions are accepted under
[DCO](https://developercertificate.org/) sign-off specifically so that relicensing this
project would require every contributor's consent. That's the point.
