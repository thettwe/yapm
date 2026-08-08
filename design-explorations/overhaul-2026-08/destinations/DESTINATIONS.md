# destinations/ — the seven un-designed surfaces

Seven files, drawn independently against `northstar/`, then reconciled into one set and
re-rendered. These are the destinations the canonical five never drew: the Board lens, the
intake queue, the cycle register, the retro room, Projects, the Roadmap and the Inbox.
No new frame, no new vocabulary — every page is the settled three-band frame with a new
band 2.

**These are candidates, not canonical.** `northstar/` is untouched by this work. Promoting
any of these into the canonical set is the maintainer's call, and §"What the render showed"
and §"Remaining drift" below are the list of things to settle before that call is made. The
one item on those lists that was called *blocking* — Projects and Roadmap describing two
different workspaces — was closed on 2026-08-09 and is recorded, decision and cost, at §1.

## What each file is, what it chose, what it folded

| File | What it is | What it chose | What it folded, and why |
|---|---|---|---|
| `board.html` | The **Board lens** on Issues — deck stop stays Issues, band 2 is `issues.html`'s masthead with the toggle flipped. One frame, 1440×900 exactly. | Six fixed status columns in category order; a card is the list row's facts in a different shape (glyph · priority mark · key · title · phrase · labels · the same reserved reality-track slot · assignee). The page's whole elevation budget goes to one card in flight over an open drop slot, with `space / esc / ← →` under it | Custom columns and swimlanes (no entity backs either); a Done column drawn at true height — 106 cards become 3 + `↓ 103 more`; per-card menus (the keyboard contract is the affordance) |
| `triage.html` | The **intake queue**, two frames: the queue, and the queue empty | The head of the queue expands in place — description, reporter, attachment, and `A` accept / `R` route / `D` decline — while rows 2–4 stay 44px slivers. One open ROUTE menu drawn as the page's single transient | Status-transition timelines (no triage event is recorded anywhere); SLA or queue-age targets; a bulk-select bar. The route menu lists a **Project** row that `issue.routeIssue` does not yet write — disclosed in the file as a one-field mutator gap, not a fiction |
| `cycles.html` | The **cycle page drawn as a register**, not a plan | Sixteen cycles as one dense list with per-cycle issue squares; a `CARRIED IN` band showing what crossed the boundary and how many times; `THE LAST REPORT` as an AI-drafted document with its cost and model named | Burndown and burn-up entirely — "a cycle keeps no status history, so nothing here burns down" is the footnote. Velocity forecasting. Per-person throughput |
| `retros.html` | The **retro room** at the vote phase, plus the retros index | A tabletop of three columns, terracotta dot-votes, the phase stepper in cycle day-band language, anonymity written on the surface. An `AI draft` band pinned below the live business, subordinate by placement: three proposals, private reactions, verdicts deferred to Discuss | Note rotation and dog-ears (`plays/warmth-retro` filed both as sketch); author columns (cards are anonymous by design); any AI verdict that lands without a human stamp |
| `projects.html` | **Projects**, drawn twice: the index and one project's page. Reached from `more▾` (`g p`), so the active stop is `more▾` | The index groups `roadmap.html`'s nine projects by status and carries a team-split column (`ENG 11 · DES 2`); the project page opens on two vitals — an issue reading and a target reading with a `6 days past` pill on a created→target strip | Blocked-by / blocks / duplicates (no dependency entity exists, so "blocked by Billing migration" cannot be drawn); design artifacts and thumbnails; a start date — only a target is stored; a `Cancelled` group header, because none of the nine is cancelled |
| `roadmap.html` | The **Roadmap** (`more▾ · g m`) — one axis, Jul 30 → Nov 30, one day = 8px | Refuses the Gantt bar outright, because a project has no start. What draws instead: a target diamond on the axis, a `Done` meter whose length is issue count, and each project's issues as dots in the cycle column they were placed in | The bar; dependency arrows; "moved to … at HH:MM" replans. `no cycles past Sep 23` is drawn as a fact about the axis, not hidden |
| `inbox.html` | The **Inbox**, two frames: the list and the empty state. Not one of the six stops, so **no** stop carries `.active` — the same call `retros.html` and `ia.html` make | `issues.html`'s row anatomy at 44px: gutter disc · kind glyph · key · title · spring · actor-and-verb phrase · age, bucketed Today / Yesterday / Earlier. Two rows exist to draw real code paths: the digest row with no key and no actor, and `Someone commented` (the `UNKNOWN_ACTOR` fallback) | The subject's live status and its reality track — a notification has no FK to its subject and "SHALL render from its own row alone", so an arc here would mean a join across the team boundary. Snapshot staleness (unmarkable without the live title). Group counts, which would put a second number on a page whose only number is 4 |

