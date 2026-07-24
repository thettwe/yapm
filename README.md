<div align="center">

# yapm

**Yet Another Project Management** — because the good ones rent you your own data.

An open-source project management tool where **shipping work and delivery quality live in one place**.
Issues, pull requests, CI runs, deploys, and incidents in a single work graph — so DORA and
code-review health are just views, not a $30/developer/month add-on.

</div>

---

> **Status: pre-alpha, building in the open.** The tracker is real: accounts, teams, and roles;
> a three-preset theme system; a keyboard-first issue list, command palette, and issue detail; and
> a kanban board — all self-hostable in three containers. Still landing: cycles, triage, projects &
> roadmap, the GitHub connector (which lights up the delivery signals), and BYO-key AI. Direction is
> settled in [VISION.md](VISION.md), [TECHSTACK.md](TECHSTACK.md), and [ROADMAP.md](ROADMAP.md).

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

- **Free means free.** No seat caps. No SSO tax. No features behind a license key. No upgrade
  nags in the UI you self-host. 100% AGPL — there is no `ee/` directory.
- **Free viewer seats, forever.** Stakeholders should never be a line item.
- **Fast.** Local-first sync: reads come from memory, not the network.
- **Three containers.** `docker compose up` on a small VPS. Not thirteen.
- **Your data.** One-command export, no lock-in, no phone-home you didn't agree to.

## What works today

Accounts, teams, and roles (admin / member / viewer — viewers free and unlimited) · email,
GitHub, and OIDC sign-in, all free · a keyboard-first issue list with a command palette and
filtering · an issue detail view with rich-text descriptions and comments · a kanban board ·
three switchable themes (Warm, Focused, Editorial) with a custom accent color. Every issue row
already reserves a **delivery-signal** slot — it fills in once the GitHub connector lands.

## What's next

Cycles with rollover · triage inbox · projects & roadmap · a first-party **connector framework**
(GitHub first — PR/CI/deploy state into the work graph) · **BYO-key AI agents** that read and act
through the same permissions as a human. Then DORA and review-health metrics computed from the
graph — team-level only, never individual scorecards.

## Quickstart

You need **Docker** and **Node 24** with Corepack enabled. Nothing else — no accounts, no
tokens, no cloud services.

```bash
git clone https://github.com/thettwe/yapm.git && cd yapm

# Run it (self-host): the whole production deployment is three containers
docker compose -f docker/docker-compose.yml up -d --build --wait

# Or hack on it: Postgres + zero-cache in Docker, server + Vite on the host, one command
pnpm install && pnpm dev
```

The production stack is **exactly three containers** — the app (API + Zero endpoints + static SPA
in one process), `zero-cache`, and Postgres. No Redis, no reverse proxy, no object store. On an
Apple-Silicon test box it idles at ~0.85 GiB RAM total. Full self-hosting docs live in
[`apps/docs`](apps/docs).

## Built with

TypeScript 7 · [Zero](https://zero.rocicorp.dev) sync engine · Postgres · Kysely · React 19 + Vite ·
Hono. See [TECHSTACK.md](TECHSTACK.md) for the reasoning behind each choice, and
[PROCESS.md](PROCESS.md) for how every change is built (spec-driven, docs-as-done, reviewed PRs).

## Contributing

Specs and plans live in [`openspec/`](openspec/) — read a change proposal before writing code for
it. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and the DCO sign-off requirement.

## License

[AGPL-3.0](LICENSE) — and it will stay that way. Contributions are accepted under
[DCO](https://developercertificate.org/) sign-off specifically so that relicensing this project
would require every contributor's consent. That's the point.
