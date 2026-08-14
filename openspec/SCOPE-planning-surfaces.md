# SCOPE — planning surfaces: schedule, dependencies, lanes, utilization

Scoped 2026-08-10 from a maintainer interview. **Nothing here is built or proposed yet.** This is
the mission input for the next build wave, in the shape `SCOPE-v1-gaps.md` and
`SCOPE-ai-features.md` took for theirs.

Release 1.0.0 is **deliberately held** until this family ships — the maintainer's call, made after
every registered task was finished (PRs #52–#55). release-please keeps PR #30 open and current.

## What the maintainer chose

Four questions, answered twice (the second time after a model change, with identical results — so
these are settled, not first impressions).

**1. Which questions should "resource utilization" answer?** Three of four:

- **Can the team take this on?** — team-level capacity: committed vs landed across recent cycles as
  a planning aid.
- **Where does work actually go?** — flow analytics: time-in-status, where issues stall, carryover
  patterns.
- **Who is loaded with what?** — per-person open work.
- *Not chosen:* operator-facing instance health (container CPU/memory/disk, sync lag, DB growth).
  Worth remembering as an unclaimed idea with no vision tension at all.

**2. Which Gantt facts to add?** All four: project start dates → duration bars; issue↔issue
**dependencies** (blocks / blocked-by); issue-level start/due dates; milestones.

**3. Swimlanes, where and cut by what?** All four: board lanes by project, by priority, by
assignee; and timeline swimlanes by team/project.

**4. Process?** **Straight to proposals** — OpenSpec proposals with ASCII sketches in design.md,
maintainer reviews the specs, build follows. Mocks-first was offered and declined.

## The constraint question, and why most of this does not need a VISION amendment

Two selections look like they reverse shipped guarantees. Read precisely, most of the scope does
not.

What the documents actually say:

- `VISION.md:47` — "Team-level only. No individual **leaderboards**, no **stack ranking**."
- `VISION.md:58` — "If a feature's main use is **ranking** individual developers, it doesn't ship."
- `openspec/specs/cycles/spec.md:301` — the **Cycles view** carries "no per-person dimension of any
  kind: no load, no throughput, no capacity."
- `archive/2026-08-09-board-daylight` — recorded "no swimlane, no per-person lane" as refused.
- The CI-enforced blamelessness walker (`packages/schema/src/zero/ai-content.ts` and its tests)
  guards **AI-generated content** — retro drafts, digests — not views in general.

And yapm **already** shows per-person current work: an assignee avatar on every row and card, an
assignee filter on the list and the board. So the line that matters:

| | verdict |
|---|---|
| Who holds what open work **right now** | already shipped in another shape; a lane or a panel is a re-cut, not a new capability |
| Comparative aggregates **over time** — per-person throughput, velocity, closed-count, ranking | what VISION forbids, and what earns this category its hatred |

**The working decision:** "who is loaded with what" and assignee lanes are scoped as
**current-state work organization** — no time series, no cross-person comparison, no ranking, no
sort-by-count-descending (which is a leaderboard wearing a lane's clothes). On those terms **no
VISION amendment is needed**. Two things still must happen explicitly:

1. The `cycles/spec.md:301` and board-daylight refusals get **revisited in writing** — a recorded
   position may be changed, never quietly contradicted.
2. If the maintainer actually wants per-person numbers **over time**, that is a real VISION
   amendment and must be stated outright rather than inferred. **It has not been stated.**

## The proposed change sequence

Nine changes in four tracks. Dependencies are what force the order; tracks are independent of each
other and can interleave.

### Track A — schedule facts (the Gantt foundation)

| # | change | what it adds | needs |
|---|---|---|---|
| A1 | `project-schedule` | `project.start_date` + a `milestone` entity; the shipped Roadmap's dots become **bars with length**, milestones drawn as markers. Extends `projects/spec.md:133`'s "timeline from the design system, no Gantt dependency" rather than replacing it | — |
| A2 | `issue-dates` | optional `issue.start_date` / `due_date`; the surfaces that must gain date affordances (detail, list, palette, filters) and **what is refused alongside them** — overdue shaming, per-person due-date counts | — |
| A3 | `issue-dependencies` | the `issue_link` table is **issue→pull_request only** today; this adds the issue↔issue edge (blocks / blocked-by), cycle detection, and **`blocked` as a first-class fact** the row, board, digest and Home can all state. The single biggest prize here, and independently valuable without any Gantt | — |

### Track B — the timeline surface

| # | change | what it adds | needs |
|---|---|---|---|
| B1 | `timeline-lanes` | the Gantt/timeline view proper: bars, milestones, dependency arrows, **swimlanes by team/project**. Still no Gantt library — the design system, as `archive/2026-07-26-projects-roadmap` established | A1, A2, A3 |

### Track C — board lanes

| # | change | what it adds | needs |
|---|---|---|---|
| C1 | `board-swimlanes` | horizontal lanes crossing the six status columns, cut by **project · priority · assignee**. Must re-solve board-daylight's promise: *six fluid columns readable at 1440, no horizontal scroll* — now with lanes stacked. Carries the written reversal of "no per-person lane" | — (C1 is independent; assignee lanes reuse facts already synced) |

### Track D — utilization

| # | change | what it adds | needs |
|---|---|---|---|
| D1 | `status-history` | **the table that was deliberately never built.** `cycles/spec.md` states the reason plainly: no status-history table exists, `last_human_status_at` is a single scalar, so "any line falling over time here would be an invention." This change makes the series a real fact — and every refusal that rested on its absence (burndown, velocity, capacity, forecast) must be **re-argued on its merits**, not silently unlocked | — |
| D2 | `flow-analytics` | time-in-status, where work stalls, carryover patterns over cycles. Team-level | D1 |
| D3 | `team-capacity` | committed vs landed across recent cycles as a planning aid. **Estimates are a standing v1 deferral** (`ROADMAP.md:12`, `:100`), so this either revives estimates or uses an issue-count heuristic **that says on the page it is one** | D1 (soft) |
| D4 | `workload-view` | who holds what open work now. Current-state only, per the constraint reading above | — |

**Suggested order:** A3 (`issue-dependencies`) first — it is the biggest prize, unblocks B1, and is
valuable with nothing else built. Then A1, A2 → B1. C1 any time. D1 gates the D track and is the
one that reopens settled refusals, so it wants the most careful proposal.

## What the next session should do

1. Author the nine proposals (proposal.md, design.md with ASCII sketches, tasks.md, spec deltas),
   validate with `npx -y @fission-ai/openspec@latest validate --all`, and put them up for review —
   **proposals only, no product code**, per the maintainer's process choice.
2. Every proposal that touches a recorded refusal must quote it and argue the reversal in its
   design.md, not route around it.
3. Add the ROADMAP rows and mark the family scoped.
4. Ask before assuming: the D-track's per-person-over-time question, and whether `status-history`
   should also unlock burndown (the thing `cycles-register` refused most loudly).

## Also still open, unrelated to this family

- `decision-record` — proposed, 0/64 tasks, parked for the maintainer's go.
- One human-judgement item from `e2e-determinism`: whether the statusline's two new sync states
  (unknown-client recovery, "update needed") read as distinct from an ordinary outage across three
  presets, light and dark.
- Team Home has never been eyeballed against `home-digest-2-full.png`.
- The one-command export gap — the last unmet VISION principle, maintainer-deferred since
  2026-08-04.
