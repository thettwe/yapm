---
title: Search
description: Find an issue or a comment across every team you can read — instant on rows your browser already holds, then completed by the server, with two groups that never reorder under your keyboard.
---

Search answers in two passes, and it shows you which one answered.

The first pass runs **in your browser**, on the keystroke, over rows the sync engine has already
replicated. It issues no network request, so it costs nothing and it works with the connection
down. The second pass runs **on the server**, over Postgres full-text, and extends the first with
the text your browser does not hold — comment bodies, and issues in your other teams.

They are shown as two labelled groups, **On this device** and **From the server**, and never merged
into one list. That is a deliberate choice and the rest of this page follows from it:

- The two passes genuinely match differently — the on-device pass matches literal substrings (plus a
  strict word-prefix abbreviation), the server pass is full-text — so a merged list would produce the
  confusing case where the server "finds something the on-device pass should have".
- A merged list **reflows** when the second half arrives, 150 ms after you stopped typing. Arrow
  down to the third row, and the row under your cursor would move between the arrow key and
  `Enter`. yapm is keyboard-first before it is familiar, so the seam is shown instead.

Every result the server adds is **appended strictly at the end of the list**. Nothing above it ever
changes position, and the cursor is anchored to the row's identity rather than to its index — so
arrowing while the server is still thinking is safe.

An issue both passes find appears **once**, in the on-device group. Only the duplicate is dropped,
and only from the tail, so nothing above it moves. A comment hit stays even when its issue is
already listed: that is different text about the same issue, and it is the half your browser
structurally cannot answer.

That decision is made once, at the moment the server answers. If a row syncs to your browser
*afterwards* it is added to the on-device group above — it never removes a result you are already
looking at, because a list that deletes the row under your cursor is worse than a list that shows
one thing twice until you change the query.

## Where to search

There is exactly **one** keyboard shortcut, and it is the one you already use.

| Surface | How you get there | What it searches |
|---|---|---|
| **Command palette** | `⌘K` / `Ctrl+K` | The **currently open team**, in both groups |
| **`/search?q=`** | The **⌘K pill** in [the deck](/features/app-frame/), or `Search everything for "…" →` in the palette | **Every team you can read** |

Two doors, one binding. The pill is a real link in the tab order on **every** authenticated page —
the deck is the same on all of them — and the palette's escalation row carries a query you have
already started typing to the same route.

`⌘K` itself has **one owner**: a single global binding in the frame. A surface with its own palette
— the issue list, the board, a retro — registers its commands with that owner while it is mounted
rather than binding the key again, so the pill never advertises something that does nothing.

The palette stays the action launcher it has always been — `New issue`, `Go to inbox`, the triage
and label pages — and adds results below the actions, capped at about five per group. When you want
more than five, the persistent `Search everything for "…" →` row carries your query to the full
route. It sits *above* the server group on purpose: server results are appended last, so a row
below them would slide away as they land.

`/search?q=` is a real URL. It is shareable, the browser back button works, and opening a result
and pressing Back restores the same query and the same results. The URL settles about 400 ms behind
your typing and replaces rather than pushes, so Back returns to the page you came from instead of
walking backwards one character at a time.

**No second shortcut ships.** No `/`-to-search, no separate "quick find". One question, two depths,
one binding.

## Keyboard

| Key | Does |
|---|---|
| `⌘K` / `Ctrl+K` | Open the palette |
| Type | Filters everything — action rows and result rows alike |
| `↓` `↑` | Move the active row, **across the group boundary** — the two groups are one list |
| `Home` `End` | First / last row |
| `Enter` | Open the active result, or run the active action |
| `Escape` | In the palette, dismiss and restore focus. On `/search`, return focus to the input — it never clears your query |

On `/search`, typing a single printable character anywhere on the page moves the caret into the
query field — unless another field, a dialog or a list already owns the keyboard, in which case it
does nothing. It is not a shortcut; it is what makes the route usable after `Tab` has taken focus
to the deck.

The result list is a listbox with a labelled group per heading, so the seam is conveyed structurally
rather than only visually. One **polite** live region announces the counts for the whole surface —
one, not one per group, so the server group arriving cannot interrupt you mid-arrow.

