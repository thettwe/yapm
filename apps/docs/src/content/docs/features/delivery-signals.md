---
title: Delivery signals (the reality strip)
description: Every issue row shows delivery reality — PR state, CI health, whether the change reached production, review age — derived from linked GitHub activity, with a divergence flag when a human status disagrees with git.
---

Every other tracker's issue row shows *intention* — a status a human set. yapm's row also shows
*reality* — state derived from the pull request, CI checks, reviews, and deployments linked to that
issue. That
compact slot beside the status, priority, and assignee is the **reality strip**, and the quiet
warning glyph that appears when the two disagree is the **divergence flag**.

The strip is dormant until you connect GitHub. See
[Connect GitHub](/self-hosting/github-connector/) to register the App and map repositories to teams.
Until then — and for any issue with no linked activity — the strip shows a quiet "not linked" state
and nothing changes.

## What the strip shows

For an issue linked to a pull request, the strip renders four signals, left to right:

- **PR state** — a glyph for the pull request's lifecycle: draft → open → approved → merged →
  closed. An open PR that has an approving review shows as **approved**.
- **CI health** — a single dot rolling up the linked checks: green when everything passes, red when
  any check fails, amber while checks are still running.
- **Deployed** — a rocket glyph, present only once a deployment carrying this change's merge commit
  has succeeded. It is a fact about what happened, not a state: see
  [How a change is counted as deployed](#how-a-change-is-counted-as-deployed).
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

## How a change is counted as deployed

A merged pull request counts as deployed when **a deployment in the same repository carried its merge
commit and succeeded**. Nothing looser: it is an exact commit match, not "a deploy happened after the
merge". The moment recorded is the *first* such success — the strip shows that it happened, not when.

That fact is recorded once and never rewritten. GitHub marks a deployment `inactive` as soon as the
next one supersedes it, so the deployment's *current state* changes constantly — but the moment it
succeeded is stored separately and is immutable, which is what makes "how often did we ship" a
question the data can answer rather than a count of one row per environment.

Three consequences worth knowing before you rely on it:

- **A batched deploy reports only its tip commit.** If one deploy ships five merges, GitHub reports
  one sha. The other four changes really are in production and yapm shows them as not deployed. The
  error only ever runs in that direction: the strip never claims a deployment that did not carry the
  commit. The same applies to a release branch, a squash-and-retag, or any pipeline that deploys a
  tag rather than the merge commit.
- **The environment is not consulted.** yapm has no way to know which of your environment strings
  means production — `production` is a GitHub convention, not a rule — so a successful *staging*
  deploy carrying the merge commit counts. The glyph's label says "Deployed" and claims no
  environment.
- **History starts when you upgrade.** Deployments ingested before this shipped have no recorded
  commit and no success timestamp, and nothing can invent them. The reconcile sweep fills in what
  GitHub still lists (see [Connect GitHub](/self-hosting/github-connector/#deploy-history)), so a
  sparse first week is expected rather than broken.

## The divergence flag

The divergence flag is yapm's most defining glyph: a quiet marker that fires when the human-set
status disagrees with git reality. It appears when:

- a linked PR is **merged** but the issue is not marked done or canceled,
- an issue is **done** but its CI is failing, or
- an issue is **in review** with no linked pull request at all, or only a draft one.

It rides on the same linked data as the strip, so it lights up the moment reality and status drift
apart — and clears itself the moment you reconcile them.

### Flagging versus fixing

The flag is what yapm does when it will not correct the status for you, which is the default and
stays the default. A team can opt in to [status automation](/features/auto-status/), and then the
two work as one behaviour with a switch:

- **Automation off** — the default, and every existing team. The flag behaves exactly as described
  above; nothing is ever overwritten.
- **Automation on and a transition fires** — status and git now agree, so the flag stays quiet on
  its own. Nothing suppresses it; the disagreement it reports no longer exists.
- **Automation on but the transition is blocked** — by a guard such as a person having set the
  status after the pull-request event, an untriaged issue, or a canceled one — the flag fires. A
  blocked transition is precisely the case where yapm is not confident enough to act but *is*
  confident the two disagree.

Automation corrects only what it is sure about and hands everything else back to the flag. Enabling
it adds no new kind of divergence and changes nothing about how divergence is computed.

## Filtering by delivery reality

Because the signal is real, the issue list's **Delivery** filter narrows to issues by their
delivery state. All three predicates — **Blocked on review**, **Failing CI**, and **Merged, not
deployed** — are evaluated the same way the strip is computed.

**Merged, not deployed** matches an issue whose linked pull request is merged and whose merge commit
no successful deployment carried. It inherits the batched-deploy caveat above, so it **over-reports**:
it can list a change that did ship as part of somebody else's deploy, and it will never hide one
that has not shipped. For a filter answering "what have we merged and not yet got out", a false
positive costs a glance and a false negative costs a missed release.

Where an issue has no linked data, a delivery filter simply matches nothing rather than hiding the
issue.

## Issue detail

Opening an issue shows the same strip plus the full linked context: each linked pull request with
its state and a link out to GitHub, its CI health, its latest review, and any deployment recorded
for that repository — and the divergence flag with the specific reason it fired.

## Permissions

The strip renders only over issues you can already see: it reads the same team-scoped synced data as
the rest of the app, so it never reveals a pull request, check, or review from a team you do not
belong to. Configuring the connector and mapping repositories to teams is admin-only.
