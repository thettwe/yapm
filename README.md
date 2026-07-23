<div align="center">

# yapm

**Yet Another Project Management** — because the good ones rent you your own data.

An open-source project management tool where **shipping work and delivery quality live in one place**.
Issues, pull requests, CI runs, deploys, and incidents in a single work graph — so DORA and
code-review health are just views, not a $30/developer/month add-on.

</div>

---

> **Status: pre-alpha, under active construction.**
> The product direction and architecture are settled ([VISION.md](VISION.md), [TECHSTACK.md](TECHSTACK.md), [ROADMAP.md](ROADMAP.md)) and implementation is starting.
> There is nothing to install yet. Watch the repo if you want to know when there is.

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
