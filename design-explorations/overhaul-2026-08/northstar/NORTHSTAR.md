# northstar/ — the canonical set

Five files. Assembly with discipline: seven settled rounds composed under the maintainer's
three final corrections (word diet, settled IA, provider marks). No new inventions.
Every future build change is judged against these.

## What was assembled from where

| File | Composition | Vocabulary & glyphs | Patterns folded in |
|---|---|---|---|
| `home.html` | horizon/home-hub hub layout on the deck frame | daylight dictionary, type A display scale | mornings-runway + handoff-queue lanes → READY FOR YOU (runway / crit / verify inline, "Runway →" opens the page); charts ship-cadence as the mini; Cycle report · + Wrapped · as artifact chips in the hero footer |
| `issues.html` | horizon/issue-list-deck frame (List \| Board \| Gallery masthead) | daylight rows/tracks, phrases at rest; glyphs working set (status arcs, priority ticks, track nodes, `//`) | provider marks as source suffix on check/deploy phrases only; selected ENG-116 row carries its phrase + broken track |
| `issue.html` | plays/bridge-detail two-register bifact grammar | daylight dictionary; triangle rail from plays/triangle-detail with the design node in the chain | mockkinds both card kinds (v3 upload — no brand mark; v2 Figma link — Figma mark), refs-applied Referenced-in block, decision chip, divergence callout with "The work moved, the ritual didn't." |
| `delivery.html` | plays/charts-applied journalism cut (annotated timeline, distribution strip, flow band, review rhythm) | daylight dictionary; the one binding rule line ("team-level only — never a per-person number") lives here, once | refs doors reduced to the dotted affordance; the single open peek (ENG-116 chip peek); honesty collapsed to one line + "more ·"; every derived number carries "how ·" only |
| `ia.html` | new sheet — the one page allowed to explain | — | three-band frame annotated; destination tree (bar / lenses / Home sections / artifacts / transients); more▾ menu drawn open with kbd hints; word-diet tiers in three lines; one-attention-number rule; peek + "how ·" drawn open once each; "our glyphs carry meaning · brand marks carry provenance" |

