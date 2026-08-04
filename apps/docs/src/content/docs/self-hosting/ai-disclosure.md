---
title: The disclosure model
description: What yapm records when a product digest crosses a permission boundary, how long it keeps it, who can read that record, and why the "ready" email carries a link and nothing else.
---

The [product digest](/features/pm-digest/) is the only thing in yapm whose output crosses a
permission boundary. This page is the operator's view of that boundary end to end: the switches, what
gets recorded, how long it is kept, who can read the record, and the one path that leaves yapm.

Everything here is **auditable** and **retention-bounded**, and both words are used narrowly. What
they mean exactly is spelled out below, including what they do not mean.

## The four switches

All four have to agree. Any one of them is a complete stop.

| Switch | Who sets it | Where | Default |
|---|---|---|---|
| `AI_PM_DIGEST` | operator | env | `false` |
| Product digests on for the workspace | admin | *Settings → AI* | off |
| On for a specific team | admin | *Settings → AI* | off |
| A named reader list, per team | admin | *Settings → AI* | empty |

**Stop all sharing** — the kill switch — sits beside the workspace switch and blocks every read
immediately, whatever else is set.

**Nothing is spent when a team is off.** yapm reads the policy before it calls the model, so a
workspace or a team with product digests off costs zero tokens on your key. This is a gate, not a
filter applied to output that already exists.

## What gets recorded

Four events, and only four. They are written to a **server-only** table (`ai_disclosure_audit`) that
is absent from the sync schema entirely — no client can name it in any query, and no client holds a
row of it.

| Event | When | What the record carries |
|---|---|---|
| `policy_changed` | an admin turns a switch or edits an audience | which switches, and **which team ids** the write touched |
| `generated` | a product digest run reaches a terminal status | the run's status |
| `published` | somebody on the producing team releases it | the audience size at that moment |
| `unpublished` | somebody on the producing team retracts it | the audience size after retraction, which is always 0 |

Each record also carries when it happened, which team, and **who did it**, where there is a person to
name. A generation has no person: it is a scheduled job, and the record says so.

### What is deliberately not recorded

- **No read is recorded, ever.** There is no fifth event, and no table anywhere in yapm that stores
  that somebody opened a product digest. A per-reader read log would be a surveillance surface
  pointed at people outside the producing team, and yapm does not have one to turn off.
- **No audience list.** A policy record says which *team ids* a write touched — never who is on a
  reader list. A record listing readers would be a per-person roster of who may read a team's work,
  sitting in a table nobody can disable.
- **No digest content.** The record's detail field is yapm-computed metadata with no room for prose:
  a record that quoted the disclosure would be a second copy of the disclosure, sitting outside the
  kill switch.

## Reading the record

*Settings → AI → **What has been disclosed***, visible to workspace **admins** only. A member or a
viewer asking for it is refused before anything is read, and the refusal is identical whether or not
the workspace has ever enabled product digests — nothing in it distinguishes "not allowed" from
"nothing there".

It shows per-team totals of the three events that happen *to* a team — generated, shared, retracted —
and the most recent events with their times, teams, actors and yapm-computed detail. A policy change
belongs to no single team (one record describes which switches moved and which teams the write
touched), so it appears in the recent list, naming those teams, rather than being totalled under one.
A retraction is shown as the event, the team, the time and who did it; the audience size it records is
zero by definition and is not reported as a count of readers.

The totals are grouped by **team**. There is no per-person aggregate, no ranking and no trend line,
here or anywhere in yapm ([team-level metrics](/features/cycle-digest/) is a product-wide rule, not a
decision about this screen).

The section appears once something has actually been disclosed. On an instance that has never
enabled product digests there is nothing to show, so there is nothing there — and turning product
digests **off** does not hide the history of what happened while they were on, which is the moment an
admin is most likely to want it.

## Retention

Disclosure records are deleted after `AI_DISCLOSURE_RETENTION_DAYS`, **365 by default**. The sweep is
a nightly job on the pg-boss instance yapm already runs — no new container, no new service — and it
runs whether or not AI is enabled, because a bound that stops being enforced when the feature is
switched off is not a bound.

```bash
AI_DISCLOSURE_RETENTION_DAYS=365   # 1 to 3650
AI_DISCLOSURE_RETENTION_CRON="23 3 * * *"
```

**Why a year**, when notifications default to 30 days: the question an audit log is asked — *what did
we share with product, and when did the policy change?* — is asked at annual-review cadence, and a
shorter window loses the record of a policy change made two quarters ago that is still in effect.
Against that, the cost is negligible: the table is server-only, syncs to nobody, and a workspace
running ten teams on two-week cycles writes on the order of a few hundred rows a year.

**Retention deletes audit records and nothing else.** Product digests and cycle digests are not
swept: they grow at one row per cycle per team, and deleting a published one would silently remove
something a reader was told they had.

## The "ready" email

Optional, **off by default**, and it carries **a link and nothing else**.

```bash
AI_PM_DIGEST_READY_EMAIL=false   # requires AI_PM_DIGEST=true
```

When a team releases a product digest, each named reader who is still a member of the workspace gets
an [inbox row](/features/notifications/) in yapm — an id left on an audience by a departure gets
nothing, because the list is a policy and membership is the outer gate. If this is on and
[email delivery](/self-hosting/email/) is configured, they also get one message: the team's name, the
cycle's name, and a link to their digests page. No summary, no highlight, no risk flag, no evidence
label, and no publisher's name.

**Why a link only.** A mailed message sits outside all three of the mechanisms on this page **at the
same time**. The kill switch stops every further read in yapm; it cannot reach an inbox. Retention
deletes rows in Postgres; it does not delete messages in a mail store. The audit log records what
yapm disclosed; it has no way to record what a mail relay forwarded. A body carrying the digest would
defeat each of them at once. So the message carries a link, and a reader who is no longer entitled
follows it into an absent surface — because entitlement is evaluated when they read, not when the
message was sent.

Entitlement is re-checked again at **send** time, through the same resolver the app uses: a reader
removed from an audience, a team switched off, or a kill switch set between the release and the next
email sweep (`NOTIFICATION_EMAIL_CRON`, every two minutes by default) means no message goes out at
all. Nor does one for a digest **retracted** in that window — the message would link to a surface the
reader can no longer open. In each case the notice is left unsent rather than consumed, so a
re-published digest still reaches its readers.

It is off at three layers, independently: the instance variable above, the presence of a mail
transport, and each recipient's own email preference. With no transport configured the path is
cleanly inert — nothing is queued, nothing retries, nothing errors.

## What none of this can undo

**Retraction stops further reads but does not un-read.** Nothing on this page changes that. Not
retraction, not the kill switch, not retention, not turning a team off. A reader who has already read
a summary has read it, and a message already delivered is already delivered — which is precisely why
the message carries no content.

## Related

- [Product digest](/features/pm-digest/) — the feature itself
- [Enable AI](/self-hosting/ai-setup/) — keys, models and the spend cap
- [Email delivery](/self-hosting/email/) — transports, and what yapm will and will not put in an email