Word cost, one counting method across both directories (tags, comments and SVG text
stripped): roadmap 122 · inbox 213 · triage 230 · board 263 · projects 312 · cycles 370 ·
retros 398. (`projects.html` was 326 before the fixture reconciliation below; the rewrite is
14 words lighter, because three issue rows left frame B and the shorter project names cost
less than the extra index rows added.) For scale on the same counter: `issues.html` 196, `delivery.html` 212,
`home.html` 327, `ia.html` 710. Five of the seven land inside the canonical band; the two
that overrun are the two that ship a written document (cycles' last report, retros' cards).

## The frame, verified — across the seven and against the canonical set

Not eyeballed. Every `<header class="gbar">` and every `<div class="statusline">` in
`northstar/*.html` and `destinations/*.html` was extracted with comments stripped,
whitespace-normalised, the active-stop class removed, and md5'd. Verbatim output:

```
northstar/delivery.html            gbar=['571eee83']
                                     status=bc803904 len=303 :: Cycle 2, day 9 of 14 · 8 shipped · 3 deploys this week · 4 need attention Synced
northstar/home-digest-2-quiet.html gbar=['afb1d4d2']
                                     status=3fa77a5e len=236 :: Cycle 2, day 12 of 14 · 10 shipped · 4 deploys this week Synced
northstar/home-digest-2.html       gbar=['571eee83']   status=bc803904 len=303
northstar/home-digest.html         gbar=['571eee83']   status=bc803904 len=303
northstar/home.html                gbar=['571eee83']   status=bc803904 len=303
northstar/ia.html                  gbar=['571eee83']   status=bc803904 len=303
northstar/issue.html               gbar=['571eee83']   status=bc803904 len=303
northstar/issues.html              gbar=['571eee83']   status=bc803904 len=303
destinations/board.html            gbar=['571eee83']              status=bc803904 len=303
destinations/cycles.html           gbar=['571eee83']              status=bc803904 len=303
destinations/inbox.html            gbar=['571eee83', '571eee83']  status=bc803904 ×2
destinations/projects.html         gbar=['571eee83', '571eee83']  status=bc803904 ×2
destinations/retros.html           gbar=['571eee83', '571eee83']  status=bc803904 ×2
destinations/roadmap.html          gbar=['571eee83']              status=bc803904 len=303
destinations/triage.html           gbar=['571eee83', 'afb1d4d2']
                                     status=bc803904 len=303 :: Cycle 2, day 9 of 14 · 8 shipped · 3 deploys this week · 4 need attention Synced
                                     status=3fa77a5e len=236 :: Cycle 2, day 12 of 14 · 10 shipped · 4 deploys this week Synced
```

Eleven frames across the seven files. Ten decks hash to `571eee83` — the same value all five
canonical product pages hash to. The eleventh, `triage.html` frame B, hashes to `afb1d4d2`,
which is **exactly** `northstar/home-digest-2-quiet.html` — the canonical quiet-day deck,
cited rather than invented, because that frame draws Cycle 2 day 12 and the day-9 deck would
have printed `4 need attention` over an empty queue. Statuslines: ten at `bc803904` (303
normalised characters, byte-identical to the canonical five), one at `3fa77a5e` (236
characters), which is the canonical quiet-day statusline, again matched exactly. Sync word is
`Synced` in all eleven. (The reconciliation pass recorded in the files quotes `eb551c33` for
the statusline; that is the same set of bytes under a different normaliser — the conclusion
is identical, the digest is not.)

Rendered geometry agrees with the markup: measured in Chromium at 1440×900, **every** deck is
48px tall and **every** statusline is 32px, in all seven files, and no element on any page has
a bounding box crossing x=0 or x=1440.

Two more mechanical checks, run fresh against the shipped source rather than against the
mocks' own claims:

- **Amber.** `--status-in-progress: #b67500` in all seven destinations; `#ce8a26` in all eight
  northstar files. `#b67500` is `packages/ui/src/styles/globals.css:137`. All seven also carry
  `--status-in-progress-ink`, `--status-urgent-ink` and `--elevation-transient`.
