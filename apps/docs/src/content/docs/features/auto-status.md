---
title: Status automation
description: Opt in, per team, to have a linked pull request drive an issue's status — opened moves it to In Review, merged moves it to Done, and nothing else ever fires.
---

A pull request already knows things your board has to be told twice. It opened; someone has to
remember to drag the issue to In Review. It merged; someone has to remember to close the issue.
**Status automation** lets a team stop re-typing what git already said.

It is **off by default, and you turn it on per team.** A team that leaves it off behaves exactly as
it did before this feature existed — including its
[divergence breaks](/features/delivery-signals/#divergence), which are what yapm does when
it is *not* allowed to correct a status.

Automation depends on a connector, so it does nothing until you
[connect GitHub](/self-hosting/github-connector/) and map the repository to a team.

## What fires

Exactly two transitions, and they are not configurable:

| The linked pull request… | The issue moves to |
|---|---|
| **opens** (including a draft marked ready for review) | **In Review** |
| **merges** | **Done** |

That is the whole list. Each one is the status category whose *definition* the git fact restates:
a change awaiting review **is** In Review, and a change in the trunk **is** done. Anything vaguer
than that is left to you.

## What never fires

- **A draft pull request drives nothing.** The reality track on the issue row already shows the
  draft PR the moment it exists; writing In Progress on top would state the same fact twice, and in
  a team that opens drafts at branch creation it would fire on nearly every issue.
- **A pull request closed without merging drives nothing.** "Closed" can mean superseded by a better
  branch, abandoned, or opened against the wrong base — there is no target that is right more often
  than it is wrong. The issue keeps the status it had, and its reality track leaves the Change
  station empty and states "PR closed" in the label it announces.
- **Automation never moves an issue backward.** Backlog → Todo → In Progress → In Review → Done is a
  one-way ladder. A target at or below where the issue already sits is a no-op, so a Done issue that
  acquires a new pull request — a follow-up, a revert, a docs pass — stays Done.
- **Canceled is never written, and never written over.** No git fact means "we decided not to do
  this", and an issue someone deliberately canceled is a human dead end.
- **An issue still in the [triage inbox](/features/triage/) is never advanced.** Accepting incoming
  work is the human act triage exists for; advancing it would empty someone's inbox behind their
  back.
- **Nothing is ever written back to GitHub** — no comment, no label, no check, no status. The
  connector stays read-only and its App permissions do not change.
- **Nothing else on the issue is touched.** Not the assignee, priority, cycle, project, labels, or
  triage flag. Only the status.

## The guard ladder

Before any transition, yapm asks these questions in order. The first "yes" stops it, and nothing is
written:

1. **Is automation off for this team?** Off is the default.
2. **Is the pull-request event older than the moment you turned automation on?** See
   [the since guarantee](#the-since-guarantee) below.
3. **Did the pull request's state not actually change?** A comment or a label bumps a PR's
   modification time without changing its state. Automation fires on the *change* — the moment a PR
   opens, the moment it merges — never on the state it is sitting in. So a redelivered webhook, a
   background reconciliation of an unchanged PR, and a retried job all do nothing.
4. **Is the issue awaiting triage?**
5. **Is the issue canceled?**
6. **Did a person set this issue's status *after* the pull-request event happened?** Then the person
   wins. See [when a person and a pull request disagree](#when-a-person-and-a-pull-request-disagree).
7. **Is the pull request in a state that maps to nothing** (draft, closed-unmerged)?
8. **Is the target at or below where the issue already is?** Never backward, never sideways.

Otherwise, and only otherwise, the issue moves.

## The since guarantee

Turning automation on records **the instant you turned it on**, and no pull-request event older than
that instant may ever drive a status.

This is what makes the switch safe to flip on an instance that has been running for a year. When you
first install the GitHub App, yapm sweeps your existing pull requests, and the background
reconciliation re-reads historical ones — so without this rule an admin could enable automation,
install the App, and watch two hundred issues flip to Done in a single queue drain with no undo.

Concretely: **enabling automation changes no existing issue.** It applies to pull-request activity
from that moment onward. There is deliberately no "catch my board up" action.

Turning automation off clears the instant. Turning it back on records a fresh one, so the window
while it was off is never replayed later.

## When a person and a pull request disagree

A person's status write wins whenever it is **newer than the pull-request event itself** — not newer
than the moment yapm happened to process it.

That distinction is the whole rule, and it cuts both ways on purpose:

- You set an issue to In Progress and open the pull request two minutes later. The transition to
  In Review **fires**, because the PR event is newer than your write. (A fixed "don't touch it for
  ten minutes" grace period would silently swallow this — the most common workflow there is — and
  the PR-opened moment never comes back.)
- A webhook is dropped and reconciliation heals it two days late, for a PR that merged before you
  set that issue's status yesterday. The transition is **blocked**, because your write is newer than
  the event. The divergence break reports the disagreement instead, and you decide.

yapm records only the *timestamp* of the last human status write on an issue — never who made it.
There is no per-person automation record anywhere in the product.

## How it relates to divergence

They are one behaviour with a switch, not two features competing for the same job.

| | What happens |
|---|---|
| **Automation off** | Nothing changes. The [divergence break](/features/delivery-signals/#divergence) fires exactly as it always has. |
| **Automation on, transition fires** | Status and git now agree, so there is nothing left to diverge about and the flag stays quiet on its own. Nothing suppresses it — the disagreement it reports no longer exists. |
| **Automation on, transition blocked** | The flag fires. A blocked transition is precisely the case where yapm is not confident enough to act but *is* confident the two disagree. |

Automation corrects what it is sure about and hands everything else to the flag. The divergence
computation is unchanged by this feature, and no new kind of divergence was added.

One honest wrinkle: if automation sets In Review when a PR opens and that PR is later converted back
to a draft, the divergence break will fire on a status automation itself wrote. That is correct — the
disagreement is real — and it resolves the moment the PR is marked ready again.

## The caveat worth knowing

An issue links to a pull request when the PR's **branch name** or **body** mentions the issue key —
`ENG-142`. That matching is textual, and automation raises the stakes on it: a stale `ENG-142` left
in a branch name used to merely decorate ENG-142's row, and now it can move ENG-142 to Done.

What limits the damage:

- a key only ever resolves inside the team the repository is mapped to, never across a team
  boundary;
- automation only moves work **forward**, so the worst case is an issue advanced too early — never
  work reverted, canceled, or deleted;
- it is off unless you turned it on;
- and the divergence break now points *at* the mismatch rather than away from it.

It is not eliminated. If your team recycles branch names, that is the thing to know before you
enable this.

## Turning it on

Automation is configured by a **workspace admin**, per team, at *Settings → Connectors* — the same
page where repositories are mapped to teams, because automation is meaningless without a connector.

The **Status automation** section lists every team with its current state and one Enable/Disable
control each. The control is reachable with Tab alone and activates with Enter or Space; the change
is announced, applies immediately with no round trip, and persists through sync.

Members and viewers do not see the section and cannot write the setting; there is no member-visible
indicator of whether automation is on, so ask a workspace admin if you need to know. What everyone
does see is the result: the statuses themselves, and the divergence break wherever status and git
still disagree.

## Who performs the transition

The write is made by yapm itself, under a **system principal** — never attributed to whoever opened
the pull request, whose GitHub login may map to no yapm account at all. It goes through the same
status mutator the keyboard shortcut, the board drag, and the AI agent use, so it passes the same
permission checks; there is no second, privileged path into an issue's status.

Because the system principal does not stamp the "a human set this" timestamp, an automated status
change is distinguishable from a human one by construction — which is exactly what makes rule 6
above work.

## Other connectors

The decision lives behind yapm's provider-neutral work-graph layer, not inside the GitHub code. A
future connector — GitLab, say — that reports the same pull-request states inherits status
automation with no new code and no new setting.
