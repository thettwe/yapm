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

### B1 — `phrase` shipped on `notificationCopy`; the email seam is provably untouched

`NotificationCopy` gained a third string. `title` and `summary` did not move, and the copy suite now
asserts the mailed pair verbatim for all four kinds — so "the email renders byte-identically" is a
test rather than a claim. The two consumers were grepped: `apps/server/src/jobs/notifications.ts`
(the delivery sweep) reads `copy.title` / `copy.summary`, and `packages/email` takes them as
`NotificationDigestItem`; neither knows the new field exists. Which string is for which reader is
stated on the interface, because the code cannot express it.

### B2 — The cross-team tag is drawn when the LIST spans teams, not when the READER does

D5 said "drawn only when the reader belongs to more than one team". Built literally that is wrong on
two counts. `queries.teams.all()` returns every non-archived team **in the workspace**, not the
reader's — `isMember(ctx) ? q : denyAll(q)` — so its length answers a different question; and
learning the reader's own memberships means `queries.members.all()` through `useMembership`, a
second query on a page whose whole promise was that it opens none beyond the inbox.

Chosen: the tag is drawn when the reader's own **rows** span more than one team, resolved against
the already-synced team list by id. That is a purely local derivation over data the page already
holds, and it is the rule that actually decides whether the tag disambiguates anything: with every
row from one team the tag is the same word on every line. Named cost: a reader who belongs to two
teams but whose inbox currently holds only Design's rows sees no tag, where D5 would have put
`Design` on every row. On a surface that carries no route team, that context was weak anyway.

A team the synced list cannot name draws no tag rather than an id (D5, kept). Asserted both ways.

### B3 — The tag draws the team's NAME, truncated, in `--text-2`

The mock draws `Design`, which is the team name rather than its key, so the build follows it —
capped at `max-w-[110px] truncate` because team names are free text and `Platform Infrastructure`
would otherwise push the phrase and the age off the row. The ink is `--text-2`, not the mock's
`--text-3`, for the reason B4 gives.

**The phrase is capped the same way, and that is a deviation from the mock.** `inbox.html` gives
`.phrase` a bare `flex:none`, which is right for a mock whose fixture actors are called `Marta`.
In the product the phrase interpolates an actor name that falls back to the signed-in user's full
email address, and unbounded it squeezes the stored issue title — the row's primary content and the
one thing a reader is scanning for — off the line. Built at `max-w-[200px] truncate`, so an
unbounded name truncates and the title keeps its column.

### B4 — Three inks moved off `--text-3`, and the token did not move

`DESTINATIONS.md` §"What the render showed" item 4 measures `--text-3` at **2.9:1** on `--bg` and
names `inbox.html`'s read rows as one of the two places the destinations lean on it hardest. Per
`issue-list-daylight` DI-2 and `triage-daylight` B8 — *if a pair misses AA the ink changes and the
mock loses, not the reader* — three of the mock's `--text-3` uses moved to `--text-2`:

- the **read row's phrase** (design D3, already decided);
- the **key column**, which the shipped `IssueRow` already inks `--text-2` — one row anatomy, one
  ink for the same column;
- the empty state's **mono kind line**, because nothing else on that surface states the four kinds,
  so it is the carrier rather than a restatement.

`--text-3` survives in exactly one place on this page: the mono age column, which is what the
shipped `IssueRow` inks its date column, and whose fact the day band above it already states
coarsely. `contrast.test.ts` records that asymmetry as two assertions with different bars, so it can
fail rather than being exempted in a comment.

### B5 — The kind glyph does not dim on a read row

The mock inks `.row.read .kind` at `--text-3`. Refused: the glyph is the only pre-verbal carrier of
the **kind**, the spec requires the kind be distinguishable before its words are read, and 2.9:1 is
under the 3:1 non-text bar. Read/unread already has its three channels (disc, weight, title ink) and
does not need a fourth that costs the kind its legibility. The glyph is `--text-2` on every row.

### B6 — The focused row's key does not step to the accent

