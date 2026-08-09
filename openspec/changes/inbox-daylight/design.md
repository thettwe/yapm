# Design — inbox-daylight

## Context

`/inbox` is the seventh and last destination in the overhaul. Unlike the other six it has a
constraint no other page has: **a notification has no relationship to its subject.** The
`notification` table stores a denormalised `subject_key` and `subject_title` snapshotted at write
time, and `packages/schema/src/zero/schema.ts` says so in the code:

> NO `issue` RELATIONSHIP, deliberately (design D3). Joining the subject off a self-scoped query
> would need the `teamScoped` predicate on the related issue to avoid widening reads past the team
> boundary, and a notification whose issue fell out of scope would then render blank.

So every instinct that made the other six pages good — draw the status arc, draw the reality track,
show what the work is doing now — is forbidden here. The page draws exactly the text the
notification stored, and nothing else.

## Goals

- The row is the set's row: `--density-row`, one line, the same column boundaries.
- Read and unread legible without colour.
- The empty state reads as composed, not as a hole.
- Every shipped capability survives (inventory below).
- No new tables, no new queries, no mutators beyond the shipped read/unread writes.

## Decisions

### D1 — The snapshot title is the title; the actor-and-verb is the phrase

The shipped row's headline is the copy sentence (`Marta mentioned you in ENG-116`) and the issue
title is a subline. The mock inverts it, and the mock is right: the reader is trying to reach the
issue, and `issues.html`'s anatomy already reserves a phrase column for a short derived remark. So
the row draws `subjectKey` in the key column, `subjectTitle` as the title, and an actor-and-verb
phrase (`Marta mentioned you`) in the phrase slot.

This needs a **third string** out of `notificationCopy` — the actor-and-verb without the subject
interpolated. It is added there rather than derived in the app because `notificationCopy` is
declared as "the one place a notification is turned into words", and a second wording function in
`apps/web` is exactly how the inbox row and the email start describing the same event differently.
`title` and `summary` do not move, so the email templates render byte-identically.

The four phrases: `<actor> assigned you`, `<actor> commented`, `<actor> mentioned you`, and — for
`pm_digest_published`, which names no actor by design — `Shared with you`.

### D2 — Four drawn kind glyphs, page-local, never glyph-only

The mock draws the four kinds in the house manner (20-unit box, 1.6 hairline, `currentColor`, no
borrowed set). They live in `apps/web/src/notifications/kind-glyph.tsx`, not `packages/ui`: the
precedent in this repo is that a page-local drawing (`roadmap-view.tsx`, `triage-view.tsx`,
`delivery/stat-tile.tsx`) moves into `packages/ui` when it gains a **second** consumer, and this one
has one. It also keeps a parallel build off shared code.

The glyph is `aria-hidden`; the kind is stated in a visually hidden word on the row, so a screen
reader hears the kind and a colour-blind or low-vision reader has the drawing *and* the phrase.

### D3 — Read / unread on three channels, and none of them is hue

The gutter disc (present / absent), the title's weight (600 / 400), the title's ink
(`--text-1` / `--text-2`). Plus the shipped `data-read` attribute and the `sr-only` `Read` /
`Unread` word, both of which survive verbatim — the e2e drives `data-read`.

The mock also inks the **read** row's phrase `--text-3`. That measures 2.9:1 on `--bg` in warm
light, under AA for 12.5px text, and the mock's own self-critique names it as the weakest channel
carrying the most load. Following `issue-list-daylight` DI-2 and `triage-daylight` B8 — *if a pair
misses AA the ink changes and the mock loses, not the reader* — the read row's phrase stays
`--text-2`. Read/unread is then carried by disc + weight + title ink, which is what the mock's own
comment says the three channels are.

`--text-3` survives where the shipped app already uses it and the fact beside it is stated in
`--text-2` or better: the mono age column (the shipped `IssueRow` inks its `date` column the same
way) and the empty state's mono kind line.

### D4 — The `All` / `Unread` lens is local state over already-synced rows

The mock draws a two-position toggle. It filters the rows the client already holds — no query, no
argument, no round trip. It is **not** a URL search param: `/inbox` takes no search params today,
the lens is a momentary reading posture rather than an addressable view, and adding a param would
put a route-schema change on a change that promised none. `Unread` over zero unread rows draws the
same empty state, worded the same way — the reader has nothing waiting either way.

The masthead count is the **unread** count in both lenses, because that is the number the deck's
badge carries and the two must agree. (Named cost: on Issues the same mono slot means TOTAL. The
mock's self-critique raises this; it is not resolved here, because changing what Issues' count means
is a change to Issues.)

### D5 — The cross-team tag comes from the already-synced team list, never from a join

The mock puts a mono team tag on a row whose team differs from the deck's. `notification` does have
a `team` relationship in the sync schema — but adding `.related('team')` to `notifications.mine`
would widen a self-scoped query for a cosmetic tag, and the app **already** syncs
`queries.teams.all()` in the frame (`useAnchorTeam` / `useTeamFrame`) and in the switcher. The tag
resolves `row.teamId` against that already-synced list.

Which rows get the tag: `/inbox` is workspace-wide and carries no route team, so "differs from the
deck's current team" is not well defined here. The rule built instead: **the tag is drawn only when
the reader belongs to more than one team**, and then on every row, because with several teams in
one list the team is the disambiguator. With one team it is noise on every row and is dropped. A
team the list cannot name (not in the synced list) draws no tag rather than an id.