Every colour, font and radius is a theme token. The active row and its snippet highlight meet AA
contrast in all three presets, light and dark.

## What is searchable

| | Where it is searched | What is matched |
|---|---|---|
| **Issues** | On device **and** on the server | Title (ranked above) and description text |
| **Comments** | Server only | The comment's own text |
| **Projects, cycles, teams, labels** | On device only | Name — the same ladder as issues, minus the key tiers (substring plus the word-prefix abbreviation tier) |

Comments are the reason the server pass exists. Your browser only syncs the comments of the issue
you currently have open — bulk-syncing every comment of every team to every client is exactly the
antipattern the sync engine exists to avoid — so a comment search is a search the client
structurally cannot answer.

Projects, cycles, teams and labels are the mirror case: they are already fully synced under the
same permissioned queries that decide what you may read, so indexing them on the server would
duplicate data you already hold, for nothing.

A comment result is attributed to **its issue**: you see the issue's key and title with a snippet of
the comment, and opening it opens the issue. A comment's document holds only the comment's own text
— the parent issue's title is not folded in — so searching an issue's title returns that issue
**once**, not once per comment on it.

### Triage and canceled issues are included, and labelled

Issues awaiting triage are held out of every list, and canceled issues are filtered out of most.
Search returns both, each with a visible label.

Both are readable, so neither is a permission question — it is a product one, and the answer is
that **lists curate, search reports what exists**. Finding nothing when you search for an issue you
filed and someone later canceled is worse than finding it marked *Canceled*.

### Retrospectives are never searchable

No search path reads, indexes, joins to or names any retrospective table — not cards, not drafts,
not votes, not actions, and not a retro's own title.

That is stricter than the [anonymity guarantee](/features/retrospectives/) requires. A retro's title
names nobody. It is excluded anyway, because the set of indexable things is an **allowlist of two**
(`issue` and `comment`) enforced by a database constraint rather than by a rule someone has to
remember — which turns *"no search path can reach the card→author binding"* from a judgement about
which retro column is safe into a one-line check anybody can run. A retro is a handful of rows per
team, all one click from the cycle view; the value of indexing it was never worth that.

### Not searchable at all

People (`@`-mention picking already covers finding a colleague, and a people index invites directory
scraping), saved views, cycle digests, connector and PR/CI payloads, and attachments.

## What each state means

The surface always says what is happening rather than showing an empty box.

| You see | It means |
|---|---|
| **Keep typing to search everything** | Fewer than two non-whitespace characters — no request is sent. The on-device group still renders |
| **Searching…** | The server request is in flight |
| **No further matches** | The server answered and found nothing the on-device group had not already |
| **Offline — on-device results only** | The sync connection is not established; the on-device group is unaffected |
| **Showing the first 50 — refine your query** | The server returned its cap. There is no pagination and no infinite scroll — narrow the query instead |
| **No matches for "…". / Try fewer or different words. / Recently edited items can take a few seconds to appear.** | Both passes finished with nothing |

