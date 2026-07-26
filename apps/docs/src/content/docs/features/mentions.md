---
title: Mentions
description: Type @ to pull a teammate into an issue or a comment — keyboard-first, instant and offline, with a mention that either reaches them or says why it cannot.
---

Before this, the only way to pull a colleague into a thread was to assign them the issue — which
overwrites a real field to send a message. **Mentions** fix that: type `@` in any issue description
or comment, pick a teammate, and they are told.

Two properties are worth stating before the mechanics, because everything else follows from them:

- **A mention either reaches the person or tells you it cannot.** Whether someone may be mentioned
  is decided on the server, by the same rule that decides who may read the issue. The list never
  offers a name it cannot deliver, and when you type a name that cannot be delivered it says so
  instead of going quiet. A mention that looks like it worked and did not is the worst possible
  outcome for a communication feature.
- **Being mentioned subscribes you to the issue — and you can stop, permanently, from the issue
  itself.** See [Following an issue](#following-an-issue).

## Mentioning someone

Open an issue and type `@` — in its description, in a new comment, or in a comment you are editing.
A list of your team's members appears and filters as you type.

The list is drawn from data your browser has **already synced**, so it opens on the keystroke, with
no network request — it works on a plane. Matching is case- and accent-insensitive over display
name and email local part: `@zoe` finds *Zoë*, `@lov` finds *Ada Lovelace*, and `@ada.l` finds
`ada.lovelace@example.com`. Names that start with what you typed rank above names that merely
contain it.

Pick with `Enter` or `Tab` and a chip is inserted. The chip is plain text with styling — not a link
and not a tab stop — so it never interrupts reading a description with the keyboard.

`@` does **not** open the list mid-word, so typing `someone@example.com` in prose is just an email
address, and it does not open inside a code block or inline code.

### Keyboard

| Key | While the list is open | While it is closed |
|---|---|---|
| `↓` `↑` | Move between names | Move the caret |
| `Home` `End` | First / last name | Start / end of line |
| `Enter` `Tab` | Insert the highlighted name | `Enter` is a new paragraph; `Tab` leaves the editor |
| `⌘Enter` / `Ctrl+Enter` | Insert the highlighted name | Save the comment |
| `Escape` | Close the list — **and nothing else** | Cancel the edit |

That last row is the one that matters. Closing the mention list leaves your draft, and the issue
panel holding it, exactly where they were. Only an `Escape` that the list did not use cancels
anything.

The list is a proper listbox: the editor points assistive technology at the highlighted row, and a
polite live region announces how many names matched, when nothing matched, and when a name is
present but unusable.

## Who you can mention

| Who | In the list |
|---|---|
| A member of the issue's team | Offered as soon as you type `@` |
| A workspace admin who is not on the team | Offered **only** once you type the start of their name or email, ranked after every team member |
| Anyone else in the workspace | Shown as an unavailable name with the reason, once you type the start of their name or email |
| Yourself | Not offered — a self-mention notifies nobody, so offering it would be offering something that does nothing |

An admin is held back rather than hidden: they *can* read every issue in the workspace and so they
*can* be mentioned, but padding every team's `@` list with people who are not on the team makes the
common case worse. Naming them brings them up.

Anyone else — a colleague who is in your workspace but not on this issue's team — appears as a
reachable but non-selectable row reading **"Not on this team — can't be mentioned here"**. Pressing
`Enter` on it inserts nothing and announces the reason. Nothing new is revealed by showing them:
every workspace member's client already syncs the full user list and every team's membership.

When nothing matches at all, the list says so and names what you typed, rather than closing on you.

**This is enforced on the server, not in the interface.** A mention of someone who cannot read the
issue — written by a modified client, through the API, or by an
[AI agent acting as a user](/self-hosting/ai-setup/) — produces no notification, no email and no
subscription. The mention text stays in the document and renders as inert plain `@Name`.

## Renames, and what is actually stored

A mention stores the person's **identifier**, never their name. The name you see is resolved from
the live user record every time the document is rendered. So:

- Someone changing their display name updates every mention of them, in every issue and comment
  ever written.
- A hand-crafted document cannot make a mention *appear* to name a colleague it does not.
- A mention of a deleted or unresolvable user renders as plain `@` text, not a broken chip.

## What being mentioned does

Being mentioned gives you exactly one [notification](/features/notifications/) —
`Ada mentioned you in ENG-42` — and, if your instance has email configured and you have not read it
in the app first, one email. Mentions are emailed at the **default** email preference, because a
mention is addressed at you personally. That email states in one line that you now follow the issue
and can stop from the issue page; it carries no unsubscribe link, because the control is the
issue's own [Follow button](#the-follow-control) inside the app.

A comment that names you gives you the mention and **not** also the ambient "commented" row for the
same comment — being the assignee, or already following the issue, does not double it up.

**You are notified at most once per comment and at most once per issue description**, whatever
sequence of edits happens afterwards:

- Editing a comment to add a second person notifies **only** the person you added.
- Re-saving a comment with no change to its mentions notifies **nobody**.
- Removing a mention and adding it back does **not** notify a second time.
- Mentioning yourself notifies nobody.

If a single document mentions an extraordinary number of people, the first 50 are notified and the
rest are not; the document still saves with every mention intact and nothing fails.

## Following an issue

**Being mentioned makes you follow the issue.** From then on, new comments on it reach your inbox
even when nobody names you and you are not the assignee. That is what everybody means by an `@`, so
it is what it does — and the way out ships in the same breath.

Subscription activity is **in-app only**. Being mentioned emails you once; the thread it subscribed
you to never emails you at the default preference. (Choosing *Email everything* in
[your notification preference](/features/notifications/#your-preference) opts you into it.)

### The Follow control

Every issue's detail view carries a **Follow / Following** control in its property sidebar, under
**Updates**. It is a normal keyboard-reachable button, it announces its pressed state, and it
toggles optimistically — nothing waits on the network. In the instant before your own subscription
has arrived on a client that has never seen this issue, it says **Updates** and is inert rather than
guessing: it would rather tell you nothing than tell you that you are not following something you
are.

- **Follow** — *"Follow to get updates on this issue in your inbox."*
- **Following** — *"Updates on this issue reach your inbox. Select to stop."*

You can follow an issue you were never mentioned in, too.

### Unfollowing is permanent for that issue

**Unfollowing sticks.** A later mention of you on the same issue still notifies you once — it is
addressed at you — but it does **not** put you back on the thread. Only you, pressing Follow again,
can re-subscribe you.

That is deliberate. An automatic subscription with no exit is a mail trap, and one whose exit the
next `@` quietly undoes is a worse one.

:::note
A `viewer` can follow and unfollow exactly like a member. Following is gated on being able to
**read** the issue, not on being able to change it — anyone who can be subscribed must be able to
unsubscribe.
:::

## Privacy

**There is no follower list and no follower count, for anyone, admins included.** The control shows
your own subscription and nothing else; the only query over subscriptions is scoped to the person
asking, so no interface could render a watcher list even if it wanted to.

Consistent with yapm's [team-level-metrics-only](/features/cycle-digest/) rule, mentions add nothing
that could become a per-person scorecard: no "who mentions whom", no mention counts, no aggregation
across people. A mention is a message, not a measurement.

Mentions also stay out of AI context. The
[cycle digest](/features/cycle-digest/) and every other model-facing read is built on team-level
aggregates with no per-person data by construction, and mentions are the first thing that puts a
colleague's name inside a description or a comment body. Any path that ever feeds document text to a
model is required to strip mention nodes first; none reads those columns today.

## Leaving a team

Removing someone from a team deletes their issue subscriptions **for that team** and leaves the rest
intact; removing them from the workspace deletes all of them. A person who has left the issue's team
stops receiving its activity immediately, before any cleanup runs, because the subscriber list is
re-checked against team membership every time it is used.

## What is not here

`@team` and `@here` group mentions, `#123` issue references, and label or project triggers are **not
implemented**. Exactly one trigger character ships, addressing exactly one person at a time.

Mentions live in rich text only — issue titles, retro cards and project descriptions are plain text
and take no `@`. Mentioning somebody never grants them access to anything, and deleting a mention
does not un-send the notification it produced.
