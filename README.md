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
> a kanban board; time-boxed cycles with automatic rollover; a keyboard-first triage inbox for
> incoming issues; and lightweight projects with a roadmap timeline — all self-hostable in three
> containers; a first-party GitHub connector that ingests PR, CI, and deploy state into the
> work graph so every issue row shows delivery reality; a BYO-key, provider-agnostic AI
> foundation whose first feature is a team-internal, evidence-linked cycle digest; a
> data-seeded retrospective that opens with the cycle's own delivery facts already gathered; a
> per-user notification inbox with optional batched email; and `@`-mentions in descriptions and
> comments that subscribe the person you named to the issue — reversibly.
> Direction is settled in [VISION.md](VISION.md), [TECHSTACK.md](TECHSTACK.md), and
> [ROADMAP.md](ROADMAP.md).

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
- **Fast.** Local-first sync: reads come from memory, not the network. When the connection drops —
  a sleeping laptop, a restarted container — it says so and repairs itself, without a reload.
- **Three containers.** `docker compose up` on a small VPS. Not thirteen.
- **Your data.** One-command export, no lock-in, no phone-home you didn't agree to.

## What works today

Accounts, teams, and roles (admin / member / viewer — viewers free and unlimited) · email,
GitHub, and OIDC sign-in, all free · a keyboard-first issue list with a command palette and
filtering · an issue detail view with rich-text descriptions and comments · a kanban board ·
time-boxed cycles with a progress view and automatic rollover of unfinished work ·
a keyboard-first triage inbox for incoming issues (accept / decline / route, without a seventh status) ·
lightweight, workspace-level projects with computed progress and a keyboard-first roadmap timeline across teams ·
three switchable themes (Warm, Focused, Editorial) with a custom accent color · a first-party
**GitHub connector** (admin-configured) that ingests PR, CI, review, and deploy state into the
work graph, so every issue row's **reality strip** shows live PR state, a CI health dot, and review
age — with a **divergence flag** when a human status disagrees with git · a **BYO-key AI
foundation** (bring your own Anthropic / Gemini / OpenAI key, admin-configured, off until you
enable it) whose first feature is a team-internal, evidence-linked **cycle digest** — pre-computed
at cycle close, team-level and blameless, with a raw linked-evidence fallback when AI is off ·
a **data-seeded retrospective**, opened automatically when a cycle closes, whose gather-data phase
is already filled in from the team's own cycles (and from PR/CI data when a connector is
configured), with **anonymity guaranteed at the storage layer** — the card→author binding lives in
a server-only table the sync schema cannot name — and actions that become real, numbered issues in
the next cycle · a keyboard-first **notification inbox** at `/inbox` with an unread badge, for
assignments (including triage routing) and comments on issues you're involved in — written only on
the server so a rebased optimistic mutation can never duplicate or re-send one, readable **only by
its recipient with no admin bypass**, and optionally emailed as one batched, debounced digest per
person through a provider-neutral mailer (SMTP **or** Resend over HTTPS, for hosts that block
outbound SMTP), cleanly disabled when neither is configured · **`@`-mentions** in descriptions and
comments — a keyboard-first typeahead over rows the client has *already* synced (it opens on the
keystroke, and works offline), stored as an id reference so renames propagate and a crafted label
cannot spoof a colleague, with **eligibility decided server-side** by the same predicate that
decides who may read the issue, so a mention of someone who cannot read it produces nothing and the
list says why instead of going quiet — and being mentioned **subscribes you to the issue**, through
a durable subscription with a sticky, keyboard-operable unfollow on the issue itself and no
follower list or count for anyone, admins included.

## What's next

**Search** — instant over already-synced rows, then complete via Postgres full-text, with no new
container. Then **BYO-key AI agents** that read and act through the same permissions as a human —
the foundation (gateway, agent-as-actor tools, the AI-over-work-graph substrate) is in; a governed
PM-facing digest and an **AI-facilitated** retro — drafting themes and candidate actions on top of
the retrospective that already ships — build on it next. Then DORA and review-health metrics
computed from the graph — team-level only, never individual scorecards. More connectors
(GitLab, …) slot into the same framework with no feature-code change.

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