**None of these states depends on whether a row you cannot read existed.** That is the rule the
whole surface is built around; see [Search cannot tell you what
exists](#search-cannot-tell-you-what-exists) below.

The third line of the empty state is not filler. The server index is maintained a few seconds
behind your writes, on purpose — see [What "a few seconds" means](#what-a-few-seconds-means).

### Offline

With the connection down, the on-device group works exactly as it does online: it is a synchronous
pass over rows already in memory. The server group is replaced by its offline line. It reads the
**same** connection state the [connection pill](/self-hosting/sync-recovery/) shows, so search and
the pill can never disagree about whether you are online.

A client still dialling on first load reads as *Searching…*, not *Offline* — being early is not the
same as being disconnected.

## What "a few seconds" means

Editing an issue title does **no** index work. The write path is untouched, so an edit costs exactly
what it cost before search shipped — that is the sub-100ms interaction budget being kept, and search
freshness bending instead.

The index catches up in the background, typically within about ten seconds. So a comment you post
right now is findable on the server shortly, not instantly. Two things are immediate regardless:

- **The on-device pass.** Your own edits are in your own replica the moment you make them, so your
  new issue title is findable on this device with no wait at all.
- **Deletions.** Deleting a comment removes its searchable text in the same transaction. Deleted
  text never stays findable, not even for a second.

Operators can tune the interval and watch the index's freshness — see [Search
index](/self-hosting/search-index/).

## Search cannot tell you what exists

Search never reveals the **existence** of something you may not read. Not by returning it, not by a
count, not by how the results are ranked, and — the subtle one — **not by answering differently**.

- Your team set is resolved on the server from your workspace and team membership, mirroring the
  same read rule the rest of the product uses, including the workspace-admin bypass. It is never
  taken from anything the browser sends.
- A miss, a match in a team you are not in, a blank query, a one-character query, an unparseable
  query and a query that took too long all return **exactly the same response**. Same status, same
  bytes. A different status code for one of them would be an oracle: you could learn that something
  existed from the *shape* of the refusal.
- The response carries no total, no result count, and no "N more results you can't see".
- Snippets are generated *after* the permission filter, in the same database statement, so a
  snippet can never be built from text you may not read.

Requests without a valid session are refused before anything is read, and the refusal is identical
whether or not the query would have matched.

## Queries are never recorded

**yapm stores no search query, anywhere.** There is no query log table, no analytics, no "popular
searches", no server-stored recent searches, and no per-person search metrics of any kind. Your
query string does not reach the server's logs either — including the ordinary request log line,
which records the path and not the query.

That is refused on principle rather than deferred: a search log would be the first per-person
behavioural record in the product, and yapm's [metrics rule](/features/cycle-digest/) is
team-level only, never a per-person scorecard.

For the same reason, **the search index is never an AI data source**. Its text contains
descriptions, comment bodies, and colleagues' names — a mention is indexed as the person's name so
you can find it that way. Every model-facing read in yapm is built on team-level aggregates that
structurally cannot name a person, and a searchable projection of every document is exactly the
shape that would break that. No AI path reads it, and search adds no agent tool.

## Ranking

**On device**, in order: an exact issue-key match, then a title prefix, then a title substring, then
a substring of the body text, then a partial issue key — so typing `ng-1` still finds `ENG-12`,
ranked below every real title hit rather than above it — and last an **abbreviation**: a query that
spells out successive word beginnings, so `cs` reaches `Change status` and `eng12` reaches `ENG-12`.
Ties break on most-recently-updated.

The abbreviation tier is deliberately the strictest kind: every character has to land at the start
of a word, in order. `log` does *not* find "Landing page for the org". A looser rule would make the
issue list's text filter — which shares this predicate exactly, so the two can never disagree about
what "matches" means — feel like it was matching at random.

**On the server**, Postgres's own relevance rank, with the title weighted above the description or
comment body. Recency is a **tiebreak only**, never a blended weight — a recency coefficient needs
real usage data to calibrate, and inventing one now would be a number nobody could defend.

Both are fully deterministic: the same query over the same data produces the same order, every time.

Beyond that abbreviation rule, search is **not fuzzy**. There is no typo tolerance, no synonyms and
no stemming by default — the default text configuration is language-neutral rather than
English-specific, because yapm is for
self-hosters everywhere and stemming would quietly optimise for English teams. An operator can
change it; see [Search index](/self-hosting/search-index/#choosing-a-text-search-configuration).

## Small things worth knowing

- **A mention is findable by the person's name.** The server index resolves mention nodes to the
  person's current name, so renaming somebody makes their mentions findable under the new name the
  next time the index touches those documents. The on-device pass reads the name stored on the node,
  so immediately after a rename the two groups can briefly disagree — which is the seam doing its
  job.
- **Archived teams are still searchable.** Search mirrors the read rule exactly rather than
  inventing a third behaviour; archiving hides a team from navigation, not from what you may read.
- **Snippets are text, never markup.** A comment containing something that looks like HTML shows
  those characters literally. No snippet output is ever interpreted as markup.
- **`/search`'s on-device group is thinner than the palette's**, because a browser cannot hold every
  issue in every team. It reads the issues assigned to you across your teams, plus projects and
  teams. Completeness on that route comes from the server group — which is the design working, not
  a gap.
