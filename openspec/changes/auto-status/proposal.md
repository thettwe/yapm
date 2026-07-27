## Why

ROADMAP's locked **Wedge proof** line has read the same thing since day one: *"GitHub App —
branch/PR ↔ issue linking, **PR state drives issue status**, PR + checks visible on the issue."*
Linking shipped with `connectors`. The reality strip shipped. **Nothing drives issue status.**
`grep -rn "auto-status\|automatic status" apps packages` returns nothing but a `reference/` note
about a GitHub *write* scope we never took.

What shipped in its place was `computeDivergence` (`packages/schema/src/zero/delivery.ts:103`),
which **flags** a human-set status that disagrees with git rather than correcting it. That was the
right first move — silently overwriting a deliberate status is hostile, and someone who set an issue
to In Progress meant it — but it is not what the wedge line promises, and the repo now contradicts
itself in three places at once: ROADMAP line 10 says v1 drives status, ROADMAP row 8 claims
`connectors` already shipped "PR linking + auto-status", and ROADMAP §Post-v1 line 60 **and**
VISION §Phase 2 line 87 both list "automatic status transitions" as Phase 2 work not yet started.
All four sentences cannot be true. Resolving that contradiction in the docs is part of this change,
not a footnote to it.

The resolution the maintainer chose is the middle path, and the middle is load-bearing:
**opt-in automation, per team, off by default; divergence remains the behaviour when it is off.**
A team turns it on knowingly. A team that does not is byte-for-byte unchanged.

It serves VISION **#3 Reality over ritual** (the fact that a PR merged is available from git; asking
a human to re-type it as a status is the ritual), **#2 Opinionated defaults, real escape hatches**
(two transitions, fixed, not a workflow-scheme builder — and an off switch that is the default),
**#1 Speed is the feature** (the transition happens off the request path in the existing ingest
worker; no interaction newly waits on anything), **#4 Metrics for teams, never surveillance** (the
setting is per *team*, the actor is a system principal, and nothing about who opened the PR is
recorded on the issue), and **#8/CLAUDE.md #8** (nothing here is per-person).

## What Changes

- **Two transitions, and only two.** A linked PR **opened** (leaving draft counts) moves its issue
  to **In Review**; a linked PR **merged** moves it to **Done**. Both are justified against the
  fixed status categories in `openspec/specs/issue-tracking/spec.md` in design.md §D1, along with
  the two candidates deliberately declined — **PR closed-unmerged** (no correct target exists) and
  **draft PR opened** (the reality strip already shows it; the status write adds ritual, not
  information).

- **Opt-in per team, off by default, stored as one column.** `team.auto_status_since` — a nullable
  timestamp. `NULL` means off, which is today's behaviour exactly. A value means *on since that
  instant*, and **an event older than it never drives status**, so turning automation on does not
  retroactively rewrite the board and a first-install backfill of two hundred historical merged PRs
  cannot flip two hundred issues to Done. One column carries the switch and the epoch, mirroring
  `team.archived_at`'s existing nullable-timestamp-as-state convention.

- **Automation only ever moves an issue FORWARD, and never touches Canceled or untriaged work.**
  Backlog < Todo < In Progress < In Review < Done is a strict ladder; a target at or below the
  current rung is a no-op. `canceled` is off-ladder and never written — it is a deliberate human
  dead-end. An issue still in the triage inbox (`needs_triage`) is never advanced: triage is the
  human act of accepting the work, and automating past it would empty the inbox behind the team's
  back.

- **A human's status write wins whenever it is newer than the event's own timestamp** — the sharpest
  UX risk in the change, and the answer is a comparison rather than a grace window. A new
  `issue.last_human_status_at` is stamped by every status write **except** the system principal's,
  so a merged-PR event that a reconcile sweep heals two days late cannot undo the status a person
  set yesterday. design.md §D4 records why a fixed N-minute window is worse in both directions.

- **Divergence is the fallback, by construction and by design.** When a transition fires, status and
  git agree and divergence goes quiet on its own. When automation is off, or a transition is
  **blocked** by any guard above, divergence fires exactly as it does today. The two features are
  one behaviour with a switch, not two competing ones: automation corrects what it is confident
  about and hands everything else to the flag.

