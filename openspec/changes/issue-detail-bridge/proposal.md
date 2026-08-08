## Why

`design-explorations/overhaul-2026-08/northstar/issue.html` is the canonical issue detail, and
the shipped detail is not it. PR #32 gave the product its drawn vocabulary — including a
**vertical rail with a label and a fact line per station that still has no product consumer**;
PR #33 gave every page its three-band frame; PR #34 put every phrase at rest in one shared
dictionary. The issue detail is the page all three were built for, and it is still a two-column
form: a title input, a description, files, comments, and a `Properties` sidebar whose `Delivery`
field is a 118px horizontal track with a bulleted list of PRs under it.

Four concrete gaps:

1. **The page it is named for does not exist.** `issue.html`'s grammar is the **bifact** — a
   plain-language line ("In Progress · Cycle 2 · feature · designed, merged a day ago, every
   check green") sitting directly above a mono fact line ("git merged 8f21c4a · PR #188 ·
   drifted 22h" + the GitHub mark). Same facts, two registers: the sentence for a PM, the mono
   for an engineer. `ia.html`'s word diet names the detail as **the one work surface where mono
   sublines are allowed**, and the shipped page speaks neither register.
2. **The vertical rail has no consumer.** `RealityTrack orientation="vertical"` ships with per
   station `label`/`fact`, a `//` break and a surface-knockout contract, proven only by
   component tests and the showcase. This page is the one it was generalized for.
3. **Divergence is announced and then abandoned.** The shipped page draws the `//` and states
   the sentence. The mock's callout carries **evidence** (`in-progress set 3d ago ≠ merge
   8f21c4a, 22h ago`) and **two working actions** — Mark Done (⏎) and Keep as is (esc). Today
   the reader is told the board is wrong and handed a status menu.
4. **The route resolves a key by scanning.** `teams.$teamId.issues.$issueKey` parses digits out
   of the segment with a regex, syncs **every issue in the team** through `issues.byTeam`, and
   linear-scans for a matching `number`. It never checks that `ENG-116`'s prefix is this team's
   key, and a deep link on a cold client pays for the whole backlog to render one issue.

And one trap this change refuses to fall into. The mock draws an activity feed containing
*"Work started · board todo → in-progress"*, a *Design* property, a *Referenced in* block with a
cycle report, a decision and a retro action, and a comment breakdown *"2 on the mock · 11 on PR
#188"*. **None of those are derivable.** There is no issue status-history table (only the
`lastHumanStatusAt` scalar), no design-artifact entity, no issue↔issue link table, no mention
edge, no query from an issue to a retro action, and PR comment counts are not synced. Every one
of them folds away. What ships is what a durable work-graph timestamp supports.

Vision principles served: **the work graph is visible where the work is** (the rail states
idea → built → live on the issue itself, not on a dashboard), **sub-100ms** (every fact derives
from rows already synced; the by-key query replaces a whole-team sync with one row),
**keyboard-first** (⏎/esc on the callout, every action reachable without a pointer), and the
honesty rule that runs through the reality vocabulary: **a sentence may only be said when a
stored fact supports it.**

## What Changes

- **The masthead becomes the mock's.** Breadcrumb back to Issues · mono issue key · the
  divergence pill (`Done in git, not on the board`, from the shared dictionary, never
  colour-only) · right-aligned **Follow** and the primary action **Mark Done ⏎**. The shared
  `Masthead` gains one additive optional slot for the row above the title; no page hand-rolls
  band-2 chrome.
- **The two-register subline** — this change's name. A plain-language line (status arc · status
  · cycle · labels · the shared dictionary's phrase at rest) directly above a **mono fact line**
  (merge commit · PR number · the divergence age) carrying the GitHub provenance mark under the
  dictionary's existing rule. Both registers state the *same* facts; neither invents one.
- **The delivery rail** mounts the existing vertical track in the right column: **Idea** (planned
  into the cycle, from `cycleAssignedAt`) → **Change opened** (PR `openedAt`, branch → base) →
  **Reviewed** (review states, rounds) → **Merged** (`mergeCommitSha`, N/N checks) → **Live** or
  **Not live yet** (the deploy join). Each station carries the mock's sentence and its mono fact
  line. **The DESIGNED station folds away** — no design-artifact entity backs it — and the rail's
  header states the chain it can actually draw rather than the mock's `idea → designed → built →
  live`.
- **The divergence callout, with evidence and two working actions.** The mono line contrasts
  `lastHumanStatusAt` with the merge. **Mark Done (⏎)** flips the status through the existing
  shared mutator. **Keep as is (esc)** dismisses the callout for this reader without claiming
  the divergence went away — the pill, the `//` break and the phrase all persist.
- **An honest activity feed**, built from durable work-graph timestamps **only**: issue created,
  planned into a cycle, linked to a change (with the link's own `source` — branch or body), PR
  opened, reviews submitted, merged, deployed. One derivation in `packages/schema` feeds both
  the feed and the rail, so the two cannot disagree about the same moment. **No status history
  is faked.**
- **Referenced in folds honestly.** It may show only what exists — the linked pull requests with
  their link source, attachments, comments — or it folds away entirely. **No query is added to
  manufacture backlinks.**
- **Every existing capability survives**: the rich-text description with autosave, mentions and
  image attachments; the Files section; the comment thread and composer with its `⌘↵` hint; and
  the properties block (Status, Priority, Assignee, Cycle, Labels, Updates/Follow). Losing one
  is a regression, and the spec says so.
- **The `$issueKey` route resolves properly.** A new team-scoped named query resolves
  `(teamId, number)` to one issue, carrying the identical read predicate as its siblings. The
  segment is parsed against **this team's key** rather than by stripping non-digits, and the
  bare-number form the sheet's "open full view" link emits keeps working.
- **The sheet and the page share one body.** `?open=<issueId>` keeps working exactly as it does;
  the sheet and the full page render the same component at two measures rather than diverging
  into two implementations.

Non-goals — explicitly out of scope:

- **No new tables, no new mutators, no migration.** The one new named query exists solely
  because resolving an issue by key has no existing query that can serve it.
- **No design-artifact entity, no diptych, no mock cards.** The mock's design node, its `Design`
  property and its Figma/upload card kinds fold away rather than shipping as chrome that
  promises what the product cannot keep (precedent: `app-frame` DI, Decisions).
- **No backlink query, no issue↔issue link, no mention edge, no retro-action join.**
- **No PR comment counts.** The mock's comment breakdown folds.
- **No changes to the issue list, the board, Home or Delivery.**

## Capabilities

### New Capabilities

<!-- none: this change rebuilds and extends existing surfaces -->

### Modified Capabilities

- `issue-detail`: the masthead's anatomy; the two-register subline; the delivery rail with a
  label and fact per station; the divergence callout with real evidence and two working actions;
  the honest activity feed derived only from durable timestamps; folding blocks no entity backs;
  resolution of an issue by its key; one body shared by the sheet and the page.
- `reality-vocabulary`: the vertical rail's station labels and fact lines come from one shared
  derivation over the work graph, and a station with no fact behind it folds rather than
  rendering empty; the rail carries a truthful accessible description of the stations it drew.

## Impact

- `packages/schema/src/zero/issue-timeline.ts` (new): the pure derivation of durable work-graph
  moments for one issue — the single source both the rail and the activity feed read.
  Re-exported from `packages/schema/src/index.ts`.
- `packages/schema/src/zero/queries.ts`: one new team-scoped named query resolving an issue by
  `(teamId, number)`, with the same `teamScoped` predicate and the same linked-delivery subtree
  as `issues.detail`; its query-name constant joins the registry.
- `apps/web/src/issues/issue-detail.tsx`: the page's rebuild — masthead content, the bifact
  subline, the rail, the callout, the feed, the folding refs block, the properties block; the
  sheet and page share this body.
- `apps/web/src/routes/teams.$teamId.issues.$issueKey.tsx`: key parsing against the team's key
  and resolution through the new query.
- `apps/web/src/frame/masthead.tsx`: one additive optional slot for the row above the title.
- `apps/web/src/issues/delivery.ts`: the detail's view joins the same one-signal derivation.
- `packages/ui/src/styles/contrast.test.ts`: the rail's, the callout's and the mono subline's
  token pairs in every theme block.
- E2E: `issues.spec.ts` and any spec that drives the detail panel — selectors updated, never
  weakened.
- No dependency, env var, container, table, mutator or migration is added or changed.

Docs: new `apps/docs/src/content/docs/features/issue-detail.md` (the page's anatomy, the two
registers, the rail's stations and what each one is derived from, the callout's two actions, the
activity feed's honest sources and the four things that fold away and why), plus updates to
`features/reality-vocabulary.md` (the vertical rail has a consumer, and its stations fold),
`features/delivery-signals.md` (where the deploy join is stated on the issue),
`features/issue-list.md` (the sheet and the page share a body), `README.md` and `ROADMAP.md`.
