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
- **Webhook URL:** `https://<your-yapm-domain>/api/connectors/github/webhooks` (or your smee.io URL).
  yapm's *Settings → Connectors → GitHub* screen shows the exact URL to paste.
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

Read-only covers the wedge (PR/CI/deploy state driving the issue's reality strip) and guarantees
yapm never modifies your GitHub. Only escalate Issues + Pull requests to **Read & write** if you
later want yapm to post back-reference comments on PRs — that forces installers to re-approve.

## 4. Subscribe to events

Check exactly: **Pull request**, **Push**, **Check run**, **Check suite**, **Status**,
**Deployment**, **Deployment status**, **Issues**. Nothing more.

## 5. Where can it be installed

**Only on this account** (simplest for self-hosting).

## 6. Create, then generate the private key

Click **Create GitHub App**. On the App's page: **Private keys → Generate a private key** →
a `.pem` file downloads. Keep it safe — GitHub stores only the public half, and anyone with this
key can authenticate as your App.

## 7. Capture these for yapm

1. **App ID**
2. **Private key** (the `.pem`)
3. **Webhook secret** (from step 2)
4. *(optional, later)* Client ID / secret — only if user-login is added

These become environment variables on your instance (Zod-validated at boot); they never touch the
codebase. Never paste a private key into a chat or issue.

## 8. Install it

On the App page → **Install App** → choose your account/org → **All repositories** or a selection.
yapm receives an `installation` webhook with the installation ID and stores it per workspace to know
which repos it can see.