Tokens on every file: the Warm LIGHT block from `packages/ui/src/styles/globals.css`
verbatim, plus the three daylight extensions (row hairline `#efe9dd`, statusline bg
`#f4efe5`, `--urgent-soft rgba(204,90,64,.08)`; the build later shipped these to every
theme block plus a fourth, `--status-urgent-ink` — PR #31). Inline SVG throughout, no motion, no
iframes, flat + hairlines; elevation only on the drawn transients (delivery's peek, ia's
menu/peek/how).

## The word diet — rough before/after

Visible words (tags/styles stripped), measured against the union of the source artifacts
each page was assembled from. Facts lost: zero — derivations moved behind "how ·",
honesty behind "more ·", "opens:" lists behind door affordances.

| Page | Source material | After | Cut |
|---|---|---|---|
| home | ~740 (home-hub 230 + mornings-runway 273 + handoff-queue 240) | 327 | ~55% — what survives concentrates in the hero, Home's one document |
| issues | ~570 (issue-list-deck 184 + daylight issue-list 206 + glyphs-applied 182) | 196 | ~65% — zero sentences anywhere on the surface |
| issue | ~1,080 (bridge-detail 368 + triangle-detail 456 + refs-applied share ~260) | 517 | ~52% — bifact mono sublines kept, as the detail is where they live |
| delivery | ~570 (charts-applied 423 + refs doors/honesty share ~150) | 314 | ~45% — legends and derivation footnotes gone, one rule line kept |
| ia | — (new) | 710 | n/a — the sheet the others point to; explaining is its job |

## Consistency check (verified, not eyeballed)

- Global bar: `md5` of the normalized `<header class="gbar">` markup is identical across
  all five files modulo the active-tab class (`5635e13a1609`, re-verified after the
  destination-budget redraw; it was `571eee83506c` while Triage held a bar seat). The three
  digest candidates draw the same bar: `home-digest` and `home-digest-2` hash identically to the
  five, and `home-digest-2-quiet` differs by design and by design only — a quiet morning has no
  attention badge to draw and one unread rather than three.
- Statusline: byte-identical markup on all five — "Cycle 2, day 9 of 14 · 8 shipped ·
  3 deploys this week · **4 need attention** · Synced".
- One attention number: bar badge •4 = statusline 4 = Home's NEEDS ATTENTION 4 = ia's
  stated rule (the four exception classes: done-in-git-not-on-board, review waiting over
  a day, checks failing, new in triage).
- Chip anatomy and track vocabulary shared: same phrase dictionary strings, same node/line/
  `//` grammar on issues rows, the delivery peek, and the issue rail.
- Peek discipline: delivery has the only open peek among product pages; ia draws its one
  example inside the pattern section.
- PNGs re-rendered from final HTML (Playwright, 1440×900 viewport + full-page) after the
  last edit pass, so every screenshot matches its file.

### What the build kept, and the three places it had to diverge (PR #33, PR #38)

The frame shipped from these files: 48px deck, 32px statusline on `--statusline-bg`, the deck's
destinations with `more▾` as a transient, and the one attention number enforced by a single
`buildTeamFrame` derivation the Home digest consumes rather than recomputes. Four divergences,
each forced by a fact the mock did not have to hold:

- **The active stop's ink is `--text-1`, not the accent.** `--accent-strong` on `--bg` measures
  ~4.44:1 in editorial light — under AA for normal text — so the mock's accent-coloured tab label
  could not ship in every theme. The 2px accent underline and semibold weight carry the state
  instead, and `contrast.test.ts` holds the pair in all six blocks.
- **Decisions (`g d`) folded away and `g d` went to Delivery.** The mock draws Decisions in the
  open `more▾` menu; no entity backs it, and a disabled row is chrome promising what the product
  cannot keep. The free shortcut went to the destination that exists.
- **The in-progress amber is darker than the mock's (PR #38).** These files carry the shipped Warm
  LIGHT `--status-in-progress` verbatim, and that value fails WCAG 1.4.11: it measures **2.69**
  against `--bg` in warm light, **2.17** in focused light and **2.87** in editorial light, under the
  3:1 bar the hue must meet as non-text drawing — the in-progress half arc, the row's label dot, the
  digest's attention square, the flow band's added-block outline. The three light presets are
  retuned on the same OKLCH hue (h 71 / 79 / 75, held exactly, so the separation from
  `--status-done` and `--status-urgent` is unchanged) to **`#b67500` / `#b47e00` / `#b37900`**,
  measuring **3.55 / 3.54 / 3.62** against `--bg` and clearing 3:1 on every ground a row or a card
  is painted — the hovered row, the selected row's tint, a selected board card's soft-accent wash
  and the divergence row's urgent wash. The three darks already measured 8.80 / 9.03 / 9.49 and did
  not move. Text drawn in this hue takes a new `--status-in-progress-ink` at 4.5:1, the same split
  `--status-urgent-ink` already makes. **The mock is wrong here and the product is right**: a
  re-render of these files should adopt the retuned amber rather than the product adopting the
  mock's. Everything else PR #38 changed moved the product *toward* these files — quiet rows going
  truly blank as `issues.png` draws them, the check returning to the `done` disc, and band 3's
  healthy label reading `Synced` as all five files draw it.

- **The bar carries four destinations, not six stops, and Triage sits in `more▾` (PR #70).** These
  files are redrawn to match: the `Triage` `gb-tab` is gone from all eight, `ia.html`'s destination
  tree hangs Triage under the `more ▾` node, its headline counts destinations rather than bar seats,
  and its open menu draws `Triage · g t` above Retros. The product's argument, recorded in
  `openspec/changes/destination-budget/design.md` §D5: nothing fills the triage inbox in the
  ordinary course of work — no ingest, no connector, one palette row that forwards — so it is a
  place you visit, not a place you are shown. The demotion is reversible by a change that names what
  it displaces, and `g t` did not move with it. The published budget is **at most eight
  destinations, at most four on the bar, at most six menu items at any width**, derived from the
  narrowest supported width rather than chosen. Two consequences drawn here rather than argued
  again: the three digest onward footers now carry only `Board ›` and the `⌘K` hint, because a page
  that has shown its own work may not re-offer the deck's destinations beneath it and the board is
  the one surface with no seat of its own; and `ia.html`'s **Decisions** row stays drawn, in the open
  menu and in the destination tree, still a divergence rather than a deletion, for the same reason
  the first fold above is recorded rather than erased.
  Out of scope, deliberately: `design-explorations/overhaul-2026-08/destinations/`, `plays/` and
  `horizon/` draw this deck too — a repo-wide grep for `gb-nav` finds 38 HTML files — but
  `destinations/DESTINATIONS.md:9` calls those candidates rather than canonical, and only the
  canonical set is what shipped screens are judged against. They are left as they were drawn.

One thing the mock could not decide, and the build had to: `ia.html` assumes team context
("Acme / Engineering"), while yapm is one workspace of many teams and six routes are
workspace-level. The deck stays present off-team and its stops point at an anchor team, but band 3
says only what is true — see `openspec/changes/app-frame/design.md` §D3.

## Candidate: home-digest (2026-08-07, not yet canonical)

`home-digest.html/.png/-full.png` — Home as the logged-in user's digest. home.html is
untouched; this file is judged against it. Every addition is an already-judged pattern,
placed rather than invented:

| Addition | Source | What it carries |
|---|---|---|
| SINCE YESTERDAY 3 | new band, daylight phrase register | the overnight diff — releases gone live, a decision landed, your review came back; Inbox › doorway. Facts that expire once seen |
| YOURS 5 | mornings-runway graduates | repairs NAV-hub's stated loss ("My Issues → ⌘K only"): three held rows with why-phrases, the collapsed waiting-on-others row, the reciprocal no-reviews-owed fact, the mono derivation footnote ending "your work only — never compared" |
| DECIDED THIS CYCLE 3 | PLAY-decisions chip-row | sentence · area · key · date, no owner column; one revisit pill; Decisions › doorway |
| onward footer | horizon/home-hub (dropped in assembly) | Issues · Delivery in full · Retro · Roadmap · "⌘K goes anywhere" |
| Crit lane time | mornings' crit_at assumption | "2:00 today" as quiet act text — the one schedule fact on the page |

Disciplines kept: gbar and statusline byte-identical to the set; one attention number
(YOURS shows ENG-115 through a personal lens — an echo of the 4, never a fifth); hero
remains the only editorial voice; chrome = labels, surfaces = phrases. Word cost:
294 → 446 visible words (one counting method across both files) — the digest spends
~150 words to buy the personal half of the page.

Self-critiques:
- SINCE YESTERDAY only works if it truly expires — three stale rows every morning would
  teach the eye to skip the band, and the mock can't prove the expiry.
- YOURS and READY FOR YOU are one scroll apart and both speak in q-rows; a user who holds
  nothing sees two adjacent lists that differ only in header, and the empty-YOURS state
  (warmth phrase set) is undrawn.
- DECIDED THIS CYCLE sits below SHIPPED where the morning scan may never reach; if the
  record matters enough to digest, it may deserve SHIPPED's slot every cycle but week one.

### Round two: the composed morning (`home-digest-2`, + the quiet proof)

Round one added the right information in the wrong clothes — five identical row-lists.
`home-digest-2.html` keeps the band order and re-dresses each band in the strongest drawn
form the exploration already owns:

| Band | Form it now wears | Taken from |
|---|---|---|
| hero | a spread — editorial left, drawn vitals right (scope band 12/8/+3, NEXT rituals, days-left) | mornings' scope diff; the dead right column finally works |
| attention | each exception carries drawn evidence: the `//` broken track, waiting ages 31h·26h, the red check tick-bar, four triage dots; top row lifted on urgent-soft | glyphs/issues rows, charts' tick minis |
| since yesterday | three cards with mono kickers (OVERNIGHT / DECIDED / YOUR REVIEW) and provenance lines; header carries "you left Tue 6:40p" | mornings' card grammar |
| yours | issues-row anatomy: status arc + reality track + bifact (say/git), provider mark on the failing check | issues.html rows, handoff bifacts |
| ready for you | priority ticks on runway, brief thumbnails on crit, the verify track; crit lane carries crit_at | handoff-queue anatomy |
| cadence | drawn wider, annotated: the retro tick ("retro · smaller PRs") and a terracotta today caret | charts' annotated-timeline manner |
| shipped | two-column grid, half the height | — |
| decided | real decision chips (glyph · sentence · mono provenance · revisit pill) | decisions-thread chip |

Adaptive, and honest about it: the mono footline states the composition rules
("attention first · your lens engineer · crit unfolds as 2:00 nears · empty bands fold
away"), and `home-digest-2-quiet.html` (day 12, Friday) PROVES the folding — no attention
band or badge, the hero degraded to two quiet sentences (the standing home.html
self-critique demanded exactly this proof), one overnight card, YOURS as a single warmth
line with a Runway doorway, Crit/Verify gone, the footline naming everything that folded.
Band 1 and band 3 tell that day's truth, so the byte-identical checks apply per-moment,
not across the two states.

Self-critiques, round two:
- The hero vitals column and SINCE YESTERDAY's cards both sit right of/below the lede —
  the top third now has three competing textures (prose, blocks, cards); one may need to
  lose.
- Evidence minis on attention rows read beautifully at 4 rows, but they are unlabelled
  drawings — a new user's first morning has no ia.html in hand.
- The composed footline states rules the mock can't execute; if the real page ever
  composes differently than the line claims, the line becomes the lie on an honest page.
- The quiet file hand-picks a flattering quiet day (two runway starts, a retro to point
  at); the truly dead day — nothing anywhere, week one of an empty backlog — is still
  undrawn.

## Self-critiques, one per file

- `home.html` — the hero paragraph carries the whole editorial budget; a boring cycle must
  degrade it to two quiet sentences, and nothing here yet proves it won't fill with filler.
- `issues.html` — phrases at rest sit right of the title column and quiet rows stay truly
  blank, but at 1280px a long issue title and "Done in git, not on the board" will fight
  for the same breath.
- `issue.html` — even after the diet the rail out-talks the description; only real activity
  history can earn the left column back to equal weight.
- `delivery.html` — the open ENG-116 peek deliberately floats over the timeline's right
  shoulder (transient over surface), at the cost of hiding the Aug 8–11 quiet stretch while
  it's up.
- `ia.html` — 710 words explaining what four pages refuse to say is one revision away from
  documentation; the diagrams, not the sentences, have to stay the spine of this sheet.
