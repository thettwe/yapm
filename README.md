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
GitHub, and **OIDC/SSO** sign-in, all free and unlimited — SSO registered by a workspace admin in
*Settings → Single sign-on* against an email domain you prove you own by DNS, and offered on the
login form only once it can actually complete ·
a keyboard-first issue list with a command palette and
filtering · an issue detail view with rich-text descriptions and comments · a kanban board ·
time-boxed cycles with a progress view and automatic rollover of unfinished work ·
a keyboard-first triage inbox for incoming issues (accept / decline / route, without a seventh status) ·
lightweight, workspace-level projects with computed progress and a keyboard-first roadmap timeline across teams ·
three switchable themes (Warm, Focused, Editorial) with a custom accent color · a first-party
**GitHub connector** (admin-configured) that ingests PR, CI, review, and deploy state into the
work graph, so every issue row's **reality strip** shows live PR state, a CI health dot, whether a
deployment carrying the merge commit actually succeeded, and review
age — with a **divergence flag** when a human status disagrees with git, and **opt-in status
automation** that closes the loop the flag opens: turn it on for a team and a linked pull request
opening moves its issue to In Review, merging moves it to Done — forward only, never over a canceled
or untriaged issue, off by default, and enabling it changes no existing issue · a **BYO-key AI
foundation** (bring your own Anthropic / Gemini / OpenAI key, admin-configured, off until you
enable it) whose first feature is a team-internal, evidence-linked **cycle digest** — pre-computed
at cycle close, team-level and blameless, with a raw linked-evidence fallback when AI is off, and
told in terms of **your product areas**: map path prefixes to area labels once and the digest groups
the cycle by area, bands each change by size, flags the sensitive areas it touched, and collapses
tooling churn into one "N internal improvements" line, because yapm converts paths into labels
*before* the model runs and **never reads a diff** — the file list is fetched under the GitHub
permission you already granted, used, and thrown away · an off-by-default **product digest** — the
one thing in yapm whose output crosses a permission boundary, and so the most refusing feature in it:
four independent switches (an env toggle, a workspace switch, a per-team switch, and an explicit
reader list) all have to agree, there is **no new role** — being named on a team's reader list *is*
the entitlement, and it grants that team's product digest and nothing else — the producing team reads
the exact text and releases it themselves before anybody outside can, evidence is baked as plain-text
labels rather than links (a reader outside the team can open none of the targets, and only the work
the summary cites gets a label at all), and the surface is cleanly *absent* rather than empty for
anyone who has not been sent something — named or not. Retraction stops further reads; it does not
un-read, and the product says so in those words ·
a **data-seeded retrospective**, opened automatically when a cycle closes, whose gather-data phase
is already filled in from the team's own cycles (and from PR/CI data when a connector is
configured), with **anonymity guaranteed at the storage layer** — the card→author binding lives in
a server-only table the sync schema cannot name — and actions that become real, numbered issues in
the next cycle, plus an opt-in, per-team **AI draft** in that retro: at the moment the facilitator
reveals the board (never before it, so there is nothing to anchor on while people are still writing
their own cards), the model drafts at most three wins, three losses and three improvements, each one
*citing* a work-graph entity or one of yapm's own computed metrics — it points at a number, it never
types one — reading no cards, no comments and nobody's name, and labelled "AI-drafted, not agreed"
until **the team ratifies it**: each member privately agrees or disagrees (synced to nobody else, not
even a workspace admin, exactly like their dots), one verdict per proposal is computed once when the
retro leaves voting, **a single disagreement makes a proposal contested** rather than agreed and sorts
it to the top of the discussion, and an agreed improvement is one keystroke from a real numbered issue
— **never with an owner filled in**, because the model has no identity data to invent one from — and
once a team has run two retros the draft *can* close the loop: a fourth group reporting on up to three
of the improvements agreed in the team's **most recent previous retro** — with yapm naming which cycle
they came from — each reported as **shipped, canceled, still open or never tracked**, computed by yapm
from the live status of the issue it became and stripped of the assignee on both the action and that
issue ·
a keyboard-first **notification inbox** at
`/inbox` with an unread badge, for
assignments (including triage routing), comments on issues you're involved in, and product digests
shared with you (that one naming no actor and carrying no content) — written only on
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
follower list or count for anyone, admins included · **instant-then-complete search** — `⌘K` or a
full `/search?q=` route, answered in the same frame from rows the browser already holds (no network,
works offline) and then *extended* by Postgres full-text over comment bodies and every other team
you can read, shown as two labelled groups that never reorder under the keyboard cursor, adding **no
container and no `CREATE EXTENSION`**, with the index maintained by a background job so an issue-title
edit costs exactly what it did before — and **no query is ever recorded**: no search log, no
analytics, no "popular searches", nothing aggregatable into a per-person record ·
**attachment storage** — a provider-neutral byte store behind `/api/v1/files` with thumbnails and a
nightly sweep of abandoned uploads, defaulting to a directory on disk (complete, no fourth container)
and switchable to any S3-compatible bucket, where **there are no signed or shareable links and no
setting that turns them on**: an image in a synced document would put a bearer token on every
teammate's device, so the document stores an opaque id and the app proxies every byte, which is also
what makes the permission check identical for both providers ·
**markdown as the interchange format** — type markdown to format, paste markdown in, and copy
markdown *out* that actually reads correctly in a terminal or a Slack message (no `&lt;` entities,
and a paragraph that starts with `#` comes back a paragraph), while rich text stays the storage
format and an in-app copy/paste stays lossless ·
**images, tables and syntax-highlighted code** in descriptions and comments, reached with a `/`
insert menu that is fully keyboard-operable (as are table navigation and selecting or removing an
image), with syntax colours drawn from your theme's tokens rather than a highlighter's stylesheet —
plus a **Files** section on every issue listing everything attached to it, and a refusal that matters:
a browser tab left open across an upgrade is shown its issue **read-only** with a "reload to edit"
notice instead of silently saving back a description with the images and tables it could not
understand quietly deleted.

