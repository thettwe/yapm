---
title: The app frame
description: The three bands every page sits in — the deck, the page's masthead, the statusline — plus the six destinations, the one-attention-number rule, and the keyboard grammar.
---

Every authenticated page in yapm sits in the same chrome: **three horizontal bands**. Two of them
belong to the app and are identical everywhere; the middle one belongs to the page.

| Band | Height | Owner | What it carries |
| --- | --- | --- | --- |
| 1 — the deck | 48px | the app | workspace · team · the six destinations · ⌘K · attention · Inbox · you |
| 2 — the masthead | the page's | the page | the surface's title, count, lens, filters and actions |
| 3 — the statusline | 32px | the app | the team's day in one line, and the sync state |

The deck and the statusline never adapt to the page. The only thing about the deck that changes as
you move is **which stop is current**.

## The six destinations

The bar carries six stops, and nothing else is a destination:

**Home · Issues · Triage · Cycles · Delivery · more▾**

`more▾` is a transient, not a seat. It holds Retros, Projects and Roadmap, each with its keyboard
shortcut.

Below the deck's comfortable width the stops **fold into `more▾` from the right** — Delivery first,
then Cycles, then Triage — where they reappear under a **Team** group with the same shortcuts. Home
and Issues never fold, and the band never wraps to a second row: its 48px height is a rule, so at a
narrow measure the bar carries fewer than six stops and the menu carries up to six items.

Everything else in the product is reached as a **lens**, a **doorway** or a **setting**:

| Surface | How you reach it |
| --- | --- |
| Board | a lens in the Issues masthead — `List` \| `Board`. Board is a view of Issues, not a peer of it, so the Issues stop stays current |
| An issue | a doorway from an Issues row; the Issues stop stays current |
| A retro | a doorway from the Retros list |
| Members | the workspace/team switcher, under the current team |
| Inbox | the deck's right cluster, with its unread count |
| Search | the ⌘K pill — a real link, so `/search` is reachable with no pointer |
| Appearance, connectors, AI, single sign-on | the account menu — they are settings, not places |

## Where signing in lands

Signing in puts you on **a team's Home**, not on the workspace administration page. The team is the
one you last visited, or failing that the first team whose work you can read — which is a team you
belong to if you are a member or a viewer, and any team at all if you are a workspace admin, since
an admin reads every team. If no team passes that test — a brand-new workspace with no teams, or a
member who belongs to none because they have just accepted a workspace-wide invitation — you land
on the workspace overview instead, which is the page whose contents are actually yours. Nothing
moved: the overview is still `/`, still reachable from the workspace switcher and from `⌘K`
("Go to workspace overview"), and every link that reached it before still does.

The decision is taken in **one** place. Creating an account, signing in with email and password, and
returning from GitHub or your SSO provider all arrive by the same route — a provider sends you back
to the sign-in page precisely so that the one decision is the one that runs.

**Accepting an invitation goes through the same decision.** An invitation bound to a named team
lands you on that team's Home, because accepting it is what put you on the team. A workspace-wide
invitation, which names no team, lands wherever the ordinary rule sends you.

While the decision is being made — your role and your team list are both synced values — the sign-in
page holds its loading state rather than guessing. It never holds it indefinitely: if the sync
credential cannot be obtained, you get the same retry surface the rest of the product shows when the
server is unreachable, and if the session turns out to be over you get the sign-in form back.

## One attention number

The count in the deck's badge, the `N need attention` segment in the statusline and the **NEEDS
ATTENTION** band on Team Home are always the same number, because they are the same derivation:
four disjoint exception classes, assigned by precedence so an issue matching two is counted once.

- done in git, not on the board
- checks failing
- waiting on review for over a day
- new in triage

**At zero the badge and the segment are absent, not zeroed.** A `0` would be a claim that all four
classes were evaluated and came back empty — which is not what "we have not looked" means. See
[Team Home](/features/team-home/) for what each class looks like when you open it.

## The team's day

Band 3 states four facts, each of which folds on its own when it does not exist:

```
Cycle 2, day 9 of 14 · 8 shipped · 3 deploys this week · 4 need attention        ● Synced
```

The sync state is right-aligned and lives **only** here — there is no second connection indicator
anywhere in the product. When sync is recovering, this is where it says so, and where the retry
control appears.

### Off a team

yapm is one workspace of many teams, and several surfaces — the workspace overview, the inbox,
search, settings — belong to no team. There the frame degrades honestly:

- the six stops stay, pointing at your **anchor team**: the last team you visited, or the first one
  you can see. No stop is marked current, because you are not on one of them.
- the statusline says **nothing about a team**. No cycle, no shipped count, no deploys, no attention
  badge — only the workspace's name and the sync state, which are the two things that are true
  there.
- a workspace with no teams at all drops the six stops entirely rather than offering doors onto
  nothing.

The rule underneath: **the deck may point at a team; the statusline may only report one.** Navigation
is an offer and can be wrong without lying. A statusline fact is an assertion about your team.

The same rule is why the **anchor team** and the **landing team** are two different things, even
though they usually agree:

| | what it is | how it is chosen |
| --- | --- | --- |
| the anchor | where the deck's six stops point when you are off a team | the last team you visited, or the first team you can *see* |
| the landing | where signing in puts you | the last team you visited, or the first team you can *read* — your own teams as a member or viewer, every team as a workspace admin — and never one you cannot |

Everyone in a workspace can see the name of every team; being able to name a team is not being able
to open it. The deck may offer a stop pointing at a team whose issues would come back empty for you,
because an offer you decline costs nothing. Being *put* there is a different act, so the landing
applies the stricter test and falls through to the workspace overview when no team passes it.

## The keyboard

The frame is fully operable without a pointer.

| Keys | What happens |
| --- | --- |
| `⌘K` / `Ctrl-K` | the command palette, on every page — one binding, owned in one place |
| `g h` | Home |
| `g i` | Issues |
| `g t` | Triage |
| `g c` | Cycles |
| `g d` | Delivery |
| `g r` | Retros |
| `g p` | Projects |
| `g m` | Roadmap |

The `g` prefix expires after a moment, and the whole grammar is suppressed while a text field, a
rich-text editor or an open dialog holds the keyboard — so `g` in the middle of a word stays a `g`.

`⌘K` opens whichever palette the surface you are on offers. On a surface with its own — the issue
list, the board, a retro — that is the palette with that surface's actions in it. Everywhere else it
is the frame's own: the six destinations, the inbox, search everything, appearance, and — while sync
is recovering — `Retry sync now`, so the one control that gets you writing again is never a long
page's worth of `Tab` away. A surface palette that is about something you have not selected (the
board's is about the focused card) hands the binding back rather than swallowing it, so `⌘K` always
opens something: that is the point of advertising it on every page. Whatever registered before it
answers instead — on the Board lens that is the Issues palette, which the lens shares with the list.
