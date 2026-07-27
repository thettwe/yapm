## Context

`connectors` (change 8) built the whole road up to the last inch. A GitHub webhook is HMAC-verified,
queued FIFO per installation, mapped to a provider-neutral `WorkGraphMutation[]`, and applied through
`applyWorkGraphMutation` in `packages/schema/src/zero/work-graph.ts` — which upserts the
`pull_request` row and creates the `issue_link` edge for every `<TEAM_KEY>-<NUMBER>` it can resolve.
`packages/schema/src/zero/delivery.ts` then computes the issue row's delivery signal and, when the
human status disagrees with git, a `DivergenceKind`.

What it never does is **write the issue's status**. ROADMAP's wedge line says it does. This change
makes the sentence true, on the terms the maintainer set: opt-in per team, off by default, divergence
unchanged when off.

Three constraints shape every decision below.

1. **CLAUDE.md #2** — the status write goes through the shared mutator in `packages/schema` under a
   real permission check, not a raw `tx.mutate.issue.update` and certainly not Kysely.
2. **TECHSTACK line 34** — `WorkGraphMutation` is the firewall. Anything that reads GitHub's payload
   shape to decide a status is a feature-code change a GitLab connector would have to repeat.
3. **The reason divergence exists at all** — overwriting a deliberate human status is hostile. Every
   guard in §D3–D6 is a restatement of that one sentence in a different failure mode.

Prior art inside the repo that this change follows rather than reinvents: the cycle-rollover job
already performs shared-mutator writes with no human behind them, under
`const SYSTEM_CTX: AuthContext = { userID: 'system', role: 'admin' }`
(`apps/server/src/jobs/cycles.ts:19`); `ai-agent` already established that a non-human actor acts
through the same mutators as a human under an explicit `AuthContext` ceiling; and `team.archived_at`
already establishes nullable-timestamp-as-state as the local convention for a soft switch.

## Goals / Non-Goals

**Goals:**

- Make ROADMAP's wedge line true, and make the four contradictory sentences in ROADMAP and VISION
  agree with the code and with each other.
- Two transitions — PR opened → In Review, PR merged → Done — that a team opts into per team.
- A guard ladder such that no transition can undo a deliberate human decision, empty the triage
  inbox, resurrect a canceled issue, move work backward, or rewrite history on the day it is enabled.
- Divergence keeps working, unchanged, wherever automation declines to act.
- The whole decision is a pure function that a GitLab connector inherits for free.

**Non-Goals:** everything in proposal.md §Non-goals. The four worth restating because they shaped
the design rather than merely being excluded: no backward transitions, no new divergence kind, no
per-team choice of *which* transitions (one switch), and nothing written back to GitHub.

## Decisions

### D1 — Exactly two transitions, justified against the fixed status set

`openspec/specs/issue-tracking/spec.md` fixes the categories at Backlog / Todo / In Progress /
In Review / Done / Canceled and forbids user-configurable statuses. Against that closed set, take
each PR state in turn and ask what git says with enough confidence to overwrite a person:

| PR state | Says | Transition |
|---|---|---|
| `open` (including draft → ready) | A change is proposed and awaits review. **In Review is the category whose name is this sentence.** | **→ In Review** |
| `merged` | The change is in the trunk. Nothing further will happen on this PR — it is terminal on GitHub, and `applyWorkGraphMutation` already pins it as terminal locally. | **→ Done** |
| `draft` | Work has started. | **none** — declined, D2 |
| `closed` (unmerged) | Something ended. Which something is unknowable. | **none** — declined, D2 |

Neither transition is a judgement call about the team's process; each is the status category whose
*definition* the git fact restates. That is the bar, and it is why the set is two rather than four.

`in_progress` deliberately has no automated entry. It is the one status that means "a human is
working on this", and the only git evidence for it — a branch or a draft PR — is exactly what D2
declines.

### D2 — What we are NOT doing, and why each one is a decline rather than a deferral