## What's next

**BYO-key AI agents** that read and act through the same permissions as a human —
the foundation (gateway, agent-as-actor tools, the AI-over-work-graph substrate) is in, and the
AI-facilitated retro is complete end to end and compounding: the model drafts, the team disposes, an
agreed improvement lands as a tracked issue, and the next retro reports whether it shipped. The
governed PM-facing digest — the first AI output in yapm to cross a permission boundary — is now in
too — and it is now **governed** rather than merely claimed to be: every policy change, generation,
release and retraction is recorded in a server-only table no client can name, a workspace admin can
read that record in an admin-only view that reports what was disclosed and *to how many readers* and
has no shape in which a read could appear, and those records are **retention-bounded** by a nightly
sweep on the job runner yapm already has — one year by default, configurable, and running whether or
not AI is enabled. A named reader can optionally be emailed when a digest is released, and that
message carries **a link and nothing else**: a mailed artifact sits outside the kill switch, outside
retention and outside the audit log at the same time, so the one path that leaves the governed
surface carries nothing that could survive them. Retraction still stops further reads without
un-reading, and the product still says so in those words. Next: DORA and review-health metrics
computed from the graph — team-level only, never individual scorecards. More connectors
(GitLab, …) slot into the same framework with no feature-code change — inheriting the reality strip
and the status automation above for free.

## Quickstart

You need **Docker** and **Node 24** with Corepack enabled. Nothing else — no accounts, no
tokens, no cloud services.

```bash
git clone https://github.com/thettwe/yapm.git && cd yapm

# Run it (self-host): the whole production deployment is three containers
node scripts/init-env.mjs
docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait

# Or hack on it: Postgres + zero-cache in Docker, server + Vite on the host, one command
pnpm install && pnpm dev
```

`init-env.mjs` writes a repo-root `.env` with a generated value for every secret this repository
publishes; `--env-file .env` is **not optional**, because `-f docker/…` makes `docker/` Compose's
project directory, so without it Compose finds no env file at all and silently applies every
published default. In production the app refuses to boot on those defaults, naming each one.

The production stack is **exactly three containers** — the app (API + Zero endpoints + static SPA
in one process), `zero-cache`, and Postgres. No Redis, no reverse proxy, no object store. On an
Apple-Silicon test box it idles at ~0.85 GiB RAM total.

Before you put a domain in front of it, read
[**Deploy and harden**](apps/docs/src/content/docs/self-hosting/deploy.md) — the secrets to change and
what each protects, TLS in front of *both* published ports (3000 and 4848), sizing, and a first-run
checklist. Then [**Upgrade and rollback**](apps/docs/src/content/docs/self-hosting/upgrade.md), which
says plainly that migrations are forward-only and a rollback is a database restore, and the
[**configuration reference**](apps/docs/src/content/docs/self-hosting/configuration.md), which lists
every variable and is checked against the schema in CI. Full self-hosting docs live in
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