- **The actor is a system principal, never the person who opened the PR.** The transition writes an
  issue row through the shared `issue.setStatus` mutator under
  `{ userID: 'system', role: 'admin' }` — the same principal the cycle-rollover job has used since
  `cycles` (`apps/server/src/jobs/cycles.ts:19`), promoted here from a local constant in `apps/` to
  one exported definition in `packages/schema`. This is the analogue of `ai-agent`'s agent-as-actor
  model with the one difference that matters: an agent has an invoking user whose role is its
  ceiling, and a webhook has no user at all, so impersonating the PR author would attribute a
  machine decision to a person who may not even hold a yapm account.

- **The transition lives behind the `WorkGraphMutation` union, not inside GitHub code.** It is
  driven by the `upsertPullRequest` variant in `packages/schema`, so a GitLab connector that emits
  the same variant inherits status automation with **no feature-code change** — the property
  TECHSTACK line 34 calls the firewall. Nothing in `apps/server/src/connectors/github/` is aware
  the feature exists.

- **It fires on a state *edge*, not on a state.** A merged PR whose `updated_at` bumps because
  somebody commented on it is not a merge event. The transition runs only when the effective stored
  PR state actually changes (or on first insert), which makes webhook redelivery, ETag reconciliation
  and the existing out-of-order guard idempotent for free.

- **An admin surface with per-team granularity**, added as a "Status automation" section on the
  existing admin-only `/settings/connectors` page — where the repo→team mapping this feature depends
  on already lives. One row per team, one keyboard-operable toggle each, built from the existing
  tokenized `Button` used by the connector's own Enable/Disable control. Correct in all three presets
  in light and dark.

- **No new GitHub App scope.** The write is entirely inside yapm's own database; nothing is written
  back to GitHub, so `reference/connectors.md` §1.3's "escalate to write only when auto-status-write
  ships" is not triggered and no installer has to re-approve anything.

## Capabilities

### New Capabilities

- `status-automation`: the opt-in per-team setting and its since-epoch semantics; the two supported
  transitions and the exhaustive guard ladder (off, pre-epoch, untriaged, canceled, backward, no
  edge, newer human intent); the system principal that performs the write and the shared mutator it
  goes through; the relationship to divergence when automation is on, off, or blocked; and the
  admin surface's keyboard and theming contract.

### Modified Capabilities

- `connectors`: the `WorkGraphMutation` union's `upsertPullRequest` variant now additionally drives
  issue status for opted-in teams, entirely inside `packages/schema` — so the "a second connector
  needs no feature-code change" scenario now covers status automation too. The admin connector
  settings surface gains the per-team automation section and its non-admin rejection.
- `issue-tracking`: `issue` gains `last_human_status_at`, stamped by every status-writing shared
  mutator except the system principal's; the reality-strip/divergence requirement is restated so
  that divergence is explicitly the behaviour when automation is off **or blocked**, with the seam's
  exported signatures and its `DivergenceKind` union both unchanged.
- `teams`: `team` gains `auto_status_since`, written only by a new admin-gated `team.setAutoStatus`
  shared mutator and readable by every member of the workspace under the existing team read scope.
- `local-first-sync`: both new columns replicate under the scopes their tables already have (team
  workspace-wide to members, issue team-scoped), no new synced entity and no new query; and the
  server-only system-principal write path is stated as a first-class part of the mutation model
  rather than an `apps/` convention.
- `self-host-deploy`: status automation adds no container, no job, no environment variable and no
  provider scope — it is one nullable column an admin flips in the UI.

## Impact

- **Schema** (`packages/schema`): forward-only migration **`0016_auto_status`** — two nullable
  `timestamptz` columns (`team.auto_status_since`, `issue.last_human_status_at`), the latter
  backfilled from `issue.updated_at` in the same migration so pre-existing issues are not treated
  as never-touched-by-a-human. Both added to the hand-written Kysely `DB` interface, to the Zero
  schema as `number().optional()`, and to the drift test. New
  `packages/schema/src/zero/auto-status.ts` (the pure `decideAutoStatus` ladder plus the transaction
  helper that applies it through `mutators.issue.setStatus`). `context.ts` gains the exported
  `SYSTEM_ACTOR_ID` / `SYSTEM_AUTH_CONTEXT`. `work-graph.ts`'s `upsertPullRequest` case calls the
  helper. Four status-writing mutators (`issue.create`, `issue.setStatus`, `issue.move`,
  `issue.routeIssue`) stamp the new column. One new mutator `team.setAutoStatus`, which therefore
  needs a `MUTATOR_TOOL_KINDS` classification (`write`) and an args entry in `ai-tools.ts` — the
  registry is exhaustive by construction and its test fails otherwise.
