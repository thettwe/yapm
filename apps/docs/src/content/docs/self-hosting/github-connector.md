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

Read-only covers the wedge (PR/CI/deploy state driving the issue's reality track **and**, for teams
that opt in, the issue's status) and guarantees yapm never modifies your GitHub. Only escalate
Issues + Pull requests to **Read & write** if you later want yapm to post back-reference comments on
PRs — that forces installers to re-approve.

### Changed-file metadata (no extra permission)

If you configure the cycle digest's [product-area map](/self-hosting/ai-setup/), yapm additionally
reads **which files** a pull request linked to an issue in the closing cycle touched — whatever
state that pull request is in, merged or not. It reads the filename, the change status, and the
number of changed lines, and converts those paths into product-area labels.

That read is `GET /repos/{owner}/{repo}/pulls/{n}/files`, which GitHub serves under the
**Pull requests: Read-only** permission already in the table above. **No new permission, and no
re-consent from installers.** It is a read; yapm still never modifies your GitHub.

What yapm does with the response is as important as the permission:

- **Diff content is never read.** GitHub returns a `patch` field per file whether or not it is asked
  for, plus `blob_url`, `raw_url` and `contents_url`. yapm drops all four the moment the response
  arrives, before any other part of the system can see them. A test asserts this against a mock that
  *does* return a patch.
- **Nothing is persisted.** No file list, no path, no size, no cache table — the metadata exists in
  memory for the length of one digest run and is discarded.
- **One page per pull request.** yapm reads the first 100 changed files and does not paginate; a
  larger pull request is mapped from that first page and the digest reports its area list as partial.
- **Zero requests until you opt in.** With no area map configured, this read never happens. See
  [the rate budget](/self-hosting/ai-setup/#the-github-rate-budget-this-spends) for the caps that
  bound it when you do.

### Deploy history

The **Deployments: Read-only** permission in the table above now yields deploy *history*, not just
the current deploy per environment — again with **no new permission and no re-consent**. Two fields
yapm was already receiving are now kept:

- **The commit each deployment carried.** It arrives in the same object as the ref and the
  environment; yapm used to drop it. It is what links a merged pull request to the deploy that
  shipped it, and it drives the reality track's
  [deployed signal](/features/delivery-signals/#how-a-change-is-counted-as-deployed).
- **The moment a deployment first succeeded**, stored separately from its state and never rewritten.
  GitHub's `auto_inactive` flips a superseded deployment to `inactive` the moment the next one
  succeeds, so a deployment's state describes the present. Without a separate timestamp, every past
  success was overwritten and "how often do we deploy" counted roughly one row per environment
  forever.

**What this does not do:** it requests nothing new, writes nothing to GitHub, subscribes to no new
event (**Deployment** and **Deployment status** were already in step 4), and adds no container, job
or environment variable.

**Expect a sparse first week.** Deployments ingested before you upgraded have no recorded commit and
no success timestamp, and no migration can invent one — the moment of a past success is exactly what
was being overwritten.

What heals it is the reconcile sweep (`GITHUB_RECONCILE_CRON`, every 15 minutes by default), which
re-lists each mapped repository's 100 most recent deployments. That poll is *conditional*: normally
it re-runs only when the repository's deployment list has changed, so the upgrade drops the stored
deployment-list marker once to force exactly one full re-poll per repository. On that sweep, yapm
backfills the commit for every deployment GitHub still lists, and stamps the success moment for
those whose **newest** status is still `success`.

Two things stay unknown, permanently and by design: a deployment GitHub no longer lists, and one
that succeeded and was already superseded (`inactive`) before the sweep saw it — the sweep can only
read the newest status, and a past success is exactly what `auto_inactive` overwrote. Both read as
not deployed. From the upgrade forward, every new deployment records both facts as it happens, from
the webhook rather than the sweep.

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
lights up that issue's **reality track** — PR state, CI health, whether a deployment carrying the
merge commit succeeded, and review age — on the issue row and detail.

## 10. Optionally, let pull requests drive issue status

By default, linked PR activity only *shows* on the issue — a status that disagrees with git gets a
[divergence break](/features/delivery-signals/#divergence), never a rewrite. The same
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
divergence break, and the branch-name caveat worth knowing before you enable it.
