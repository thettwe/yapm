---
title: Connect GitHub (create a GitHub App)
description: Register a GitHub App so yapm can read PR, CI, and deploy state into your work graph.
---

yapm connects to GitHub with a **GitHub App** (not an OAuth App): it acts on its own, ships with
built-in webhooks, uses fine-grained permissions, and gets its own 5,000 req/hr budget per
installation. You create it once; its settings stay editable.

:::note
The GitHub connector ships with the `connectors` change. You can create the App ahead of time — its
permissions and the values to capture are stable — but you only need it once yapm is deployed and
you want to link GitHub activity into your work graph.
:::

## Before you start

GitHub needs somewhere to send webhooks:

- **yapm is deployed** at a public URL → use `https://<your-yapm-domain>`.
- **Testing locally** → create a channel at [smee.io](https://smee.io) and use that URL for now.

## 1. Open the creation form

**GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
(`https://github.com/settings/apps/new`, or `https://github.com/organizations/<ORG>/settings/apps/new`
to own it under an organization).

## 2. Basic details

- **GitHub App name:** `yapm` (or `yapm-<yourorg>` if taken).
- **Homepage URL:** your yapm URL.
- **Webhook → Active:** checked.
- **Webhook URL:** `https://<your-yapm-domain>/api/github/webhooks` (or your smee.io URL).
  yapm's *Settings → Connectors* screen shows the exact URL to paste.
- **Webhook secret:** generate one (`openssl rand -hex 32`) and paste it. **Save it** — yapm
  requires it to verify webhooks (HMAC-SHA256).
- **Callback URL:** leave blank (only for user-login flows, which are not used yet).

## 3. Permissions (all Read-only)

| Permission | Access | Why |
|---|---|---|
| Metadata | Read-only | Mandatory baseline |
| Contents | Read-only | Branch/commit data for branch↔issue linking |
| Issues | Read-only | Issue state |
| Pull requests | Read-only | PR state (draft → open → approved → merged) |
| Checks | Read-only | CI health |
| Deployments | Read-only | Deploy state |

Read-only covers the wedge (PR/CI/deploy state driving the issue's reality strip **and**, for teams
that opt in, the issue's status) and guarantees yapm never modifies your GitHub. Only escalate
Issues + Pull requests to **Read & write** if you later want yapm to post back-reference comments on
PRs — that forces installers to re-approve.

## 4. Subscribe to events

Check exactly: **Pull request**, **Push**, **Check run**, **Check suite**, **Status**,
**Deployment**, **Deployment status**, **Issues**. Nothing more.

## 5. Where can it be installed

**Only on this account** (simplest for self-hosting).

## 6. Create, then generate the private key

Click **Create GitHub App**. On the App's page: **Private keys → Generate a private key** →
a `.pem` file downloads. Keep it safe — GitHub stores only the public half, and anyone with this
key can authenticate as your App.

## 7. Set the environment variables

The three App values plus an encryption key become environment variables on your instance
(Zod-validated at boot); they never touch the codebase. Never paste a private key into a chat or
issue.

| Variable | From | Notes |
|---|---|---|
| `GITHUB_APP_ID` | App ID | numeric |
| `GITHUB_APP_PRIVATE_KEY` | the `.pem` | PKCS#1 PEM; `\n`-escape or base64 the multiline value |
| `GITHUB_APP_WEBHOOK_SECRET` | webhook secret (step 2) | verifies webhook HMAC |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` | base64 32 bytes; encrypts any UI-entered secrets at rest — **back this up**, losing it makes stored secrets unrecoverable |
| `GITHUB_RECONCILE_CRON` | *(optional)* | how often the ETag reconcile sweep runs; default `*/15 * * * *` |

**All optional.** With the three `GITHUB_APP_*` values **absent**, the connector is cleanly
**disabled**: the webhook endpoint returns `404`, no ingestion queue or reconcile cron is created,
boot is unaffected, and *Settings → Connectors* shows a "not configured" state naming the variables
to set. A **partial** triplet (some but not all three) fails fast at boot naming the missing
variable, so the connector never silently half-runs.

## 8. Install it

On the App page → **Install App** → choose your account/org → **All repositories** or a selection.
yapm receives an `installation` webhook with the installation ID and stores it per workspace to know
which repos it can see.

## 9. Map repositories to teams

Open *Settings → Connectors* in yapm (workspace admins only), **Enable** the GitHub connector, and
map each repository (`owner/repo`) to the team that should own its pull requests, checks, and
deployments. Ingested work-graph rows land inside that team's boundary; a webhook for an unmapped
repo is dropped. Once mapped, a PR whose branch name or body mentions an issue key (e.g. `ENG-142`)
lights up that issue's **reality strip** — PR state, CI health, and review age — on the issue row
and detail.

## 10. Optionally, let pull requests drive issue status

By default, linked PR activity only *shows* on the issue — a status that disagrees with git gets a
[divergence flag](/features/delivery-signals/#the-divergence-flag), never a rewrite. The same
*Settings → Connectors* page has a **Status automation** section where an admin can turn that into a
transition, **per team**:

- **Off by default**, and off for every team after an upgrade. An instance that adopts nothing
  behaves exactly as before.
- **Two transitions only** — a linked PR opening moves the issue to In Review, merging it moves the
  issue to Done. Never backward, never onto a canceled or untriaged issue.
- **Enabling changes no existing issue.** yapm records the instant you enabled it and ignores every
  PR event older than that, so first-install backfill and the reconcile sweep cannot retroactively
  rewrite a board.
- **No new App permission and no write to GitHub.** The transition is a write to yapm's own
  database; nothing is posted back to the provider, so nobody has to re-approve the installation.
- **No new environment variable, container, or job.** The whole setting is one column per team.

See [Status automation](/features/auto-status/) for the full guard ladder, how it interacts with the
divergence flag, and the branch-name caveat worth knowing before you enable it.
