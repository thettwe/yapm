# horizon/deck — full visible navigation in the global bar

**The model.** Three horizontal bands. Band 1 is a 48px global bar that never changes
between pages: workspace/team ("Acme / Engineering", a quiet menu), then the five primary
destinations inline as text tabs — **Home · Issues · Triage · Cycles · Delivery · more▾** —
then ⌘K, the attention badge (urgent dot + count, the needs-attention doorway), Inbox (3),
user chip. Band 2 is the page-owned masthead: on Issues it's "Issues 120" + a List|Board
toggle + the filter row; on Delivery it's the 48px display title + window selector; on Home
it's the cycle hero itself. Band 3 is the daylight statusline, untouched.

**The five, and why.** Home (the landing surface), Issues (the work), Triage (daily — it
carries "new" pressure), Cycles (the ritual), Delivery (the evidence). **Board is not a
top-level tab**: it's the same 120 issues in another projection, so it lives as a masthead
toggle inside Issues — sub-views change the masthead, never the bar. more▾ holds Retros,
Projects, Roadmap (weekly-or-less destinations).

**What died with the rail, and where it went.** The TEAMS tree → the workspace/team menu at
far left. Inbox/My Issues/Search → the bar's right cluster (My Issues rides the user chip
menu). The rich cycle state the spine sidebar carried → the Team Home hero, where it has
room to be data instead of chrome. The signals card → Home's NEEDS ATTENTION section, with
the bar badge as its always-visible echo. The 244px of chrome → the list itself: reality
tracks grew 132→188px and titles breathe.

**The bet & the managed risk.** Every destination is one click from everywhere, no
hub-dependence. Crowding is held off typographically: 13px --text-2 tabs, no pills, active
is terracotta with a 2px underline; six items plus the workspace menu still leave clear
air before the right cluster at 1440.
