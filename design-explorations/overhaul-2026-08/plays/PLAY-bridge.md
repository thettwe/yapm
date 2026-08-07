# PLAY — bridge: designing the product↔engineering seam

**The idea.** Formalize daylight's "plain words first, git one level down" into a component: the
**bifact** — one fact, two registers, always paired, never toggled. The plain sentence (Figtree,
`--text-1`) is what a PM reads; the mono line directly beneath (11px, `--text-3`) is what an
engineer trusts: "Built — not live yet" / `merged 8f21c4a · 14 checks green · no prod deploy since`.
`bridge-detail.html` applies it to every surface of ENG-116 — masthead, activity feed, comments
header ("Quiet here — the conversation moved to the change" / `0 comments · 11 on PR #188`),
delivery rail, divergence callout, properties. `bridge-wrapped.html` is the community invention:
**Cycle Wrapped**, the sheet yapm composes when a cycle closes — masthead, day-band, "We shipped 8.",
the cadence sentence, the retro's two "we'll try" agreements, and a colophon that makes
blamelessness a visible feature: "Team-level by design — no individual numbers, ever." Zero names,
"we" throughout, `made with yapm //` mark.

**Why it's yapm's own.** No tracker treats the git substrate as a *second language* rather than a
second screen; and only a tool whose vow is team-level-forever can ship a share artifact whose
selling point is what it refuses to show.

**Graduate:** the bifact as a real component (say/git slots, fixed 13.5/11px scale) and the wrapped
colophon vow. **Stay a sketch:** the wrapped sheet's exact composition (needs real render-to-image
plumbing), the activity feed's invented events, and mono sublines on properties — likely too chatty
at 6-hours-a-day exposure; the rail and callout earn them, Status/Priority may not.