The mock inks `.row.focused .id` with `--accent-strong`, which measures 3.84–4.38 on `--bg-selected`
in two presets — the exact pair `IssueRow` already refused, with the measurement held in
`contrast.test.ts`. The cursor is carried by the 3px accent rail and the tint, as it is on the issue
list.

### B7 — The empty state's `Issues` doorway resolves through the deck's anchor team

The mock draws `Issues ›` and `Home ›`. `/inbox` is workspace-wide and carries no route team, and
there is no workspace-level issues route. Chosen: `useAnchorTeam(undefined)` — the same read-only
resolution the deck already performs from the same synced query, so the doorway lands where the
deck's own Issues stop lands. With no team at all (a workspace with none), only `Home` is drawn
rather than a link to a 404.

### B8 — The live region follows the DRAWN list

`Loading…` → `Nothing waiting` → `N notifications, M unread`, in one persistent `sr-only`
`role="status"` outside the conditional (`triage-daylight` B13). The count in that sentence is the
**visible** list, so switching to the unread lens over nothing announces `Nothing waiting` — which
is what the surface then draws. The masthead count stays the **unread** total in both lenses,
because that is the number the deck's badge carries and the two may not disagree (D4).

### B9 — The lens needs no cursor reset, because the cursor was never a position

Every derivation — the groups, the flat index map, `move`, the key handler — reads the VISIBLE list.
The cursor is a row id; when the lens removes that row the anchor misses and the existing clamped
fallback lands on a drawn row. So "moving through a filtered list must not point at a row that is
not drawn" needed no new mechanism, only the discipline of filtering before deriving. Asserted: with
the cursor on a read row, switching to `Unread` leaves it on the one drawn row, and `e` then acts on
that row.

### B10 — The failure line moved to `--status-urgent-ink`

The shipped masthead `meta` inked a refused write with `--status-urgent`, the MARK hue, which misses
AA normal in every light preset. `triage-daylight` B14 settled this: a refused write is a sentence,
so it takes the ink. One-word change, already-pinned pair.

### B11 — `Mark all read` became an outline button

The mock draws a bordered control; the shipped one was `ghost`. `variant="outline"`, `size="sm"`,
`data-testid="inbox-mark-all-read"` verbatim — and it is **absent** at zero unread (D7), which is
the assertion that replaced `toBeDisabled()`.

### B12 — Four new test ids, and the two the e2e drives kept byte-identical

Added: `notification-title`, `notification-key`, `notification-phrase`, `notification-team`,
`inbox-empty`, `inbox-announcement`. Unchanged: `notification-row`, `data-read`, `inbox-badge`,
`inbox-mark-all-read`, `masthead-count`. The column ids exist because the falsifiable check has to
name the row's TITLE element specifically — asserting on the row's text content would pass against
the shipped full sentence.

### B13 — The e2e's one moved assertion

`notifications.spec.ts` asserted `${ADMIN.name} commented on`. The phrase interpolates no subject, so
it becomes `${ADMIN.name} commented`, and an assertion that the row draws `issueTitle` was **added**
beside it. The claim is identical and the test gained one; `${ADMIN.name} assigned you`, the
`data-read` / `notification-row` / `inbox-badge` contracts and the `confidential`-absent assertion
are untouched.

### B14 — Deliberate removals, all four named

The `BellIcon` (mock; `issues.html` puts no glyph beside `Issues`). The two-sentence empty-state
paragraph (the word diet; the four kind words carry it). `formatReviewAge` on this surface, replaced
by `formatRelative` from `@/issues/model` — one age measure across the set, `triage-daylight` B4's
rule. And the disabled state of `Mark all read`, which is now absence. **No shipped capability was
removed**: the inventory table above is unchanged in its `Fate` column, and the legend footline is
drawn only where the mock draws it — under a populated list, never over the empty state.

### B15 — One extra query, and it was already open