- **Glyphs.** Thirteen `done` checks across the set, all `d="M6.3 10.3 8.9 12.9 13.7 7.3"` at
  stroke 1.6 — the shipped `DONE_CHECK` / `STROKE` constants in
  `packages/ui/src/components/status-glyph.tsx:19,31`. Four `canceled` crosses, all
  `M6.9 6.9 13.1 13.1M13.1 6.9 6.9 13.1`.

**One attention number** holds: `4` in the deck badge and `4` in the statusline on ten of the
eleven frames, and nowhere else on any page. The eleventh is the quiet frame, which carries
neither.

### How the PNGs were made

Playwright + Chromium, one context at `1440×900`, `deviceScaleFactor: 1` (matching the
canonical set's `1440×900` / `1440×N` PNGs), `<name>.png` at the viewport and `<name>-full.png`
full-page, taken after `document.fonts.ready` resolves and `document.fonts.check('16px Figtree')`
returns true. `file:` is blocked in this environment, so the directory was served over
`127.0.0.1` and loaded via http. Full-page heights: board 900, roadmap 900 (both single frames
that fill the viewport exactly, like `issues.png` in the canonical set), triage 1094, inbox
1160, retros 1258, cycles 1339, projects 1610.

`projects.png` / `projects-full.png` and `roadmap.png` / `roadmap-full.png` were re-rendered
the same way on 2026-08-09 after the fixture reconciliation. `projects` fell from 1645 to 1610
(frame A gained three rows, frame B lost three); `roadmap` is unchanged at 900, because nothing
drawn on that page moved.

## What the render showed

Everything drew. No clipped text, no collapsed layout, no chart without data, no column
overflowing 1440, no band at the wrong height. One finding was closed by editing the HTML
(§1, below); the rest read wrong on inspection and are left for the maintainer, because each
is a product decision rather than a rendering defect.

1. **Projects and Roadmap described two different workspaces — CLOSED 2026-08-09.**
   `projects.html` said `Projects 6` and named *Checkout revamp, Address & shipping, Warmer
   empty states, Search rewrite, Billing v2, Legacy CSV import*; `roadmap.html` said
   `Roadmap 9` and named *Checkout rebuild, Onboarding revamp, Payments v2, Mobile web polish,
   Search relevance, Notifications overhaul, Billing migration, Design system upgrade, Data
   retention*. Same workspace, same instant (`Cycle 2, day 9`), both workspace-scoped, **zero
   shared names**, 6 ≠ 9. The issue vocabulary was by contrast already tightly reconciled
   (ENG-116 is *Apple Pay in the payment sheet* on board, inbox and projects; ENG-113 is
   *Refund flow for partial orders* on board, cycles, inbox and projects), which is what made
   the project vocabulary stand out as unreconciled rather than intentionally distinct.

   **Decided: `roadmap.html`'s nine are canonical, and `projects.html` was rewritten onto
   them.** The roadmap's fixture is the richer one and three of its four best drawings depend
   on it — the two-row `No target date` group, the `Nothing scheduled` / `No issues yet` empty
   states, and the lone Nov 28 mark alone in the ungridded tail. Cutting it to six would have
   destroyed all three; growing it would have meant inventing projects. Growing the index cost
   only rows.

   | Project | Status | Lead | Target | Done |
   |---|---|---|---|---|
   | Checkout rebuild | active | DA | Aug 1 — past | 11/13 |
   | Payments v2 | active | DA | Aug 12 | 8/14 |
   | Mobile web polish | active | JK | Aug 26 | 3/9 |
   | Design system upgrade | active | DA | — | 2/7 |
   | Search relevance | planned | — | Sep 9 | 0/6 |
   | Notifications overhaul | planned | MR | Oct 15 | no issues yet |
   | Billing migration | planned | JK | Nov 28 | 0/4 |
   | Data retention | planned | — | — | 0/3 |
   | Onboarding revamp | completed | MR | Aug 5 | 12/12 |

   Every column above was copied off `roadmap.html` row by row, not approximated. **Not one
   mark on `roadmap.html` changed** — only its closing comment, which now records the decision.
   `projects.html` changed: masthead `6` → `9`; the index rebuilt as Active 4 · Planned 4 ·
   Completed 1, sorted by target inside each group with undated projects last; frame B moved
   from *Checkout revamp* to *Checkout rebuild*, lead `MR Maya Ruiz` → `DA Dana Asare` (the
   name already used in `triage.html`), `14` issues → `13`, `9/14 done` → `11/13`, the state
   bar re-cut to 11 / 1 / 1.

   Three consequences worth stating plainly, because each is a real cost:
   - **The `Cancelled` group is gone.** None of the nine is cancelled, and a group header over
     zero rows would assert a project this workspace does not have. Note that this does **not**
     touch §5 below: neither spelling was corrected into the other, one entity's rows simply
     stopped existing. `board.html` and `triage.html` still carry `Canceled` for issues.
   - **Frame B lost three issue rows.** At 11/13 the project has exactly two unfinished issues,
     so the list is ENG-116 (in progress) and DES-44 (todo) under `↓ 11 done`. ENG-113, ENG-119
     and ENG-121 were dropped from the page rather than renamed, because `board.html` draws all
     three as *not* done and they cannot belong to a project with two open issues. Their titles
     are unchanged everywhere they still appear. The page that argues a project deserves a URL
     of its own now proves it with a nearly-finished project — named in that file's self-critique.
   - **The team splits are `projects.html`'s own.** `ENG n · DES n` comes from `issue.team_id`,
     a real column the roadmap never reads, so the roadmap could not supply them. They were
     chosen to sum to each project's issue total, so the two pages cannot disagree on a count.

   One off-by-one was closed with it. The delta pill read `7 days past` against a `today Aug 8`;
   the roadmap's axis (one day = 8px, `x = 10 + 8 × days since Jul 30`) puts today at `x=74`,
   which is **Aug 7** — day 9 of a cycle starting Jul 30, exactly what band 3 says — and the
   roadmap's own footnote already said "6 days late". `projects.html` was corrected to the
   roadmap's arithmetic: `6 days past`, today Aug 7, strip redrawn on the same 8px/day scale.
2. **The deck renders at three different widths.** Band 1's *markup* is identical everywhere,
   but the sheets that hold it are not: board / cycles / retros / roadmap run the frame
   full-bleed at 1440, inbox insets it to 1386, projects and triage to 1278. So the same deck
   is drawn 162px narrower on two files, changing the gap between the stops and the right
   cluster. The canonical set has the same looseness (1440 and 1200 both appear), so this is
   inherited, but within one directory it is visible when the PNGs are flipped through.
3. **Transients cover the surfaces they were opened from — three times.** `projects.html`'s
   `more▾` menu sits over the Active group header (measured 2026-08-09: menu `y=124–228`,
   header `y=214–249`, so 14px of the header is covered and the menu stops 21px short of the
   first project row — an earlier draft of this note claimed it covered that row too, and it
   does not); `triage.html`'s ROUTE menu eats the label, age and reporter columns of rows 2–4; and
   `board.html`'s card in flight fully covers ENG-119 and half of ENG-112. All three are drawn
   deliberately (elevation over surface, the pattern `delivery.html` established with its one
   open peek) and all three are named in their own files' self-critiques. In the render they
   read as one repeated tic across the set rather than three local choices — a fourth of the
   seven pages would have made it a house style by accident.
4. **The contrast floor is inherited, not introduced.** `--text-3` is `#9a9186` on `--bg`
   `#faf7f2` = **2.9:1**, under the 4.5:1 AA bar for normal text, and it is the ink under every
   mono kicker, every `how ·` and `more ·` door, every timestamp and every annotation. Measured
   as a share of leaf text nodes below AA: destinations 18% (board) – 56% (inbox); northstar
   30% (delivery) – 61% (issue). The destinations are inside the canonical band, so nothing here
   made it worse — but the two smallest instances are worth naming, because the destinations
   lean on them harder than the canonical five do: `inbox.html`'s read rows at 11px and
   `triage.html`'s 10px keycap labels. `--text-3` is a shipped token; retuning it is a product
   change, not a mock change.
5. **Two spellings of cancelled, both correct.** `board.html` and `triage.html` write
   `Canceled` (issue status). `projects.html` used to write `Cancelled` (project status) and
   no longer draws either word — its Cancelled group went with the old fixture (§1), not with
   any spelling decision. That split is not drift, it is the schema:
   `status in ('backlog', …, 'canceled')` in `migrations/0004_issue_core.ts` and
   `status in ('planned', …, 'cancelled')` in `migrations/0008_projects.ts`. The mocks are
   right and the *schema* is the thing worth fixing. Note that the set now demonstrates only
   the issue spelling; whoever implements Projects should read the migration, not the mocks.

## Remaining drift, carried forward from the reconciliation pass

Four items were already known and written into the files; the render confirms all four and
added two more above — §1, now closed by the fixture reconciliation, and §2, which stands.

- **`inbox.html` frame B reads `Inbox 3` over a surface that says "Nothing waiting".** Band 1
  is chrome held constant and no canonical deck exists for an empty inbox, so the contradiction
  is structural. Named in the file rather than hidden behind a blank count.
- **Two urgent inks on one page.** Band 3 inks `.attn` with `--status-urgent` (forced: band 3
  must stay byte-identical to northstar) while work surfaces ink urgent *text* with
  `--status-urgent-ink` (forced: that is what the shipped app does). Consistent across all
  seven now, but it is a standing debt against whoever reconciles the canonical set with the
  build.
- **The canonical set is now behind the destinations on amber.** `northstar/*.html` still
  carries `#ce8a26`; all seven destinations carry the shipped `#b67500`. `northstar/` was not
  touched, per instruction. Anyone regenerating the canonical set should retune it, or the two
  directories will read as two palettes — and `NORTHSTAR.md` itself already says which way that
  should go: *"The mock is wrong here and the product is right."*
- **Two inherited faults copied rather than laundered.** `board.html` keeps ENG-121 in Todo with
  a complete four-node reality track and no phrase — by the product's own divergence rules that
  shape should fire `status_behind_merge` — inherited from `northstar/issues.html`. And
  `retros.html` draws Cycle 1's retro live in vote on day 9 of Cycle 2, while `delivery.html`
  annotates Jul 30 with "Retro agreed: smaller PRs", implying it already closed. Both cannot be
  true; `retros.html` flags it for the maintainer.
- **`cycles.html`'s mono cycle keys `C10`–`C16`** sit beside the free-text name `Cycle 2`. It is
  that file's reconciliation of a loose spot in the canonical set (`delivery.html` says "last 6
  completed cycles" while band 3 says "Cycle 2"), and `cycle.name` is free text so nothing
  contradicts the schema — but it is a second numbering no other file uses.

## Self-critiques, one per file

Carried over from each drawing agent, sharpened by the render.

- **`board.html`** — The weakest thing here is the card in flight. It is doing three jobs at
  once — proving the board is keyboard-operable, showing what a drag looks like, and spending
  the page's whole elevation budget — and it does none of them the way the real interaction
  does; frozen, it reads as a modal that has crashed into two columns, and the accent-soft
  rectangle in In Review can be taken for a new-card affordance rather than a landing site. A
  drawing that needs a legend has lost an argument, and the `space / esc / ← →` footer is a
  tooltip wearing a card's clothes. The render confirms both smaller faults: the columns are
  genuinely tight (*"Address autocomplete on shipping step"* wraps to two lines inside the
  216px measure, and the phrase, labels and 86px track then share one row — this starts
  colliding around 1200, and unlike the list a board cannot drop a column), and the Done column
  is 106 cards represented by three and a fold line, which lets the layout look calmer than it
  will ever be in use. The render adds a third: the drag card also covers ENG-119 entirely, so
  the one frame that proves the board is operable is the one frame where you cannot read the
  column you are dragging out of.
- **`triage.html`** — The design only serves the head of the queue. Rows two through four are
  the same 44px sliver they were on the bare list, so this is fast for exactly one decision and
  no faster than before for the other three — and if the first item is the hard one, the drawing
  has optimised the case a person most wants to skip. The open ROUTE menu eats the label, age and
  reporter columns of those three rows, confirmed in the render, so at the moment you commit
  ENG-125 to Cycle 2 you cannot see what you are deferring it ahead of; a queue whose whole
  purpose is comparison should probably never occlude its own right-hand columns. The
  reserved-but-blank reality slot spends 214px of every row holding space for a fact triage rows
  structurally never have — correct for cross-surface alignment, and in the PNG indistinguishable
  from a layout bug. And the empty state is honest to the point of thin: two words, three
  doorways, nothing that could say the clearing was *yours* or *recent*, because no triage event
  is recorded anywhere.
- **`cycles.html`** — The carry chain is the reason this page exists and it is the weakest
  drawing on it. In the render, the three rows are exactly what was feared: three near-identical
  rows of dots distinguished only by how far left they start, asking the reader to learn a
  private notation (hollow = a hop we cannot name, solid = Cycle 1, accent = now, dotted = before
  the record) from a single `Cycle 1 / now` annotation on the top row, with `carried 3×` doing all
  the work the graphic was supposed to do. The honest answer may be one mono column and no
  graphic. Behind it: the register's degradation from `8/10` to `10 landed` is exactly right and
  completely invisible — it looks like inconsistent formatting until someone explains the
  rollover — and the page ends on a 130-word AI-written document that will, on a boring cycle, be
  the longest and least interesting thing on the screen, with nothing here proving it degrades.
  At 1339px the report is also below the fold on every laptop, which softens the second fault and
  worsens the first.
- **`retros.html`** — The weakest thing here is the AI draft band, and the vote phase makes it
  hard to hide: three proposals at 40px each occupy nearly a board column's height while carrying
  nothing the room can act on yet — no verdict, no action path, only a private tick nobody else
  can see — and it sits below a page whose live business is above it, so during vote nobody looks
  at it at all. A fifth of the surface spent proving the AI is subordinate rather than making it
  useful. The render confirms the tabletop's ~100px of open felt below the shortest column (the
  exact fault `plays/warmth-retro` filed against itself, inherited rather than fixed) and shows
  the group box making the middle column the tall one, so three columns will run ragged the
  moment a second group forms. The index frame is still one row — the honest row, but a list
  surface judged on one row is barely judged, and it is the frame a user meets *first* out of the
  `more▾` menu.
