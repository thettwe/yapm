---
title: Delivery signals (the reality strip)
description: Every issue row shows delivery reality — PR state, CI health, review age — derived from linked GitHub activity, with a divergence flag when a human status disagrees with git.
---

Every other tracker's issue row shows *intention* — a status a human set. yapm's row also shows
*reality* — state derived from the pull request, CI checks, and reviews linked to that issue. That
compact slot beside the status, priority, and assignee is the **reality strip**, and the quiet
warning glyph that appears when the two disagree is the **divergence flag**.

The strip is dormant until you connect GitHub. See
[Connect GitHub](/self-hosting/github-connector/) to register the App and map repositories to teams.
Until then — and for any issue with no linked activity — the strip shows a quiet "not linked" state
and nothing changes.

## What the strip shows

For an issue linked to a pull request, the strip renders three signals, left to right:

- **PR state** — a glyph for the pull request's lifecycle: draft → open → approved → merged →
  closed. An open PR that has an approving review shows as **approved**.
- **CI health** — a single dot rolling up the linked checks: green when everything passes, red when
  any check fails, amber while checks are still running.
- **Review age** — how long since the newest review, or, before any review, how long the PR has been
  waiting for one.

The row layout is identical whether or not the signal is present, so populating it never shifts a
row. Every color comes from the theme, so the strip is correct in all three presets in both light
and dark.

## How an issue links to a pull request

A pull request links to an issue when its **branch name** or its **PR body** contains the issue's
key, like `ENG-142` — case-insensitive, matched on a word boundary. So a branch named
`ada/ENG-142-fix-sync` or a PR body that says `Closes ENG-142` both link that PR to `ENG-142`. One
PR can link several issues, and a reference that resolves to no issue in the repo's mapped team is
ignored.

## The divergence flag

The divergence flag is yapm's most defining glyph: a quiet marker that fires when the human-set
status disagrees with git reality. It appears when:

- a linked PR is **merged** but the issue is not marked done or canceled,
- an issue is **done** but its CI is failing, or
- an issue is **in review** with no open PR behind it.

It rides on the same linked data as the strip, so it lights up the moment reality and status drift
apart — and clears itself the moment you reconcile them.

## Filtering by delivery reality

Because the signal is real, the issue list's **Delivery** filter narrows to issues by their
delivery state. **Blocked on review** and **Failing CI** are evaluated the same way the strip is
computed. **Merged, not deployed** is reserved: the issue→deployment edge is not yet modeled, so it
currently matches nothing pending deployment-edge support. Where an issue has no linked data, a
delivery filter simply matches nothing rather than hiding the issue.

## Issue detail

Opening an issue shows the same strip plus the full linked context: each linked pull request with
its state and a link out to GitHub, its CI health, its latest review, and any deployment recorded
for that repository — and the divergence flag with the specific reason it fired.

## Permissions

The strip renders only over issues you can already see: it reads the same team-scoped synced data as
the rest of the app, so it never reveals a pull request, check, or review from a team you do not
belong to. Configuring the connector and mapping repositories to teams is admin-only.
