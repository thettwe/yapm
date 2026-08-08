---
title: Delivery signals (the reality track)
description: Every issue row shows delivery reality — PR state, CI health, whether the change reached production, review age — derived from linked GitHub activity, with a divergence break when a human status disagrees with git.
---

Every other tracker's issue row shows *intention* — a status a human set. yapm's row also shows
*reality* — state derived from the pull request, CI checks, reviews, and deployments linked to that
issue. That compact slot beside the status, priority, and assignee is the **reality track**, and
where the two disagree the track carries a **`//` break**.

This page is about where those facts come from and what they are safe to conclude. How the track is
*drawn* — the stations, the nodes, the break, and the rest of the vocabulary it shares with every
other surface — is [The reality vocabulary](/features/reality-vocabulary/).

The track is dormant until you connect GitHub. See
[Connect GitHub](/self-hosting/github-connector/) to register the App and map repositories to teams.
Until then — and for any issue with no linked activity — the track draws four empty stations and
nothing changes.

## What the track shows

For an issue linked to a pull request, the track carries four facts, left to right:

- **PR state** — where the pull request is in its lifecycle: draft → open → approved → merged →
  closed. An open PR that has an approving review shows as **approved**. A PR **closed without
  merging** leaves the Change station empty, because nothing landed; the track's accessible label
  still says "PR closed", which is how it differs from an issue that has no pull request at all.
- **CI health** — the linked checks rolled up: reached when everything passes, failing when any
  check fails, in flight while checks are still running.
- **Deployed** — the Live station, reached only once a deployment carrying this change's merge
  commit has succeeded. It is a fact about what happened, not a state: see
  [How a change is counted as deployed](#how-a-change-is-counted-as-deployed).
- **Review age** — how long since the newest review, or, before any review, how long the PR has been
  open. yapm never sees a review being *requested*, so it never phrases this as a reviewer waiting.

The row layout is identical whether or not the signal is present, so populating it never shifts a
row. Every color comes from the theme, so the track is correct in all three presets in both light
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
merge". The moment recorded is the *first* such success — the track shows that it happened, not when.

That fact is recorded once and never rewritten. GitHub marks a deployment `inactive` as soon as the
next one supersedes it, so the deployment's *current state* changes constantly — but the moment it
succeeded is stored separately and is immutable, which is what makes "how often did we ship" a
question the data can answer rather than a count of one row per environment.

Three consequences worth knowing before you rely on it:

- **A batched deploy reports only its tip commit.** If one deploy ships five merges, GitHub reports
  one sha. The other four changes really are in production and yapm shows them as not deployed. The
  error only ever runs in that direction: the track never claims a deployment that did not carry the
  commit. The same applies to a release branch, a squash-and-retag, or any pipeline that deploys a
  tag rather than the merge commit.
- **The environment is not consulted.** yapm has no way to know which of your environment strings
  means production — `production` is a GitHub convention, not a rule — so a successful *staging*
  deploy carrying the merge commit counts. The station's label says "Deployed" and claims no
  environment.
- **History starts when you upgrade.** Deployments ingested before this shipped have no recorded
  commit and no success timestamp, and nothing can invent them. The reconcile sweep fills in what
  GitHub still lists (see [Connect GitHub](/self-hosting/github-connector/#deploy-history)), so a
  sparse first week is expected rather than broken.

## Divergence

Divergence is yapm's most defining mark: the track **breaks**, with a mono `//` at the point where
the human-set status disagrees with git reality, and the sentence naming the disagreement is written
out beside it. It fires when:

- a linked PR is **merged** but the issue is not marked done or canceled,
- an issue is **done** but its CI is failing, or
- an issue is **in review** while its only linked pull request is still a draft.

Which segment breaks says which of the three fired — see
[the `//` break](/features/reality-vocabulary/#the--break). It rides on the same linked data as the
rest of the track, so it appears the moment reality and status drift apart, and clears itself the
moment you reconcile them.

### Flagging versus fixing

The break is what yapm does when it will not correct the status for you, which is the default and
stays the default. A team can opt in to [status automation](/features/auto-status/), and then the
two work as one behaviour with a switch:

- **Automation off** — the default, and every existing team. Divergence behaves exactly as described
  above; nothing is ever overwritten.
- **Automation on and a transition fires** — status and git now agree, so the track stays whole on
  its own. Nothing suppresses the break; the disagreement it reports no longer exists.
- **Automation on but the transition is blocked** — by a guard such as a person having set the
  status after the pull-request event, an untriaged issue, or a canceled one — the track breaks. A
  blocked transition is precisely the case where yapm is not confident enough to act but *is*
  confident the two disagree.

Automation corrects only what it is sure about and hands everything else back to the break. Enabling
it adds no new kind of divergence and changes nothing about how divergence is computed.

## Filtering by delivery reality

Because the signal is real, the issue list's **Delivery** filter narrows to issues by their
delivery state. All three predicates — **Blocked on review**, **Failing CI**, and **Merged, not
deployed** — are evaluated the same way the track is computed.

**Merged, not deployed** matches an issue whose linked pull request is merged and whose merge commit
no successful deployment carried. It inherits the batched-deploy caveat above, so it **over-reports**:
it can list a change that did ship as part of somebody else's deploy, and it will never hide one
that has not shipped. For a filter answering "what have we merged and not yet got out", a false
positive costs a glance and a false negative costs a missed release.

Where an issue has no linked data, a delivery filter simply matches nothing rather than hiding the
issue.

## Where each signal is said in words

Every signal on this page is also **stated**, not only drawn. The words come from one shared
dictionary — see [phrases at rest](/features/reality-vocabulary/#phrases-at-rest) for the
vocabulary and [the issue list](/features/issue-list/) for where each phrase lands on a row.

| Signal | The row says |
| --- | --- |
| Merged PR under an unfinished issue | Done in git, not on the board |
| CI failing | Checks failing |
| Merged, no deployment carried the commit | Built — not live yet |
| Open PR, nobody has reviewed | In review — waiting *N* |
| Open PR, a review came back without approving | In review — reviewed *N* ago |
| Deployed | *(nothing — the track's Live station already says it)* |

The check and deploy phrases carry GitHub's mark, because those facts came from GitHub. The
divergence and review-age phrases carry none: yapm derived them.

## Issue detail

Opening an issue draws these same facts at full measure, on
[the issue detail's delivery rail](/features/issue-detail/): a station per moment, each with the
evidence under it, and — where the board and git disagree — the `//` break plus a callout offering
the one repair the board can honestly make.

The **deploy join** is stated on the rail's last station, and it is the join described above and no
other: same repository, a merged pull request's merge commit against a deployment's commit, earliest
success. A change whose merge commit nothing carried draws **Not live yet** rather than an empty
station, and the mono subline says the same thing in the engineer's register. There is no head-commit
fallback anywhere: a deployment carrying the branch's head shipped the branch, not the merge.

## Permissions

The track renders only over issues you can already see: it reads the same team-scoped synced data as
the rest of the app, so it never reveals a pull request, check, or review from a team you do not
belong to. Configuring the connector and mapping repositories to teams is admin-only.