- **`projects.html`** — The weakest thing is that `Past target — 2 open` borrows the urgent
  register without joining the attention count. Everywhere else in this set terracotta text on a
  row means the row is one of the 4; on the index it means a date passed. A reader trained by
  four other surfaces will scan for a fifth item in the badge and not find one. Worse, the fact
  is softer than its ink: `target_date` is a field somebody typed once, the schema keeps no record
  of whether it was re-agreed, so an abandoned project cries wolf in terracotta forever while a
  re-planned one goes quiet the instant the date is edited. Two smaller faults, both visible in
  the PNG: the vitals band says `11/13` twice, once as a number and once as a bar — the redundancy
  `delivery.html` spent a whole diet removing — and the open `more▾` menu hangs over the Active
  group header, so the one frame that has to argue "this destination is workspace-scoped" opens
  with its own doorway on top of the first thing it wants to say. The reconciliation in §1 adds a
  third: at 11/13, frame B's issue list is two rows under `↓ 11 done`, so the page whose whole
  argument was that a project deserves a URL of its own now makes that argument with almost
  nothing in the list. The two vitals carry it. Drawing a busier project instead would have cost
  the overdue reading, which is the one thing on that page the index cannot give you.
- **`roadmap.html`** — The weakest thing is the row of dots in the cycle columns. They are the
  most valuable drawing on the page — the only reason the axis has any density once the bar is
  refused — and the least defensible: they carry roughly a Gantt bar's visual weight while meaning
  something quite different, their grammar is stated nowhere but a footnote nobody will open, and
  an eye trained on roadmaps reads a cluster in Cycle 2 and a cluster in Cycle 3 as a span between
  them. In the render that misreading is easy to perform. Worse, they punish honesty: *Search
  relevance* has six real issues and draws an empty row, so an unscheduled project looks dead. The
  `Done` meter has its own fault — its *length* encodes issue count, so a 14-issue project's meter
  is twice a 7-issue project's and the two rows cannot be compared at a glance. And the page pays
  half its width for the ungridded Oct–Nov stretch, where in the PNG a single Nov 28 mark sits
  alone in 500px of empty territory — exactly the point being made, and an expensive way to make
  it.
- **`inbox.html`** — The row is a borrowed suit that does not quite fit. `issues.html`'s anatomy
  assumes the phrase column is a *derived, changing* fact about the work, and the reader learns to
  scan it for trouble; here the same column holds `Marta commented`, which is neither derived nor
  a state and never varies beyond four verbs and a handful of names. Meanwhile the thing that
  actually varies — read versus unread — is parked in an 8px gutter at the far left, the coldest
  pixel on the row. The render makes this concrete: at a glance the eight rows differ mainly by
  font weight, and the read rows' 11px `--text-3` measures 2.9:1, so the weakest of the three
  redundancy channels is also the one carrying the most load. Second fault: the masthead count
  means UNREAD here and TOTAL on Issues, and nothing on either page says so. Third: frame B draws
  the flattering emptiness — a reader who has cleared their list — not the cold one, a brand-new
  account on day one where "Nothing waiting" is technically true and completely uninformative;
  that state deserved the second frame more than this one did, and in the render its 320px of
  centred felt is what a day-one user would actually be handed.
