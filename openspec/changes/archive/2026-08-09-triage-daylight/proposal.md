## Why

`design-explorations/overhaul-2026-08/destinations/triage.html` is the approved drawing of the
intake queue. Triage is a deck destination sitting inside the shipped three-band frame with a
pre-overhaul interior: PR #33 gave it the frame, PR #32 (corrected by #38) gave the row its drawn
vocabulary, PR #34 gave the product its phrase dictionary — and this page was never drawn.

What the shipped page gets wrong, concretely:

1. **Band 2 repeats a word the deck already owns.** The masthead says `Engineering · Triage`; the
   deck states the team two stops to the left. `ia.html`'s word diet forbids exactly this, and
   `issue-list-daylight` already settled the identical case for Issues (DI-9).
2. **The verdicts are borrowed icons.** Three `lucide` `Check` / `Route` / `X` icon buttons on
   every row, standing where this product's own marks should stand. The mock replaces them with
   **keys** — `[A] Accept`, `[R] Route`, `[D] Decline` — stated in words with their keycaps, in a
   rail belonging to the one issue under decision.
3. **Nothing on the surface makes the next decision faster.** A triage row shows the same facts
   as a list row and no more. The reader has to open the issue to read what was reported. The
   mock unfolds the row under decision in place, carrying the issue's own words, the reporter and
   the created-at in a mono line, and any attachment as an upload chip.
4. **The row does not line up with the issue list's row.** The shipped page wraps `IssueRow` in a
   flex shell with an action cluster bolted to its right edge, so a triage row and a list row do
   not share a single column boundary.
5. **The empty state is a paragraph explaining triage to itself.** "The triage inbox is empty.
   Incoming issues awaiting triage will appear here." The mock draws the done disc, two words —
   `Nothing waiting.` — and an onward foot.

Vision principles served: **sub-100ms and offline-capable** (every fact on the page renders from
rows Zero has already synced), **keyboard-first** (every verdict reachable and activatable without
a pointer; the one transient focus-reachable and escapable), **team-level metrics only** (no
per-person triage throughput appears anywhere), and the honesty principle that runs through the
whole overhaul — a surface may only state a fact some stored row supports.

## What Changes

- **The masthead**: `Triage` + a mono count + a mono `oldest first`. The team name goes, because
  the deck carries it. `oldest first` is not drawn over an empty queue.
- **The queue stays a list** — every waiting item visible, no fold. A queue you want to empty
  must show its own floor. Row anatomy becomes **`IssueRow`'s, unwrapped**: priority tick ·
  status arc · mono key · title · spring · phrase slot · reality track · age · labels · mono age ·
  avatar, so a triage row and a list row line up column for column. The reality slot is
  **reserved and empty** — a triage issue has no linked change, and a quiet slot draws no ink.
- **The row under decision unfolds in place** into a decision panel carrying what makes the next
  decision fast: the issue's description (the one legitimate document voice on this surface), a
  mono `reporter · created-at` line, and each attachment as an upload chip.
- **Three verdicts as keys, in the panel's own rail**: `[A] Accept`, `[R] Route`, `[D] Decline`,
  each a real button whose accessible name is the word, never icon-only. `Route` opens the page's
  **one transient** — a panel listing exactly what routing writes, with the values it will write.
- **`issue.routeIssue` gains `projectId`.** The mock's route menu lists a Project row and the
  shipped mutator writes status, assignee, cycle and labels only. `issue.projectId` and the
  `project` table both exist and `issue.setProject` already establishes the permission story, so
  the field is added rather than the row dropped — see design D1. No control on this page does
  nothing.
- **The empty state as the mock's second frame**: the done disc, `Nothing waiting.`, and an
  onward foot (Issues · Cycles · Projects, and `⌘K goes anywhere`). Announced honestly, and never
  shown while the inbox query is still filling.

Non-goals, folded deliberately — the mock's own comment records each and the build honours it:

- **No SLA, queue-age target, overdue mark, or age colour ramp.** The age column states
  `created_at` plainly and claims nothing about it.
- **No triage owner or rota** (no entity backs either), **no auto-classified suggested label or
  priority** (there is no classifier), **no per-person triage throughput** (metrics are
  team-level only).
- **No duplicate-detection hint.** `issue_link` is issue→pull_request only; there is no
  issue-to-issue table. Left undrawn rather than faked.
- **No "moved to triage at 14:02".** There is no issue status-history table.
- **No new tables, no migration, no new named query.** One optional field on one existing mutator
  is the whole schema-side change.

## Capabilities

### New Capabilities

<!-- none: this change re-draws an existing destination and extends one existing mutator -->

### Modified Capabilities

- `triage`: the queue's row anatomy and reserved-empty reality slot; the in-place decision panel;
  the three verdicts as named keys with the page's one transient; the honest empty state; the
  word diet on band 2; and `issue.routeIssue` gaining an optional `projectId`, validated exactly
  as `issue.setProject` validates it, with the permission story unchanged.

## Impact

- `packages/schema/src/zero/mutators.ts`: `routeIssueArgs` gains `projectId?: string | null`;
  `routeIssue` validates existence (workspace-level, no cross-team rejection — a project spans
  teams) and folds it into the same atomic `issue.update`. `ai-tools.ts` derives the agent tool
  from `routeIssueArgs`, so the tool gains the field at its existing `write` risk class.
- `packages/ui/src/components/issue-row.tsx`: one optional prop so the trailing avatar can
  announce a reporter rather than an assignee (design D5). No visual change to any other surface.
- `apps/web/src/triage/triage-view.tsx`: rebuilt to the mock — masthead, queue, decision panel,
  verdict rail, route transient, empty state. The `RouteDialog` is replaced by the transient.
- `packages/ui/src/styles/contrast.test.ts`: the decision panel's ground, the keycap ink and the
  empty-state disc, in every theme block, light and dark.
- `apps/web/e2e/triage.spec.ts`: selectors updated where the surface moved. The `triage-accept` /
  `triage-route` / `triage-decline` test ids are **kept**, so the viewer's read-only assertions
  hold verbatim. No assertion is weakened; the route flow gains a project assertion.
- No dependency, env var, container, table, migration or named query is added or changed.

Docs: `apps/docs/src/content/docs/features/triage.md` (the row anatomy, the decision panel, the
three verdicts and their keys, what routing writes — now including project — and the empty
state), plus `features/projects.md` if it enumerates what writes `project_id`, and the `README.md`
/ `ROADMAP.md` status rows.