### D6 — The day bands are the list's group header, and carry no count

`groupNotifications` is unchanged — same buckets, same order, same labels. What changes is the
drawing: the shipped sticky sub-heading becomes the `--density-group-header` band the issue list
uses (`bg-bg-hover`, `border-t border-row-hairline`). No count on the band: the page's only number
is the unread count, and a second number beside it would be the redundancy the diet removed.

### D7 — `Mark all read` is absent at zero unread, not disabled

The shipped control renders `disabled` when `unread === 0`. The mock's frame B drops it. This
follows the deck's own precedent (Decisions folded out of `more▾` rather than shipped dim): chrome
that promises what the product cannot deliver at that moment is worse than no chrome. The
`inbox-mark-all-read` test id is kept on the control when it renders.

### D8 — One live region, whose text changes

`triage-daylight` B13 settled this: a live region **inserted** with its message already inside it is
not reliably spoken, which is exactly the loading→empty transition the announcement exists for. So
the inbox carries one persistent `sr-only` `role="status"` outside the conditional, whose text
changes (`Loading notifications…` → `Nothing waiting` → `N notifications, M unread`), and the drawn
states carry no `role` of their own. The masthead count is suppressed while the result is
incomplete, for the same reason: a mono `0` over a loading list is band 2 contradicting the body.

### D9 — The route measures `full`

`/inbox` renders inside `AppFrame` at the default `max-w-3xl` reading measure, which is why the
shipped list looks like a column of cards. The inbox is a work surface; it takes `measure="full"`,
as Issues, Triage and the Board do.

### D10 — Nothing is added that would imply the stored title is live

No status glyph, no reality track, no "updated 2h ago", no link decoration that suggests the row is
reading the issue. The row's key and title are drawn in the same register as the list's so they are
*recognisable*, and the page says nothing about the subject's current state. Opening a row is the
only way to learn anything current, which is the honest arrangement.

## Capability inventory — what the shipped inbox can do today

Taken before any edit. Everything in this list survives unless the line says otherwise.

| # | Capability | Fate |
|---|---|---|
| 1 | `/inbox` route, workspace-wide, newest-first | kept |
| 2 | Today / Yesterday / Earlier grouping | kept (redrawn as bands, D6) |
| 3 | Masthead title + mono unread count | kept; the `BellIcon` beside it **removed** (mock; `issues.html` puts no glyph beside `Issues`) |
| 4 | `Mark all read`, incl. rows beyond the synced window | kept; **absent** rather than disabled at zero (D7) |
| 5 | Row: unread dot, `sr-only` Read/Unread, copy title, key, subject title, age | kept, re-ordered (D1) |
| 6 | `data-testid="notification-row"` + `data-read` | kept verbatim |
| 7 | `j` / `k` / Down / Up move the cursor | kept |
| 8 | `⏎` (row button) and `→` open the subject and mark it read | kept |
| 9 | `e` / `E` toggles read | kept |
| 10 | Cursor anchored to row identity, not index | kept verbatim |
| 11 | Open routes `issue` → team issues `?open=`, `pm_digest` → `/digests` | kept, still exhaustive over the subject union |
| 12 | Failed-write error line in the masthead `meta`, `role="alert"` | kept |
| 13 | Empty state + distinct loading state | kept, redrawn + announced through one region (D8) |
| 14 | `InboxBadge` in the deck, one shared subscription | untouched |
| 15 | Palette: `Go to inbox`, `Mark all notifications as read` | untouched |
| 16 | No comment/issue body excerpt anywhere | kept — and the phrase adds no content, only a verb |

Added by this change: the `All`/`Unread` lens, the four kind glyphs, the cross-team tag, the legend
footline.

## Risks

- **The e2e's two assertions on the row's words.** `notifications.spec.ts` asserts the row contains
  `<ADMIN> assigned you` and `<ADMIN> commented on`. The first survives the phrase change; the
  second becomes `<ADMIN> commented`. That is a selector update, not a weakened assertion — the
  claim (this row names this actor and this verb) is identical.
- **`notificationCopy` is shared with email.** Adding a field is additive; the risk is someone later
  using `phrase` in an email where `title` belongs. The copy module's comment states which is which.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no migration, no new named query, no new mutator.** The only schema-side edit is
  a third string on `notificationCopy`.
- **No `issue` relationship on `notification`, now or later.** It is a permission boundary.
- **Every shipped capability survives** — the inventory above is the record; every deliberate
  removal is named there with its reason.
- **Keyboard-first**: moving through the list, opening an item and marking read all work without a
  pointer, and the keys become visible in the legend.
- **Sub-100ms, offline**: everything renders from already-synced rows; the lens is a local filter.
- **Accessibility**: read/unread is not colour-only, the kind is never glyph-only, the empty state
  is announced honestly through one live region, and theme contrast holds in every theme block,
  light and dark.
- **`ROADMAP.md` is not edited** — parallel builds; the maintainer adds the row at archive time.
- **Shared code**: `packages/ui` components are **not** modified. `contrast.test.ts` is extended by
  appending a clearly delimited block at the END of the file (it has already produced one
  cross-branch conflict in this series). `apps/web/src/frame/*` is not modified.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
