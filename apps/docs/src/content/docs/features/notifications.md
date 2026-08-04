---
title: Notifications
description: A per-user inbox for assignments, comments on issues you are involved in and product digests released to you, keyboard-first, with optional email — and no way for anyone, admin included, to read your inbox.
---

Before this, yapm could assign you an issue and never tell you. **Notifications** close that: a
per-user inbox at `/inbox`, an unread badge, and — when your instance has an email transport
configured — a batched email for the things actually addressed at you. Two kinds of subject reach
that inbox: an **issue**, and a [product digest](/features/pm-digest/) a team released to you.

Two properties are worth stating before the mechanics, because they are what the rest is built on:

- **A notification is addressed to exactly one person and readable by exactly that person.** Not a
  teammate, not a workspace admin. This is enforced in the sync permission model, not in the
  interface.
- **A notification is routing, never a record about you.** There is no read receipt, no "who reads
  their notifications" signal, and no view or export that aggregates notifications across people.
  See [Privacy](#privacy).

## What triggers one

| Event | Who is notified |
|---|---|
| An issue is created with an assignee | The assignee |
| An issue is assigned | The new assignee |
| A [triage](/features/triage/) issue is routed with an assignee | The assignee |
| A [retrospective](/features/retrospectives/) action with an owner is converted to an issue | The owner |
| You are [`@`-mentioned](/features/mentions/) in a description or a comment | The person mentioned |
| Someone comments on an issue | Its assignee, its creator, everyone who commented before, and everyone [following](/features/mentions/#following-an-issue) it |
| A team releases a [product digest](/features/pm-digest/) | The readers an admin named for that team |

Three rules apply to every row in that table:

- **The actor is never notified about their own action.** Assigning an issue to yourself, commenting
  on an issue you are assigned, or mentioning yourself, notifies nobody.
- **Recipients are deduplicated.** If you are the assignee *and* the creator *and* a prior
  commenter *and* a follower, one comment produces one notification. Deduplication is the database's
  own primary key rather than a merge step, so the two independent producers of a comment
  notification — involvement and [following](/features/mentions/#following-an-issue) — cannot
  double-notify anyone regardless of which runs first. The comment recipient set is also capped (at
  50) so a thread with hundreds of participants cannot turn one comment into an unbounded write.
  On a thread past the cap it is the **most recent** participants who are kept — the people
  currently discussing it, not whoever commented once at the start. The follower set is capped by
  the same number, oldest subscription first.
- **You are only notified about issues you can still read.** That is current members of the issue's
  team, plus workspace admins — an admin can read every issue in the workspace, which is why one can
  be [`@`-mentioned](/features/mentions/) on an issue outside their teams. The **involvement** kinds
  are narrower: assignment, and a comment reaching the assignee, the creator or a prior commenter,
  reach current members of the issue's team only. Involvement outlives membership — you can have
  created an issue, or been its assignee, in a team you have since left — so the check is made when
  the notification is written, and the same check is made again when it is emailed.

The last row is the one exception to the shape of all the others, and deliberately so. It **names no
actor** — it reads "A cycle digest was shared with you", never who released it, because telling a
reader outside the producing team which individual pressed publish is accountability in the wrong
direction. It carries the team's name and the cycle's name and **nothing of the digest**, and opening
it goes to your `/digests` page rather than to any of that team's work. Its recipients are not an
involvement rule at all: they are the named audience an admin configured, intersected with current
workspace membership, resolved at the moment of release. See [Product
digests](/features/pm-digest/) and [the disclosure model](/self-hosting/ai-disclosure/).

Notifications are written **only on the server**, inside the same database transaction as the
change that caused them, and they are keyed by what happened rather than by a generated id. So the
same assignment applied twice — a retry, a rebased optimistic mutation — produces exactly one row,
and a change that rolls back takes its notifications with it.

### What deliberately does not notify

Status changes, priority and label edits, moving an issue between cycles or projects, board
reordering, project and cycle lifecycle events, and retro activity produce **no** notification.
Every one of those is visible where the work is, and the fastest way to make an inbox worthless is
to fill it with things nobody acts on.

### Mentions and following

[`@`-mentions](/features/mentions/) arrive through the same machinery as everything above — no
second inbox and no second preference. Two things about them are worth reading here:

- **A mention is emailed at the default preference**, because it is addressed at you personally.
  You are notified at most once per comment and at most once per issue description, whatever
  sequence of edits follows; editing a comment to add somebody notifies only the person added. The
  email says, in one line, that you now follow the issue and can stop from the issue page — and
  says it only when the mention actually subscribed you, so a mention on an issue you unfollowed
  never claims otherwise.
- **A comment that names you tells you once.** You get the mention, not also the ambient "commented"
  row for the same comment — even if you were already following the issue or are its assignee.
- **Being mentioned makes you follow the issue**, so later comments on it reach your inbox even when
  nobody names you. That activity is **in-app only** — it is ambient, so the default preference
  never emails it. Unfollow from the **Following** control on the issue itself; the decision sticks,
  and a later mention will not quietly put you back on the thread.

## The inbox

`/inbox` lists every notification addressed to you, across every team you belong to, newest first,
grouped into **Today / Yesterday / Earlier**. Each row shows who did what, and which issue —
`Ada assigned you ENG-42`, with the issue's title underneath. A released [product
digest](/features/pm-digest/) reads differently by design: `A cycle digest was shared with you`, with
the team and cycle underneath and no actor at all.

**A row shows the issue title as it was when the event happened.** It is a snapshot taken at write
time, not a live join. If someone renames `ENG-42` an hour later, your notification still reads the
old title. That is deliberate: a notification is a record of what happened, and a row that silently
rewrites itself is a worse record than one that does not. Opening it always lands you on the
current issue.

**No body content, anywhere.** A row names the actor, the action and the issue. It never carries a
line of the comment that caused it — not in the inbox, and not in the email. Nothing about a
comment's contents leaves the app's permission model.

Opening a notification takes you to its subject — the issue, or your `/digests` page for a released
product digest — and marks it read. Marking read is optimistic: the row and the badge change in the
same frame, with nothing waiting on the network.

**Mark all read** means all of them — including notifications your browser has not synced. The
inbox syncs your 100 most recent; the action reaches the rest on the server.

### Keyboard

| Key | Action |
|---|---|
| `j` `k` (or `↓` `↑`) | Move the cursor |
| `Enter` / `Space` / `→` | Open the subject and mark the notification read |
| `e` | Toggle the focused notification between read and unread |

And from the command palette (`⌘K` / `Ctrl+K`), under **Notifications**:

| Command | Effect |
|---|---|
| `Go to inbox` | Opens `/inbox` |
| `Mark all notifications as read` | Same as the inbox's own button, from anywhere the palette is |

### The unread badge

The application-shell header carries a bell, with a count pill on it when anything is unread. Its
accessible name is the whole sentence — `Inbox, 3 unread` — so a screen reader announces the number
once rather than reading a bare pill. Past 99 it reads `99+`. It is a real link: it is in the tab
order, `Enter` follows it, and middle-click opens it in a tab.

The badge and the inbox read **one** shared subscription, so the count is the same number the list
is showing, always, with no second query.

:::note
The badge currently renders on the surfaces that use the application shell — the home screen, the
inbox itself, the team overview, and the settings screens. The team work surfaces (issue list,
board, cycles, projects, roadmap, retros, triage) compose their own header and do not show it yet.
From those, `⌘K → Go to inbox` reaches the inbox by keyboard. Hoisting the shell header across every
route is a separate change.
:::

## Email

Email is **optional and off unless your operator configures a transport** — see
[Email delivery](/self-hosting/email/) for the self-hosting side. The in-app inbox is complete
without it.

When a transport is configured, a sweep runs every couple of minutes and sends **one message per
recipient** covering everything that has accumulated. Four things bound it, and all four matter:

- Nothing is emailed until it has sat unread for a short debounce window.
- Everything waiting for one person becomes a single message, not one per event.
- **A notification you have already read in the app is never emailed.** Reading your inbox is what
  stops the mail.
- Access is re-checked at delivery time as well as at write time, by the same rule — on the issue's
  team, or a workspace admin. Leave a team and you stop being emailed about it, even about
  notifications written while you were still a member. A released [product
  digest](/features/pm-digest/) is checked at delivery time too, against the rule that governs *it*
  rather than that one: the audience resolver that grants the read. A reader dropped from the
  audience, a team whose sharing was switched off, a workspace kill switch, or a digest retracted
  between the release and the send all mean no message — and the notice waits rather than being
  spent, so a re-published digest still reaches them. See [the disclosure
  model](/self-hosting/ai-disclosure/).

Email carries the same words as the inbox row and the same absence of body content, and links back
to the issue — or, for a product digest, to your digests page — on your instance's own public URL.
The product-digest notice is additionally **off unless your operator turns it on**
(`AI_PM_DIGEST_READY_EMAIL`), and it carries a link only: never a summary, a highlight, a risk flag,
an evidence label or a publisher's name.

### Your preference

Open **Appearance settings** (the palette icon in the header) and set **Email notifications**:

| Setting | What is emailed |
|---|---|
| **Email what needs me** *(default)* | Things addressed at you — assignments, [mentions](/features/mentions/), and a [product digest](/features/pm-digest/) released to you |
| **Email everything** | The above plus ambient activity, such as comments on issues you are involved in or following |
| **No email** | Nothing |

**The preference governs email only.** Turning email off never costs you the notification: the
in-app row is always created and always readable, whatever the setting. The control says so on
screen, and it is fully keyboard-operable like every other preference.

## Retention

Notifications older than **30 days** are deleted by a scheduled sweep. The window is configurable
by your operator (`NOTIFICATION_RETENTION_DAYS`), and the sweep runs whether or not email is
configured — retention is what keeps the synced set small, not an email feature.

[Issue subscriptions](/features/mentions/#following-an-issue) are **not** swept. They are stored
separately and durably for exactly this reason: a subscription derived from notification rows would
silently expire after 30 days, and an issue you follow would stop reaching you with no event to
explain it.

## Leaving a team or the workspace

When someone's membership is removed, their notifications are **deleted**, not kept:

- **Leaving one team** deletes that person's notifications *and* their
  [issue subscriptions](/features/mentions/#following-an-issue) for that team, and leaves both
  intact for other teams.
- **Leaving the workspace** deletes every notification addressed to them and every issue
  subscription they hold.
- **Deleting a team** removes every notification for it, for every recipient.

This runs on the server, in the same transaction as the membership change — the admin doing the
removal can never read the rows they are deleting, which is exactly why it cannot be done any other
way.

## Privacy

**No user, of any role, can read another user's notifications.** The inbox query filters on your
verified identity, and — unlike the team-scoped queries the rest of the app uses — it carries **no
workspace-admin bypass**. An admin who can read every issue in the workspace still receives zero
rows of anybody else's inbox. A test asserts it against the admin's own local replica, so the
guarantee is about what is *sent* to a client, not about what the interface chooses to draw. It is
the same posture as [retrospective anonymity](/features/retrospectives/#anonymity).

Consistent with yapm's [team-level-metrics-only](/features/cycle-digest/) rule, this feature adds
nothing that could become a per-person scorecard: no per-person activity table, no read receipt a
sender can see, no "who reads their notifications" signal, and no count, view or export of
notifications aggregated across people. The delivery sweep logs totals with no identity attached.

Notification and email delivery are **role-independent**. A `viewer` is notified and emailed
exactly like a `member` or an `admin` — no role gate, no seat gate.