- **Server** (`apps/server`): `jobs/cycles.ts` drops its local `SYSTEM_CTX` for the shared one. No
  new route, no new job, no new queue, no change to `connectors/github/`.
- **Web** (`apps/web`): a "Status automation" section in `settings/connectors-view.tsx`, driven by
  Zero (the team rows are already synced) rather than the REST admin surface the rest of that page
  uses — the setting is a synced column, so the toggle is optimistic and costs no round trip.
- **UI** (`packages/ui`): **none**. The toggle reuses the existing `Button` in the same shape as the
  connector Enable/Disable control; no new component, no new token.
- **Dependencies**: **none**. No catalog entry, no container, no env var.
- **Docs:** `apps/docs/src/content/docs/features/auto-status.md` (new — what fires, what never
  fires, how to turn it on, and how it relates to the divergence flag),
  `apps/docs/src/content/docs/features/delivery-signals.md` (divergence reframed as the
  automation-off/blocked behaviour), `apps/docs/src/content/docs/self-hosting/github-connector.md`
  (a pointer to the per-team toggle and the since-epoch guarantee),
  `apps/docs/astro.config.mjs` (one sidebar entry), `README.md` ("What works today"),
  **`ROADMAP.md` (the wedge line at 10 — it currently over-promises; row 8's false "PR linking +
  auto-status" claim; the Post-v1 Phase 2 entry at 60; a new row 14 and the "Where v1 actually
  stands" paragraph)**, **`VISION.md` (Phase 2 at 87 — "automatic status transitions" moves out of
  Phase 2 with a note that the opt-in half shipped in Phase 1)**, and `TECHSTACK.md` (the connector
  framework row, so the firewall claim names the behaviour a second connector inherits).
  `.env.example` is deliberately untouched and that is asserted, not assumed.

## Non-goals

- **Automation that is on by default, or a workspace-wide switch.** Both were considered and
  refused: the first silently rewrites a status a person deliberately set on the day they upgrade,
  the second forces one team's working agreement onto every other team in the workspace.
- **PR closed-unmerged → any status.** A PR closed without merging means anything from "superseded
  by a better branch" to "abandoned approach" to "wrong base". There is no target that is right more
  often than it is wrong, and `computeDivergence`'s existing `status_ahead_of_pr` already marks the
  In Review issue whose PR went away.
- **Draft PR → In Progress.** The signal it carries — work has started — is already visible on the
  issue row the moment the PR chip appears. A status write would add a second, redundant statement
  of the same fact, and would fire on nearly every issue in teams that open drafts at branch
  creation. Addable later with no schema change if a team asks for it.
- **Any backward transition, and any new divergence kind to compensate for its absence.** A Done
  issue that later acquires an open PR is a follow-up, a revert, or a docs PR far more often than it
  is a mistake; firing yapm's defining glyph on it would make the glyph noisy, and DESIGN.md's
  "restraint is itself the differentiator" outranks completeness here.
- **Writing anything back to GitHub** — no PR comment, no label, no check, no status write to the
  provider. The connector stays read-only and its App scopes do not move.
- **A notification, an inbox row, or a comment when a transition fires.** Status changes notify
  nobody today; a machine-driven one that emailed the whole team on every merge would be the worst
  possible first automation. The issue row's reality strip is the explanation.
- **A per-issue "moved by automation" badge or an activity feed.** yapm has no activity feed and
  this change does not introduce one; the badge would cost a second timestamp column to distinguish
  "automated" from "stale human" for a marginal signal the reality strip already gives.
- **Per-team transition configuration** (choose your own source state, target state, or event). That
  is the workflow-scheme labyrinth VISION §"What yapm is not" names by name. One switch.
- **Deploy-driven or CI-driven transitions** (deploy succeeded → Done, CI red → reopen). No
  issue↔deployment edge is modelled, and CI health is a property of a PR that is already covered by
  the merge transition. Phase 2 territory.
- **Any per-person record of who or what moved an issue**, including counting automated versus
  manual transitions per assignee. Team-level only, and here the honest answer is level-none.
- **Retroactive application on enable.** Turning automation on affects events from that moment
  forward. There is no "catch up my board" sweep, and adding one later would be a separate,
  deliberate, explicitly-confirmed action.