**PR closed-unmerged → anything.** The candidate targets are In Progress ("back to the drawing
board"), Todo ("not started after all") and Canceled ("abandoned"). All three are wrong most of the
time: the overwhelmingly common cause of a closed-unmerged PR is that it was superseded by another
PR against the same issue, in which case the correct status is whatever the *replacement* PR drives
it to, and any transition here would fight that. `computeDivergence` already marks the residual case
— an In Review issue whose PR is gone is `status_ahead_of_pr` today, unchanged.

**Draft PR opened → In Progress.** Declined on information content, not on correctness. The moment
a draft PR exists, the issue row's reality strip shows a PR chip in the `draft` state — the fact is
already on the row, in the surface DESIGN.md §"Issue list" calls the differentiator. A status write
would restate it in a second place, and in teams that open a draft at branch creation (increasingly
the default) it would fire on essentially every issue, which is the definition of a signal that
carries nothing. It is also the transition most likely to be *wrong* in the direction that annoys:
an issue deliberately left in Todo while someone spikes a throwaway branch. Addable later with no
schema change and no migration if a team asks; the guard ladder and the setting would not move.

**Any backward transition.** Automation moving work backward is where it feels most invasive,
because forward automation only ever agrees with something that already happened, while backward
automation contradicts a person's judgement that something is finished. Concretely: an issue is Done
and a new PR appears referencing it. Follow-up, revert, docs pass, a test someone forgot — all
routine, none of them "this issue is not done". The transition is refused, and so is the tempting
compensation of a new `done_but_pr_open` divergence kind: it would fire on that same routine traffic
and turn yapm's single most defining glyph into a thing people learn to ignore. DESIGN.md is explicit
that restraint is the differentiator against Plane's clutter; this is where that gets paid for.

**Canceled, in both directions.** Automation never writes `canceled` (no git fact means "we decided
not to do this") and never writes *over* it (canceled is a deliberate human dead-end; a merged PR
that references a canceled issue is at worst a stale magic word in a branch name). `canceled` is
off-ladder in `AUTO_STATUS_RANK`, so this is one absent map entry rather than a special case.

**Untriaged issues.** An issue with `needs_triage = true` is not yet accepted work; accepting it is
the human act the triage inbox exists for. Advancing it to In Review would remove it from a
teammate's inbox without anyone deciding anything. Automation skips it entirely and leaves the
divergence flag to speak — which is arguably a *useful* signal on the triage row: "this untriaged
issue already has a merged PR."

### D3 — Opt-in per team, as one nullable timestamp that is also the epoch

`team.auto_status_since timestamptz null`. `NULL` ⇒ off. A value ⇒ on since that instant, **and no
event whose own timestamp precedes it may drive status.**

One column rather than a boolean plus a timestamp, following `team.archived_at`. The since-epoch is
not a nicety — it is the answer to the worst failure this feature can have:

- The GitHub connector's **first-install backfill** sweeps existing PRs, and reconciliation re-polls
  historical ones. Both emit `upsertPullRequest` with `state: 'merged'` for every PR merged before
  yapm ever saw the repo. Without an epoch, an admin who enables automation and then installs the
  App watches two hundred issues flip to Done in one queue drain, with no undo.
- With the epoch, "turn it on" means "start driving from now", which is what a person means when
  they flip a switch, and it makes the change **safe to enable on a mature instance** — the single
  biggest adoption question for an opt-in feature.

Turning it off writes `NULL`. Turning it back on writes a fresh `now`, so a disabled window is never
retroactively replayed. There is deliberately no "catch my board up" action; if one is ever wanted
it is a separate, explicitly-confirmed operation, not a side effect of a toggle.

*Alternative considered:* a workspace-level setting. Refused by the mission and correct on the
merits — a workspace holds teams with genuinely different working agreements, and this is a working
agreement. *Alternative considered:* per-transition toggles. That is the workflow-scheme labyrinth
VISION names as the disease.

**Who may flip it:** `canManage` (admin), consistent with every other `team.*` configuration write
(`create`, `rename`, `archive`); membership self-service is the documented exception and does not
generalise to a policy that rewrites everyone's issues. The column *reads* to every member, because
teams already sync workspace-wide to members and a member should be able to tell whether their board
moves on its own.

### D4 — Human intent wins when it is newer than the event; there is no grace window

`issue.last_human_status_at timestamptz null`, stamped by every shared mutator that writes
`issue.status` — `issue.create`, `issue.setStatus`, `issue.move`, `issue.routeIssue` — **except**
when `ctx.userID === SYSTEM_ACTOR_ID`. The guard is:

```
lastHumanStatusAt !== null && lastHumanStatusAt > eventAt  ⇒  no transition
```

where `eventAt` is the mutation's own `updatedAt`, i.e. GitHub's `pull_request.updated_at`, which
`map.ts:98` and `reconcile.ts:241` both already carry precisely so the write path can reason about
event order rather than wall clock.

The question the mission poses is "whether recent human intent suppresses the transition, and for
how long". The answer is: **whenever it is newer than the event, for exactly as long as that is
true** — a comparison, not a duration. A fixed N-minute window is worse in both directions:

- **Too long, in the common case.** Set an issue to In Progress, push the branch, open the PR two
  minutes later. Under a ten-minute window the In Review transition is suppressed — and then never
  happens, because the PR-opened edge does not recur. The feature silently fails on its most common
  usage pattern. This is not hypothetical; it is the modal workflow.
- **Too short, in the case that matters.** A webhook dropped and healed by the reconcile sweep two
  days later, or a queue backlog, produces an event whose *content* is two days old but whose
  *arrival* is now. Any window measured from arrival lets it overwrite a status a person set
  yesterday. Only the event's own timestamp distinguishes these.

`last_human_status_at` is backfilled from `issue.updated_at` in the migration, so pre-existing
issues are treated as human-touched at their last edit rather than as never-touched. It records a
timestamp and nothing else — no user id, no "changed by" — which keeps it outside the per-person
constraint entirely.

*Alternative considered:* reuse `issue.updated_at`. Rejected: it moves on a title edit, a label, an
assignee, a comment-driven bump — it means "somebody touched this", not "somebody decided this
status". Using it would suppress transitions for reasons unrelated to status and would be impossible
to explain to a user.

### D5 — Fire on a state EDGE, not on a state

The transition runs only when the effective stored PR state actually changes:

- **insert** — a PR yapm has not seen before, with its initial state; or
- **update** where `existingState !== effectiveState` (`effectiveState` being what
  `applyWorkGraphMutation` actually writes, i.e. `merged` pinned when it was already merged).

This is not an optimisation, it is a correctness requirement. `pull_request.updated_at` bumps on any
activity — a comment, a label, a review — so a merged PR emits fresh `upsertPullRequest` mutations
for months. Firing on *state* would re-evaluate "merged ⇒ Done" every time, with an `eventAt` newer
than the human's, which is exactly how a person who reopened a Done issue watches it flip back an
hour later. Firing on the *edge* makes that structurally impossible: `merged` is terminal, so the
merged edge occurs exactly once per PR, ever.

It also gives idempotency for free — webhook redelivery, ETag reconciliation of an unchanged
resource, and a pg-boss retry all produce no edge and therefore no write — which composes with the
existing out-of-order guard (`mutation.updatedAt < existing.updatedAt` returns early before any
status is considered).

### D6 — The full guard ladder, ordered, as one pure function

`packages/schema/src/zero/auto-status.ts`:

```ts
export function decideAutoStatus(input: {
  autoStatusSince: number | null   // team setting; null = off
  currentStatus: IssueStatus
  needsTriage: boolean
  lastHumanStatusAt: number | null
  previousPrState: PullRequestState | null   // null = the PR row is new
  prState: PullRequestState                  // the effective state just written
  eventAt: number                            // the event's own updated_at
}): IssueStatus | null
```

Evaluated in order; the first match returns `null`:

1. `autoStatusSince === null` — automation is off for this team.
2. `eventAt < autoStatusSince` — the event predates the opt-in (D3).
3. `previousPrState === prState` — no edge (D5).
4. `needsTriage` — untriaged work is not advanced (D2).
5. `currentStatus === 'canceled'` — off-ladder (D2).
6. `lastHumanStatusAt !== null && lastHumanStatusAt > eventAt` — human intent is newer (D4).
7. target = `merged → 'done'`, `open → 'in_review'`, otherwise `null` (D1).
8. `AUTO_STATUS_RANK[target] <= AUTO_STATUS_RANK[currentStatus]` — never sideways or backward (D2),
   which also makes "already there" a no-op.

Otherwise, the target. Pure, synchronous, dependency-free, and exhaustively table-testable — eight
guards is eight unit tests plus the happy paths, and a reviewer can read the ladder in one screen.
`AUTO_STATUS_RANK` is `backlog 0, todo 1, in_progress 2, in_review 3, done 4`, with `canceled`
absent by construction rather than by a branch.

### D7 — The write goes through `issue.setStatus` under a system principal

`applyAutoStatusForPullRequest(tx, { teamId, now }, { pullRequestId, previousState, state, eventAt })`
reads the team's setting, walks the PR's `issue_link` rows, and for each linked issue whose
`decideAutoStatus` returns a target calls:

```ts
await mutators.issue.setStatus.fn({
  tx,
  args: { id: issue.id, status: target, updatedAt: now },
  ctx: SYSTEM_AUTH_CONTEXT,
})
```

— the *same function* the keyboard shortcut, the board drag and the AI agent call. It re-runs
`canWrite` and `assertTeamAccess` on the way in, so the permission check is real rather than
decorative, and there is no second write path into `issue.status` for a reviewer to have to know
about.

**The actor.** `SYSTEM_ACTOR_ID = 'system'` and `SYSTEM_AUTH_CONTEXT = { userID: 'system', role:
'admin' }`, promoted from `apps/server/src/jobs/cycles.ts` into `packages/schema/src/zero/context.ts`
and imported by both callers, so the product has exactly one definition of "the instance acting as
itself".

Why not the PR author, which is the reflex? Three reasons, in increasing order of importance: the
GitHub login may map to no yapm user at all; the author of a PR is frequently not the person who
would have made this status call; and attributing a machine decision to a human is precisely the
audit-trail corruption the mission names. Why an admin role rather than a narrower one? Because the
principal must be able to write in *every* team without a `team_membership` row, and
`assertTeamAccess` short-circuits on `admin` — the same reason cycle rollover uses it. The ceiling is
not the role, it is that the principal is reachable from exactly two call sites in the codebase,
neither of which takes input from a user.

This is the analogue of `ai-agent`'s agent-as-actor pattern with the one structural difference: an
agent has an invoking human whose role is its ceiling and whose approval gates its writes; a webhook
has no human. So the ceiling here is the guard ladder plus the per-team opt-in, and the audit
statement is `last_human_status_at` **not** being stamped — the machine-readable record that the
last status write was not a person's.

Bounded: the loop reads at most `AUTO_STATUS_MAX_LINKED_ISSUES` (25) `issue_link` rows for one PR, so
a pathological PR body full of magic words cannot make one delivery unbounded work.

### D8 — Where it hooks in: `packages/schema`, behind the union

The call sites are the two non-stale branches of `applyWorkGraphMutation`'s `upsertPullRequest` case
— after `linkIssues`, so a PR that both links and transitions in one delivery does both. The stale
branch (`mutation.updatedAt < existing.updatedAt`) still links and still returns without considering
status: a stale event may add a missing edge (upserts are additive) but must never drive state.

`apps/server/src/connectors/github/` is **not touched at all**. Everything the decision needs
(`state`, `updatedAt`, the linked issues) is already on the union variant or already in the
transaction. A GitLab connector that emits `upsertPullRequest` gets status automation with no code
change, which is the property TECHSTACK line 34 promises and the `connectors` spec's "a second
connector needs no feature-code change" scenario asserts.

Import direction: `work-graph.ts → auto-status.ts → mutators.ts`. `mutators.ts` imports neither, so
there is no cycle; verified by reading its import list (`context`, `cycles`, `errors`, `filter`,
`retro/*`, `schema`, `rich-text`).

### D9 — Divergence when automation is ON, OFF, and BLOCKED

This is the question the mission asks most directly, and the answer is that the two features are one
behaviour with a switch rather than two features that overlap.

- **Off** (the default, and every existing instance): nothing changes. Divergence fires exactly as
  it does today. This is the whole reason the change is opt-in.
- **On, transition fires**: status and git now agree, so `computeDivergence` returns `null` **by
  construction** — the flag is quiet because the disagreement it reports no longer exists, not
  because anything suppresses it. `status_behind_merge` requires a merged PR under a not-done issue;
  the transition is what makes that state unreachable.
- **On, transition blocked** (any of D6's guards 2–8): divergence fires. And it should — a blocked
  transition is precisely a case where yapm is *not confident enough to act* but *is* confident the
  two disagree. Automation corrects what it is sure about and hands the rest to the flag. Concretely:
  a human reopens a Done issue after the merge (guard 6), and the row shows `status_behind_merge` —
  the correct outcome, because a person may well want to re-close it.

`computeDivergence` and `computeDeliverySignal` are **not modified**: same signatures, same
`DivergenceKind` union, same bodies. The work-graph spec's "The seam signatures are unchanged"
scenario continues to hold literally.

One acknowledged wrinkle, recorded rather than papered over: automation sets In Review on a PR
opening; if that PR is later converted back to draft, `status_ahead_of_pr` fires on a status
automation itself wrote. That is honest — the disagreement is real and the human should resolve it —
and adding a "but automation put it there" exemption would mean tracking provenance per transition
for a case that resolves itself the moment the PR is marked ready again.

### D10 — The surface: a section on the admin connectors page, not a new team-settings route

The toggle lives in a **Status automation** section on `/settings/connectors`, one row per team.

That page is already admin-only, already the page an operator lands on after connecting GitHub, and
already the home of the repo→team mapping — which is the *same shape of thing*: a per-team,
admin-owned, connector-adjacent setting. Automation is meaningless without a connector, so putting
the switch anywhere else means offering a control that does nothing on a fresh instance.

*Alternative considered:* a new `/teams/$teamId/settings` route. Better discoverability for a team
lead browsing their own team, and worse in every other respect for this change — it invents a whole
team-settings surface (nav entry, route, empty-state, permissions) to hold one switch, and it
scatters per-team connector configuration across two pages. Revisit when a second team-level setting
exists; the mutator and column do not move when it does.

Mechanically the section differs from the rest of that page in one way worth stating: the connector
status is REST (`/api/v1/connectors/...`, because the config is server-only), while this setting is
a **synced Zero column**, so the toggle is an optimistic shared-mutator call with no round trip. That
is the sub-100ms answer and it is why the column is on `team` rather than in `connector_config`.

**Controls.** The existing tokenized `Button`, in the same shape as the connector's own
Enable/Disable — no new `packages/ui` component and no new token. Each row is reachable by Tab,
actionable by Enter/Space, labelled with the team name and the current state, and announces the
change. Verified in all three presets, light and dark, at AA.

**Copy carries the trade-off, because the switch cannot.** The section states the two transitions,
states that automation never moves an issue backward and never touches Canceled or untriaged issues,
and states that enabling it does not change existing issues. A self-hoster deciding whether to flip
it needs those three sentences at the point of decision, not only in the docs.

### D11 — Big-feature rule (PROCESS.md §3): all three tiers, and the count is 3 of 4

- **Synced entity / schema** — yes. Two new columns on two synced tables, migration `0016_auto_status`,
  Zero schema + hand-written `DB` + drift test.
- **Mutator** — yes. One new (`team.setAutoStatus`) and four modified to stamp
  `last_human_status_at`.
- **Permission surface** — yes. A new `canManage`-gated mutator, and a system principal promoted into
  `packages/schema` as a first-class part of the write model.
- **Signature UI** — no. A settings section is not the issue row, the board, or the palette.

Three of four, so all three tiers. Concretely: **unit** for the guard ladder (each of the eight
guards, plus the transitions and the rank table) and for the mutator stamping rule; **integration**
against live Postgres for the end-to-end delivery → transition, the off case, the blocked cases, and
the drift test; **E2E** for the keyboard-only toggle and its persistence through sync. The E2E is not
reflexive — the setting is a synced write behind an admin gate, which is exactly the class of thing
that passes unit tests and is unreachable by keyboard in the browser.

## Risks / Trade-offs

- **A team enables it and an old event flips issues anyway** → the since-epoch (D3) makes every
  pre-enable event inert, and the integration suite asserts it with a merged PR whose `updated_at`
  precedes `auto_status_since`.
- **Clock skew between GitHub and the instance makes the D4 comparison wrong at the margin** → the
  window of ambiguity is the skew (seconds). Inside it, the loser is a status write nobody had
  strong feelings about; the case D4 exists for (a stale healed event versus yesterday's human) is
  hours or days wide and unaffected. Accepted, and preferable to comparing against local wall clock,
  which would be wrong by the *queue depth* rather than by the skew.
- **The magic-word linker links the wrong issue and automation then moves it** → real, and it is a
  pre-existing property of `parseIssueRefs` that this change raises the stakes on: a stale `ENG-12`
  in a branch name now moves ENG-12 rather than merely decorating it. Mitigated by the linker's
  existing team-scoping (a ref only ever resolves inside the PR's mapped team, never across a
  boundary), by forward-only movement (the blast radius is "an issue advanced too early", never work
  deleted or reverted), by the opt-in, and by the divergence flag which now points *at* the
  mismatch. Not eliminated, and the docs page says so plainly rather than promising precision the
  linker does not have.
- **Two PRs link one issue and disagree** → they cannot, given forward-only: whichever PR merges
  first drives Done and the other's opening edge is then below the rung. The worst case is an issue
  marked Done while a second PR is still open, which is the follow-up pattern D2 already declines to
  flag.
- **`last_human_status_at` is a fifth thing four mutators must remember to stamp** → the failure mode
  is silent (automation starts overriding humans) and would not be caught by any existing test. So
  it is asserted directly: a unit test enumerates every mutator in `defineMutators` that writes
  `issue.status` and requires each to stamp the column for a human ctx and to leave it untouched for
  the system principal. A fifth status-writing mutator added later fails that test rather than
  shipping the hole.
- **The migration backfills `last_human_status_at` over the whole `issue` table** → a single
  `UPDATE issue SET ...` with no index build, on a table whose row count for the target audience
  (2–20 person teams) is thousands, not millions. Forward-only and idempotent. The alternative,
  leaving it `NULL`, would make every pre-existing issue eligible for a first-install backfill
  transition — but the since-epoch already blocks those, so this is belt and braces.
- **The system principal is an admin, and admin is the top of the ceiling** → it is unreachable from
  any user input: two call sites, both server-only, both driven by data the instance produced. A
  narrower principal is not expressible today (there is no per-team system membership) and inventing
  one to hold two call sites would be more surface, not less.

## Migration Plan

`0016_auto_status` adds two nullable columns and runs one `UPDATE` to seed
`issue.last_human_status_at` from `issue.updated_at`. No index, no table, no constraint, no
`CREATE EXTENSION`. Boot is not measurably slower.

Upgrade behaviour is the point: every existing team has `auto_status_since IS NULL`, so an instance
that upgrades and does nothing behaves **identically** to the version before it — same divergence
flags, same statuses. `down()` drops both columns.

zero-cache: two plain nullable `timestamptz` columns on existing replicated tables. Task 2.5 verifies
the replica applies the DDL on a live cache and on a fresh volume before anything is built on top,
following `search`'s I1 precedent rather than assuming it.

## How we will know this worked

**The single falsifiable check.**
`packages/schema/src/zero/auto-status.pg.test.ts`, the scenario
`"a merged PR drives the linked issue to Done only for a team that opted in"`, run with
`DATABASE_URL=postgres://yapm:yapm@localhost:5446/yapm pnpm --filter @yapm/schema test auto-status.pg`.

It seeds two teams — **T1 with `auto_status_since` set to an hour ago, T2 with `NULL`** — each with
one issue in `todo` (`ENG-1`, `OPS-1`), and drives the *same* two work-graph mutations at each: an
`upsertPullRequest` in state `open` with a branch `feature/<KEY>-1-thing`, then the same PR in state
`merged`, both with an `updatedAt` of now, through `applyWorkGraphMutations` — the real ingest write
path, not a shortcut.

1. T1's issue is `in_review` after the first mutation and `done` after the second.
2. T2's issue is `todo` after both, and `computeDivergence('todo', signal)` returns
   `status_behind_merge` — off means *unchanged*, divergence and all.
3. Replaying the merged mutation verbatim writes nothing (no edge) and leaves T1's issue `done`.
4. With T1's issue moved to `in_progress` by a member **after** the merged mutation, replaying a
   later merged-PR delivery leaves it `in_progress` — human intent newer than the event wins — and
   divergence fires.

**On today's `main` this fails at assertion 1**, and it fails for the right reason: no status is
written by any ingest path, so `ENG-1` is still `todo`. It also fails at import — `auto-status.ts`
does not exist and `team.auto_status_since` is not a column. Assertions 2–4 are the ones a
plausible-but-wrong implementation fails: always-on automation fails 2, firing on state rather than
edge fails 3, and a naive last-writer-wins fails 4.

**The second half, which only an E2E can check.** `apps/web/e2e/auto-status.spec.ts`: as an admin,
reach `/settings/connectors` and toggle one team's automation on **using only the keyboard**, then
reload and assert it is still on (the value round-tripped through Postgres and back down the sync
socket, which no unit test covers), and assert a `viewer`/`member` session cannot reach the control
at all. On `main` this fails because the section does not exist.

**Supporting gates:** the drift test (both columns present in Postgres and in the Zero schema); the
`ai-tools` exhaustiveness test (which fails until `team.setAutoStatus` is classified); the
stamping test in D11; and a mechanical assertion that `.env.example` gained nothing, because a
feature that quietly grows a config knob has broken the "one nullable column" promise.

**What is not agent-checkable, and belongs to a human.**

- **Whether the two transitions are the right two for real teams.** The tests can prove the ladder
  is exactly as specified; they cannot prove In Review is where a team wants an issue when a PR
  opens. This is the single judgement most likely to need revisiting after real use, and the
  cheapest signal is one self-hosting team leaving it on for a cycle.
- **Whether the settings copy makes the trade-off legible at the moment of decision** — whether an
  admin reading three sentences understands that enabling it will not touch their existing board.
  If it does not read that way, the fix is the copy, not the behaviour.
- **Whether the section feels Linear-grade against the Warm mockups.** The standing example, flagged
  rather than automated.

## Open Questions

None blocking. Two answered by deliberate choice rather than evidence, recorded so they are findable
if the choice turns out wrong: whether the toggle should be **admin-only** (D3 — it is, consistent
with every other `team.*` config write, and a team without an admin willing to flip it has a bigger
problem), and whether the section belongs on the connectors page or a future team-settings route
(D10 — connectors page now, and neither the column nor the mutator moves if that changes).

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

*(Ladder + schema-surface phase — the two consumer-free producers: the pure decision function and
the storage surface. No call site of `decideAutoStatus` exists yet, by design.)*

### I1 — Task 2.5: two nullable `timestamptz` columns are a replication non-event, on both paths

Run against the `yapm-as` compose project (ports 5446/4854/3006), `postgres:18` +
`rocicorp/zero:1.8.0`, from `down -v`, with no publication change — the default
`FOR TABLES IN SCHEMA public` throughout. Migrations `0001`–`0015` were applied first and allowed to
replicate fully (write-worker reached `create-index search_document_watermark_idx`,
`"stage":"Replicating"`), and a workspace + team + one three-day-old `todo` issue were seeded, so the
backfill had a row to touch and the copy had a row to carry.

**(a) The upgrade path — DDL applied to a live zero-cache.** `0016_auto_status` ran while zero-cache
was replicating. The change-streamer logged both statements off the WAL
(`alter table "team" add column "auto_status_since" timestamptz`,
`alter table "issue" add column "last_human_status_at" timestamptz`, each as `ddlStart` →
`ddlUpdate` → `1 schema change(s)`), and the **write-worker applied both**:

```
write-worker  add-column team    name=auto_status_since     typeOID=1184 dataType=timestamptz notNull=false dflt=null pos=8
write-worker  add-column issue   name=last_human_status_at  typeOID=1184 dataType=timestamptz notNull=false dflt=null pos=19
write-worker  PRAGMA optimized after schema change (0 ms)
```

No error, no warning, no resync, `"status":"OK"` / `"stage":"Replicating"` throughout. The one-shot
`update issue set last_human_status_at = updated_at` replicated as ordinary row traffic; in Postgres
`last_human_status_at = updated_at` on the pre-existing row, so the backfill did what it claims.

Contrast with the `search` I1 finding, which is why this was confirmed rather than assumed: there,
the GIN **expression index** was silently skipped by the write-worker. Nothing here is skipped —
`timestamptz` (OID 1184) is already on the replication path for `created_at`, `updated_at`,
`archived_at` and `cycle_assigned_at`, and `add-column` on an existing replicated table is a plain
schema change.

**(b) The fresh-install path — an empty replica against a schema that already has the columns.** The
`yapm-as_zero-replica` volume was deleted and zero-cache restarted (postgres untouched). Initial sync
copied 42 tables, and both new columns are **in the copy `SELECT` list**, which is the assertion that
matters:

```
Starting binary copy stream of team:  SELECT "archived_at","auto_status_since","created_at","id","key","name","updated_at","workspace_id" FROM "public"."team"
Starting binary copy stream of issue: SELECT "assignee_id","carryover_count","created_at","creator_id","cycle_assigned_at","cycle_id","description","id","last_human_status_at","needs_triage","number","priority","project_id","rank","rolled_over_from_cycle_id","status","team_id","title","updated_at" FROM "public"."issue"
```

`Finished copying 1 rows into team`, `Finished copying 1 rows into issue`, then `"stage":"Indexing"`
→ `"stage":"Replicating"`, `"status":"OK"`, container `healthy`. The replica SQLite file could not be
read out of the container directly (`node:sqlite` reports "file is not a database" — zero-cache's
build uses a WAL variant stock SQLite will not open), so the copy `SELECT` and the row counts are the
evidence, not a query against the replica file.

**Conclusion: no fallback needed.** No custom publication, no `ZERO_APP_PUBLICATIONS` change, no full
replica resync on upgrade. The rest of the change can be built on this.

### I2 — `AUTO_STATUS_RANK` excludes `canceled` from its KEY TYPE, not just from its entries

Tasks 1.3/design §D6 say `canceled` is "absent by construction, NOT by a branch". A
`Partial<Record<IssueStatus, number>>` with five entries satisfies the letter of that and loses the
spirit: the lookup then returns `number | undefined`, guard 8 needs a defensive `=== undefined`
check to compile, and that check *is* the branch the task forbids — worse, a silent one that would
also swallow a genuinely unranked new status.

So the rank map is keyed by an exported `AutoStatusRung = Exclude<IssueStatus, 'canceled'>` and typed
`Readonly<Record<AutoStatusRung, number>>`. Three consequences, all wanted: guard 5's
`currentStatus === 'canceled'` early return narrows `currentStatus` to `AutoStatusRung`, so guard 8
is a total lookup with no defensive branch; the target map's values are `AutoStatusRung`, so an
unrankable target is unrepresentable rather than merely absent; and adding a seventh `IssueStatus`
**fails to compile here** until someone decides where — or whether — it sits on the ladder, which is
the property "by construction" is supposed to buy.

### I3 — The drift test's `KYSELY_DB` mirror was updated here; its new *assertions* stay with task 2.4

`schema-drift.test.ts` holds a hand-written mirror of the `DB` interface and fails on any column
present in Postgres but absent from the mirror. Adding the migration without touching it leaves the
suite red between this phase and the test phase, which contradicts "the app runs after every task".
The two mirror entries are therefore part of the surface (tasks 2.2/2.3), not part of the test: they
are the same mechanical edit as `db/types.ts`, in a different file. Task 2.4's actual content — an
explicit assertion that both columns are present in Postgres *and* in the Zero schema — is untouched
and still owned by the test phase.

### I4 — `apps/server/src/ai/digest.ts` held a THIRD copy of the system principal; folded too

Task 1.2 names only `jobs/cycles.ts:19`, but a grep for the literal found the same
`const SYSTEM_CTX: AuthContext = { userID: 'system', role: 'admin' }` at `ai/digest.ts:28`, passed to
`gateway.generateStructured` as the workspace's own principal for AI config and spend resolution.
Leaving it would make design §D7's claim — "the product has exactly one definition of *the instance
acting as itself*" — false on the day it is written, and it is the same principal under the same two
rules (server-side, instance-produced data, never derived from a request). Folded onto
`SYSTEM_AUTH_CONTEXT`; the digest's own reason for using it (team-internal, structured-only, no
per-user ceiling to enforce) moved to a comment at the call site, since that is a constraint the
shared constant cannot carry. All 32 server test files / 236 tests pass unchanged.

### I5 — Gate output for this phase

`pnpm turbo lint` clean (457 files). `pnpm turbo typecheck build` clean (11 tasks).
`node scripts/check-boundaries.mjs` clean. With
`DATABASE_URL=postgres://yapm:yapm@localhost:5446/yapm`: `@yapm/schema` 42 files / 578 tests passed,
`@yapm/server` 32 files / 236 tests passed — including `src/jobs/cycles.test.ts` (4 tests) unchanged,
which is task 1.2's stated confirmation. `grep -rn decideAutoStatus apps packages --include="*.ts"`
returns only the definition and its `index.ts` re-export: no consumer exists yet, which is the point
of this phase.
