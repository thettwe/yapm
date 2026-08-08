# Sidebar variant "signals" — live instruments, not a tree of places

**Concept.** Every tracker's sidebar is a taxonomy; yapm's work graph lets the frame itself
carry state. Each nav entry is a live instrument, and computed exceptions sit above the nav —
Linear structurally cannot render that section because it has no git/board/check graph to
compute it from.

**Element inventory (live / static):**
- Workspace row + `⌘K` — static chrome, shrunk to one line (search field deleted; ⌘K is the search).
- NEEDS ATTENTION card (`⇧A`) — **live**, computed from the graph: done-in-git-not-on-board,
  review waits >1d, failing checks, new triage. Never hidden; when empty it renders one dim
  line ("Nothing needs you"). Plain language, no git jargon, no percentages.
- List `120` — **live** population count (mono, dim: population, not exception).
- Board — **live** 4-bar WIP silhouette of the columns.
- Cycles — **live** day-9-of-14 arc + `9/14`.
- Triage `4` / Retros `1 open` — **live**, brighten only when nonzero.
- Delivery — **live** this week's cadence as 3 shipped dots.
- Projects — **live** 2 on-track + 1 at-risk tinted dots (team-level only).
- Roadmap — **live** today-marker on a quarter line.
- YOURS: Inbox `3`, My Issues `6` — own work only; the per-person ban is about others.
- TEAMS: Design/Platform as collapsed marks with one health dot (amber = something needs
  that team) — **live**, replacing the static team tree.
- Footer avatar + Connected — live sync state, unchanged from base.

**Deleted from the Linear IA and why:** the search field (⌘K already owns search; a dead
input is taxonomy), the expanded per-team view tree (views belong to the active team's
frame; other teams collapse to one health mark), and the "Search" nav item (duplicate).
Calm is enforced typographically: all signals are 10.5px mono in `--text-3`, promoted to
`--text-2` only when nonzero, so at a glance the sidebar reads as a quiet column of words.
