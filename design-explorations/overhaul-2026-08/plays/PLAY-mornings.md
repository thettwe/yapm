# PLAY — mornings: the same day, three queues

**The idea.** The triangle, sold as a daily ritual. One work graph already knows enough to hand
each role a true morning without anyone typing a status: the engineer gets **Your runway** (the
3 things actually unblocked — assignee-you, no blocker edge, linked change not waiting on review
or checks, not design-blocked — with "2 of yours are waiting on others" collapsed and the
reciprocal "no reviews owed" fact); the designer gets **In crit today** (2 artifacts with
inline-SVG wireframe thumbnails) plus **Built from your mocks — worth a look** (a merged change
traced back to her mock, with a MOCK/BUILT thumbnail pair and a Compare doorway); the PM gets
**The scope diff** (committed 12 / landed 8 / added mid-cycle 3, added blocks marked `+` on the
scope band and dated `+ day 6`) plus the "1 needs a call — done in git, not on the board"
doorway carrying the `//` mark. Every column ends in a mono footnote stating its derivation as
graph predicates — the transparency is the pitch. `mornings.html` is the three-column sell;
`mornings-runway.html` proves the engineer's queue works as a real page in the deck frame:
"Runway" masthead, 44px rows with why-it's-clear phrases and track minis, the waiting section
quiet below, an "Up next — if the runway empties" section derived from change-area overlap,
numbered-key and ⌘K hints, statusline.

**Assumes:** (1) a design-artifact entity (DES-nn, versioned, thumbnail, linked to issues) with
a `crit_at` schedule and open notes; (2) a recorded built-vs-mock compare event, so "worth a
look" can expire once done; (3) a blocker-edge and design-blocked flag on issues; (4) cycle
membership edges are timestamped, so "committed at planning" vs "added day 6" is queryable;
(5) review-request edges ("no reviews owed"); (6) per-user change areas from merged PR file
paths (already yapm-computed, #19) driving "Up next". Personal queues are your-own-work only;
nothing compares one person to another.

**Graduates:** the runway derivation (it's a ZQL query, not a feature), the collapsed
waiting-on-others row, the scope-band with `+`-marked added blocks, and mono derivation
footnotes as the standard way any generated queue explains itself. **Stays sketch:** the
three-up presentation layout (judging artifact only), the crit agenda (needs the design-artifact
schema to exist first), "Up next" ranking, and the MOCK/BUILT paired thumbnail — cute at 46px,
unproven at real sizes.

**Self-critique, one line each.**
- `mornings.html` — each role finds its own column fast and the derivations sell the graph, but
  the three cards land at three different heights and the air between footnotes and the closing
  line reads more "slide" than "surface".
- `mornings-runway.html` — the why-it's-clear phrases make the page feel like a plan rather than
  a filter, though "Runway" squatting on the Home tab dodges the real IA question, and the `//`
  mark on ENG-116 whispers a PM problem into an engineer's waiting list.