The page opens `queries.teams.all()` for the tag's names. The frame already subscribes to it
(`useAnchorTeam` / `useTeamFrame` / the switcher), so Zero serves the existing active query and the
page costs no new subscription. `notifications.mine` is untouched — no `.related('team')`, no
`.related('issue')`, no second read of the subject. A test asserts the surface opens exactly
`notifications.mine` and `teams.all` and nothing else, so a join arriving later fails there.

### B16 — What was NOT touched

`packages/ui` components, `apps/web/src/frame/*`, `inbox-badge.tsx`,
`packages/schema/src/zero/{schema.ts,queries.ts}` and `ROADMAP.md` are unmodified.
`packages/ui/src/styles/contrast.test.ts` gained a block **appended at the end** of the
`describe.each`, delimited by a banner comment naming this change, per the cross-branch-conflict
warning. `@/frame/masthead` and `@/frame/team-context` are imported, not edited.

### B17 — The cross-team tag names the team the DECK is not on (B2, corrected by looking)

B2 chose "draw the tag when the reader's own rows span more than one team". The render pass killed
it: with twelve rows from Engineering and two from Team A, `Engineering` was stamped on twelve
consecutive lines — the same word down the whole page, which is exactly the noise the tag exists to
avoid. Re-reading `inbox.html`'s closing comment, the mock states its own rule outright: the tag
"appears only where the team differs from the deck's current one, because the inbox is
workspace-wide and the deck is not." B2 never considered that rule because it was arguing about
`queries.members.all()`; the deck's anchor team was already on this page, resolved by
`useAnchorTeam` for the empty state's `Issues` doorway, so the mock's rule costs no query at all.

Built: `row.teamId !== anchor?.id` draws the tag; the anchor's own rows draw none. The no-anchor
fallback to B2's spans-teams rule was written and then **removed as unreachable**: `resolveAnchorTeam`
returns `teams[0] ?? null`, so the anchor is null only when the synced team list is empty — and that
is the same list the tag's names come from, so every lookup misses and no row can draw a tag whatever
the fallback decides. A team the synced list cannot name still draws no tag rather than an id, and
that one guard now covers the whole case. Three tests: the foreign row tags and the
anchor row does not, an unnameable team draws nothing and no id leaks, and a single-team list draws
none at all.

### B18 — Band 2 on the empty state is the title alone

The mock's frame B draws `Inbox` and nothing else — no mono count, no lens. The build had both, and
side by side the difference is the point: a `0` above the words `Nothing waiting` states the same
fact twice, and a two-position lens over zero rows is a control that cannot act, which D7 already
ruled absent rather than disabled for `Mark all read`.

Built: the count and the lens are drawn only when `loaded && rows.length > 0`. The test is `rows`,
never the lens's own filtered view — a reader who clears their last unread row while looking
through `Unread` must keep the control that gets them back to `All`, and a test asserts exactly
that sequence.

### B19 — The keyboard legend stays pinned to the foot of the surface

The mock draws the legend immediately under the last row. Kept at `mt-auto` instead, so it sits at
the bottom of the list surface at every length. With one notification the mock's placement would
leave 650px of nothing below a floating footline; pinned, it reads as the surface's own footer.
Screenshotted at one row, six rows and fifty to check.

### B20 — Differences from `inbox.html` that remain, all deliberate

Recorded after comparing the running page at 1440×900 against the mock rendered from the same HTML:

- **The cursor row draws a focus ring.** The mock draws only the left rail and the tinted ground.
  The ring is `focus-visible:ring-2 ring-accent ring-inset`, byte-identical to the shipped
  `IssueRow`; a mock has no keyboard focus to indicate and the product does.
- **The focused row's key stays `--text-2`** rather than stepping to the accent (B6).
- **Read rows' phrase, the key column and the empty state's kind line are `--text-2`**, not the
  mock's `--text-3` (B4).
- **Band 3 states no cycle facts.** `/inbox` is workspace-level, so the statusline reports only
  what is true off a team (frame design D3); the mock's frame draws a team day because it is drawn
  as one team's screen.
- **The tag draws `Team A`, not `Design`** — fixture, not a difference.

### B21 — What the render pass looked at

Six states at 1440×900 over a seeded account, each screenshotted and read: twelve rows across all
three day bands; the same list under the `Unread` lens; one row; fifty rows; a `pm_digest_published`
row alone (empty key column, no actor, no tag); and the empty state. Plus `focused` dark, `warm`
dark and `editorial` light over the populated list. Nothing read as a hole, a collapsed row or an
unfilled reserved slot; the 300-character stored title truncated on one line and left the phrase and
age columns in place. The masthead count and the deck badge were checked on the same screen after a
keyboard `e` — both 5.

### B22 — A second e2e spec asserted the old copy, and the sweep found it

`pm-digest.spec.ts` reads the reader's inbox to prove a digest notice names no publisher and carries
no content, and it asserted the row text contained `A cycle digest was shared with you`. That string
is now the MAILED form; the row draws `Shared with you` beside the team and cycle in their own
column. Updated to the phrase, with `team.name`, `cycleName`, the three secret-absence assertions
and the `not.toContain(ADMIN.name)` assertion kept byte-identical — nothing weakened, one string
moved. `mentions.spec.ts` needed no change: its `${ADMIN.name} mentioned you` is exactly the new
phrase. The lesson is the sweep itself: "the e2e that drives this page" was not the only e2e reading
this page's rows.

### B23 — The keyboard legend is read, not hidden

The footline was built `aria-hidden`, on the reasoning that every key it draws is already announced
by the row's `aria-keyshortcuts`. That reasoning was wrong by inspection: the row states `Enter e`,
and `j` / `k` — the two keys the legend leads with — are handled on the list container and stated
nowhere in the accessibility tree. Hiding the footline therefore left the movement keys visible to
sighted readers only, on a surface whose whole claim is keyboard-first.

Built: the wrapper is no longer hidden, so the footline reads as text; only the `·` dividers keep
`aria-hidden`, because they are punctuation rather than words. `aria-keyshortcuts` on the row is
left naming what the row itself binds.

### B24 — The age column is the shipped list's, including its width

Built at `w-[30px]` with no nowrap, which holds for `now` / `41m` / `6h` / `3d` and breaks at seven
days: `formatRelative` switches to a locale date (`Aug 9`) past that, and two words in a 30px box
stack into two lines, growing the row under every column beside it. Matched to `IssueRow`'s age
column instead — `w-[42px] … text-[10.5px] tabular-nums text-text-3` — plus `whitespace-nowrap`,
which `IssueRow` gets away with omitting only because its own dates sit under a wider cap. One row
anatomy, one age column. Asserted over a ten-day-old row.

### B25 — `kind-glyph.tsx` is tested for distinctness, not just for presence

Every kind assertion in the view suite reads the row's `sr-only` word, which comes from `KIND_LABEL`
and never touches the drawing — so a `MARK` map resolving two kinds, or all four, to the same path
would have passed the entire suite. `kind-glyph.test.tsx` renders all four, collects each `svg`'s
markup and asserts the set of drawings has four members, plus `aria-hidden` on every one including
the empty state's loop.

### B26 — `KIND_WORDS` is projected from the kind set

It was a hand-written `readonly string[]`. Its sibling `KIND_LABEL` is a `Record<NotificationKind,
string>`, so a fifth kind is a compile error there and was a silent omission from the empty state's
line here. Built as `NOTIFICATION_KINDS.map((kind) => KIND_WORD[kind])` over a keyed record, so both
fail the same way, with a length assertion in `model.test.ts` pinning the projection to the union
rather than to itself.

### B27 — The digest's two forms, split in the docs

`pm-digest.md` still told the reader the inbox row reads "A cycle digest was shared with you", which
this change made the MAILED form (B1, B22), and `notifications.md` then said both things in two
sections. Both re-worded to name which reader gets which: outside the app there is no row to carry
the subject, so the mailed notice states the whole sentence; in the inbox the title is the team and
the cycle, the key column is empty and the phrase is `Shared with you`.
