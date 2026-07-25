# Real-Time Collaborative Retrospective Board — Implementation Research & Design Proposal for yapm

**Status:** Research + **design proposal** (Phase-2 feature; not yet on the locked roadmap). Everything in the "Proposed…" sections is a proposal for discussion, not a committed spec.
**Author:** research/author subagent
**Date:** 2026-07-25
**Scope:** data model, real-time multiplayer via Zero, phase state machine, anonymity, action-items → tracked issues, keyboard/theming fit.

---

## 0. TL;DR (the load-bearing findings)

1. **A retro is a cycle- and team-scoped meeting object** that owns a phase state machine (`brainstorm → group → vote → discuss → actions → closed`). Everything editable is gated by the current phase. This mirrors Parabol's open-source model (`reflect → group → vote → discuss`). [Parabol](https://www.parabol.co/agile/retrospectives/), [Parabol async retro](https://www.parabol.co/blog/asynchronous-retrospectives/)
2. **Zero makes live cards / votes / grouping almost free**: they are just rows. Optimistic local writes + background sync + reactive `useQuery` give you multiplayer with no bespoke WebSocket/OT/CRDT layer. This is the same mechanism yapm already uses for issues/board/cycles. [Zero](https://zero.rocicorp.dev/), [Zero mutators](https://zero.rocicorp.dev/docs/mutators)
3. **The single hardest constraint is anonymity.** Zero read permissions are **row-level and filter-based only — there is NO column-level read permission** ([Zero permissions docs, verified](https://zero.rocicorp.dev/docs/permissions)). You therefore **cannot** sync a card row to clients while "hiding" its `author_id` column. A synced row is fully readable in the client's local Zero DB (IndexedDB). **Anonymity must be enforced by not shipping the author identity to clients at all** — store the author→card binding in a **server-only, non-synced table** (or a column the retro's read-query deliberately never selects into the synced view). Any design that keeps `author_id` on the synced `retro_card` row and "strips it for display" is a **privacy bug**, not an implementation detail.
4. **Presence and a shared countdown timer are ephemeral, high-churn state.** Zero (as of this research) has **no first-class presence primitive** (unlike InstantDB's `db.room(...)` / Liveblocks) — UNVERIFIED that one has shipped. Two viable options: (a) model presence as short-lived heartbeat rows in Postgres/Zero, or (b) run a tiny sidecar ephemeral channel. The timer is best modeled as **durable state** (`timer_ends_at` on the retro), not per-tick messages — each client computes remaining time locally from a synced end-timestamp.
5. **Closing the loop is the yapm-native differentiator**: a retro action item is converted into a real tracked **issue**, assigned to the **next cycle** and the team, via the same mutators + permissions humans already use. This is the retro equivalent of "reality over ritual" — the retro's output lands in the work graph instead of a forgotten doc.

---

## 1. What real retro tools actually model (evidence)

Surveyed: EasyRetro, TeamRetro, Parabol (open source), GoRetro, Neatro, Echometer, Miro/Mural templates.

Consistent building blocks across all of them:

| Concept | What every tool has | Source |
|---|---|---|
| **Board + columns** | A board with named columns/categories chosen from a *format/template* (Start-Stop-Continue, Mad-Sad-Glad, 4Ls, Went-well/Didn't/Actions, Sailboat, etc.) | [EasyRetro](https://easyretro.io/), [TeamRetro](https://www.teamretro.com/) |
| **Cards** | Sticky-note cards authored by participants, one per idea, live-added | [TeamRetro](https://www.teamretro.com/) |
| **Anonymity toggle** | Board-level "show card's author" flag; optionally per-card anonymity even when the board shows authors | [GoRetro anonymity](https://www.goretro.ai/help-articles/anonymity-options), [Parabol #2806](https://github.com/ParabolInc/parabol/issues/2806) |
| **Voting** | Dot voting with a per-participant vote budget; sort by votes | [Neatro top-10](https://www.neatro.io/blog/free-retrospective-tools/), [TeamRetro](https://www.teamretro.com/) |
| **Grouping / clustering** | Drag cards together (or auto-group) to merge duplicates into a cluster before/for voting | [TeamRetro automatic grouping](https://www.teamretro.com/) |
| **Action items** | Actions proposed during discuss, tracked over time, often exported to Jira/GitHub/Trello | [EasyRetro export](https://easyretro.io/), [TeamRetro action list](https://www.teamretro.com/) |
| **Timer** | A shared meeting timer to time-box phases | [Echometer/Parabol feature grids](https://echometerapp.com/en/retrospective-tools-online/) |
| **Phases** | A guided facilitator flow through stages | Parabol below |

**Parabol's phase model (open source, the reference)** — reflect → group → vote → discuss, with an optional actions/takeaways step and async variants that spread the same phases over days. [Parabol retrospectives](https://www.parabol.co/agile/retrospectives/), [async retro](https://www.parabol.co/blog/asynchronous-retrospectives/), [post-mortem 6-step](https://www.parabol.co/blog/how-to-run-a-post-mortem/). Optional anonymity + an effective timer are called out as core Parabol features. [Echometer comparison](https://echometerapp.com/en/retrospective-tools-online/)

**Design takeaway for yapm:** adopt the Parabol-style phase machine (it's the industry-validated shape), keep the format/template as a light column-set chooser, and make the closing action-item step land in yapm's issue tracker rather than an export.

---

## 2. yapm stack recap (what we're mapping onto)

From `ROADMAP.md` / `DESIGN.md` / `VISION.md`:

- **Sync:** Zero (Rocicorp) — local-first, optimistic writes, reactive queries; "multiplayer sync is free." Row-level sync permissions already used (`workspace-auth`).
- **DB:** Postgres behind Zero; **pg-boss** for scheduled jobs (already powers cycle auto-rollover and connector webhooks).
- **Auth:** better-auth; workspace → teams → roles (admin/member/viewer, viewer free).
- **Existing entities to reuse:** `team`, `cycle` (team-scoped, per-team number, status upcoming/active/completed, auto-rollover), `issue` (status/priority/labels/assignee/TipTap/comments), `user`.
- **UI:** `packages/ui`, Tailwind v4 `@theme` + Base UI, strictly-tokenized (Warm/Focused/Editorial presets + accent), keyboard-first + command palette, dnd-kit + fractional indexing already in use for the board.
- **Principles that bind this feature:** team-level only, **never individual surveillance** (VISION #4); free means free; reality over ritual (retro output → work graph).

Every primitive a retro needs (rows, drag/reorder via fractional index, live queries, keyboard nav, tokens, cycles, issues) **already exists** in yapm. A retro is largely a recomposition, not new infrastructure — the genuinely new work is the phase machine, the anonymity boundary, and presence/timer.

---

## 3. Proposed entity model (design proposal)

All tables are **team-scoped** (a retro belongs to exactly one team) and permission-anchored on team membership, matching how `cycle` is already scoped. IDs are the project's standard id type (assume `text`/ULID). Ordering fields use the **fractional-index** string convention already used by the board.

### 3.1 `retro` (the meeting object)

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `team_id` | fk → team | scope + permission anchor |
| `cycle_id` | fk → cycle (nullable) | the cycle being reflected on; nullable for ad-hoc retros |
| `next_cycle_id` | fk → cycle (nullable) | default target for action-item issues (see §7) |
| `title` | text | e.g. "Cycle 14 Retro" (auto-derivable from cycle) |
| `format` | enum/text | template key: `start_stop_continue`, `mad_sad_glad`, `4ls`, `wentwell_didnt_action`, `sailboat`, `custom` |
| `phase` | enum | `brainstorm │ group │ vote │ discuss │ actions │ closed` (state machine, §6) |
| `facilitator_id` | fk → user | who can advance phases (plus team admins) |
| `is_anonymous` | boolean | board-level anonymity default (§5) |
| `allow_per_card_anonymity` | boolean | let authors mark individual cards anon even on a named board |
| `votes_per_participant` | int | dot-vote budget (default e.g. 3–5) |
| `timer_ends_at` | timestamptz (nullable) | shared timer target; null = not running (§4.4) |
| `timer_duration_s` | int (nullable) | last-set duration, for pause/resume UX |
| `created_by` | fk → user | |
| `created_at` / `updated_at` | timestamptz | |
| `closed_at` | timestamptz (nullable) | set when phase → closed |

### 3.2 `retro_column` (categories per format)

Columns are **rows, not hardcoded** — so a `custom` format and future template editing are free, and the tokenized theme can style each column by its own accent.

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `retro_id` | fk → retro | |
| `key` | text | stable key (`start`, `stop`, `mad`, `glad`, `wind`, `anchor`…) |
| `title` | text | display label |
| `sort` | fractional-index | column order |
| `accent_token` | text (nullable) | optional per-column semantic token, not a hardcoded color |

Seeded from a `format` template at retro creation (a plain server-side map format→columns).

### 3.3 `retro_card` (the sticky note) — **synced, author-free when anonymous**

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `retro_id` | fk → retro | |
| `column_id` | fk → retro_column | |
| `group_id` | fk → retro_group (nullable) | null = ungrouped (§3.4) |
| `body` | text | card text (plain or TipTap-lite) |
| `sort` | fractional-index | ordering within column/group |
| `is_anonymous` | boolean | resolved anonymity of THIS card |
| `author_display_id` | fk → user (**nullable**) | **populated ONLY for non-anonymous cards.** For anonymous cards this is NULL on the synced row — clients literally never receive the author. |
| `created_at` / `updated_at` | timestamptz | |

**Critical:** there is no "hidden author" column on this synced row. See §5 for how the author is retained server-side for permissions without ever syncing it.

### 3.4 `retro_group` (cluster of merged cards)

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `retro_id` | fk → retro | |
| `column_id` | fk → retro_column | a group lives in one column |
| `label` | text (nullable) | optional cluster title (e.g. "flaky CI") |
| `sort` | fractional-index | |

Grouping = set `retro_card.group_id`. A group with one card is fine; deleting the last card can auto-dissolve the group (server mutator invariant).

### 3.5 `retro_vote` (dot vote)

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `retro_id` | fk → retro | |
| `target_type` | enum | `card │ group` (usually vote on groups after grouping) |
| `target_id` | id | card or group id |
| `voter_id` | fk → user | **needed for budget enforcement; see anonymity note §5.4** |
| `created_at` | timestamptz | |

One row per dot. Budget = count of a voter's rows in this retro ≤ `retro.votes_per_participant`, enforced in the mutator. **Vote counts are public; who voted is not displayed** (surveillance-safe, VISION #4).

### 3.6 `retro_action` (the outcome; becomes an issue)

| Column | Type | Notes |
|---|---|---|
| `id` | id PK | |
| `retro_id` | fk → retro | |
| `group_id` / `card_id` | fk (nullable) | provenance: which discussion produced it |
| `body` | text | the action statement |
| `assignee_id` | fk → user (nullable) | proposed owner |
| `target_cycle_id` | fk → cycle (nullable) | defaults to `retro.next_cycle_id` |
| `issue_id` | fk → issue (**nullable**) | set once converted → tracked issue (§7) |
| `created_at` | timestamptz | |

### 3.7 `retro_presence` (ephemeral, optional) — see §4.3

| Column | Type | Notes |
|---|---|---|
| `retro_id` + `user_id` | composite PK | one row per participant |
| `phase_seen` | text | last phase the client rendered |
| `focus_target` | id (nullable) | card/column the user is "on" (light presence) |
| `last_seen_at` | timestamptz | heartbeat; stale rows pruned by pg-boss |

**ER sketch**

```
team 1──* retro *──1 cycle (reflected)   retro *──1 cycle (next → actions target)
retro 1──* retro_column 1──* retro_card *──1 retro_group
retro 1──* retro_vote (→ card|group)
retro 1──* retro_action ──0..1 issue ──1 cycle(next)
retro 1──* retro_presence (ephemeral)
```

---

## 4. Real-time multiplayer via Zero

### 4.1 Why Zero makes the happy path trivial

In Zero, **reads and writes happen locally and sync in the background**; a `useQuery` result is reactive and updates as rows change from any client. [Zero home](https://zero.rocicorp.dev/). So:

- **Live cards:** `z.mutate.retroCard.insert(...)` renders instantly for the author (optimistic) and appears for everyone else on next sync tick. No card-broadcast code.
- **Live votes:** insert/delete a `retro_vote` row; every client's `count()`-style query re-renders. Vote tallies are "just a query."
- **Live grouping:** dragging card A onto card B is a single `update retro_card set group_id=…, sort=…` — the exact single-write, fractional-index move pattern yapm's board already uses (change #4). No new drag infra.
- **Live reorder:** fractional index → one write per move, no cascading renumber.

This is the same reactive-query + optimistic-mutation model already shipping in yapm's issue list, board, and cycles, so the retro inherits the sub-100ms feel for free.

### 4.2 Writes go through mutators (not raw table writes)

Zero's **custom mutators** run arbitrary auth/validation/business logic on the write path and can run **server-specific code / raw SQL** when `tx.location === 'server'`. [Zero mutators](https://zero.rocicorp.dev/docs/mutators). Every retro write is a named mutator so we can enforce: team membership, current-phase legality (§6), vote budget, anonymity author-stripping, and group invariants. Mutators also let us **override on the server** (e.g., strip/replace the author, write audit rows) exactly as the docs' `posts.update` server-override example shows.

### 4.3 Presence (live cursors / "who's here" / typing)

Zero has no documented first-class presence room API (contrast [InstantDB `db.room` presence/typing](https://www.instantdb.com/docs/presence-and-topics) and Liveblocks). **UNVERIFIED** that Zero ships one. Two proposals:

- **Option A (recommended, no new infra): presence-as-rows.** A `retro_presence` row per participant, updated on a throttled heartbeat (every ~5–10s and on focus change). A `useQuery` over presence gives the "N people here / who's on which card." Prune stale rows with a pg-boss job (yapm already runs pg-boss). Cost: extra write churn — mitigate with coarse granularity (presence at column/phase level, not pixel cursors) which is plenty for a retro.
- **Option B (later, if fidelity needed): sidecar ephemeral channel** (a tiny WS service or the app server's SSE) for pixel cursors / typing, keeping high-churn data out of Postgres. More infra; conflicts with yapm's "3-container, deployable in minutes" value — **defer unless users ask.**

**Recommendation:** ship coarse presence-as-rows first (fits the 3-container constraint), leave pixel cursors as a deferral.

### 4.4 The shared timer — model as durable end-time, not ticks

Do **not** broadcast per-second ticks. Store `timer_ends_at` (+ `timer_duration_s`) on `retro`. A "start 5-min timer" mutator sets `timer_ends_at = now()+5m`; every client renders `remaining = timer_ends_at - clientNow` locally and counts down with a local `setInterval`. Pause = write remaining back to `timer_duration_s`, null out `timer_ends_at`. This is one row, syncs like anything else, and is robust to clock skew if the server stamps `now()` (do the arithmetic server-side in the mutator). Facilitator-only via mutator check.

### 4.5 The genuinely tricky bits (and answers)

| Tricky bit | Why it's hard with a sync engine | Proposed handling |
|---|---|---|
| **Anonymity while synced** | A synced row is fully readable in the client's IndexedDB; column-level read hiding does **not** exist in Zero ([verified](https://zero.rocicorp.dev/docs/permissions)). "Strip on display" is a lie if `author_id` is on the synced row. | Never sync the author for anon cards. See §5. |
| **Concurrent grouping** | Two facilitators drag the same card into different groups at once. | `group_id` is a single FK; last-write-wins is acceptable and self-heals (both writes are valid group memberships; the card ends in one group). Use fractional index for intra-group order to avoid reorder conflicts. Optionally lock grouping to facilitator in `group` phase (§6) to remove the race entirely. |
| **Vote double-spend** | Optimistic local insert lets a client exceed budget before sync. | Enforce budget in the **server** mutator (authoritative); client optimism may briefly show an over-budget dot that the server rejects → Zero rolls back the optimistic write. Show remaining-budget from a live count so the UI self-limits. |
| **Phase races** | Someone edits a card just as facilitator advances the phase. | Phase legality checked in the mutator against the **current** `retro.phase` at apply time on the server; illegal writes rejected and rolled back. UI also hides disallowed affordances per phase. |
| **Timer skew** | Per-tick sync would be chatty and drift. | Durable `timer_ends_at`, local countdown (§4.4). |
| **Presence churn** | High-frequency writes bloat the DB/sync. | Coarse, throttled heartbeats + pg-boss pruning (§4.3). |

---

## 5. Anonymity — the crux (design proposal)

### 5.1 The constraint, stated precisely

- Zero **read permissions are filter-based and row-level**: a query either returns a row (whole) to a client or it doesn't. **No column/cell-level read permissions.** ([Zero permissions, verified quote:](https://zero.rocicorp.dev/docs/permissions) "Read permissions in Zero are filter-based… either entire rows sync to the client or they don't—there's no mechanism to sync partial rows with hidden columns.")
- Therefore: **if `author_id` is a column on the synced `retro_card` row, every participant's browser has it in local storage.** Inspecting IndexedDB or the Zero client reveals it. Anonymity would be cosmetic only.

### 5.2 Proposed solution: split identity off the synced row

Keep the **synced** `retro_card` author-free for anonymous cards (`author_display_id = NULL`, §3.3). Retain the true author for permissions/moderation in a place clients never sync:

- **Option 1 — server-only sidecar table `retro_card_author` (`card_id → author_id`)** that is **excluded from every client-facing Zero query** (no read permission grants it; Zero only syncs what a query selects). The app server (mutators, `tx.location==='server'`, raw SQL per the docs) reads it to authorize edits/deletes and for facilitator moderation. Because no synced query ever references it, it never reaches a client. This is the cleanest "server strips author for display but retains for permissions."
- **Option 2 — dual columns with a restricted view:** `author_id` (server-only, never in a synced query) + `author_display_id` (nullable, synced). Simpler schema, but riskier: one careless `select *` query leaks it. **Prefer Option 1** — physical separation makes the leak structurally impossible.

### 5.3 Write path

`createCard` mutator: given `retro.is_anonymous` (or a per-card anon flag when `allow_per_card_anonymity`), set `retro_card.author_display_id = is_anon ? null : ctx.userID`, and **always** write `retro_card_author(card_id, author_id = ctx.userID)` (server side). Edit/delete mutators check `retro_card_author.author_id === ctx.userID` OR facilitator/admin — authorization works even though the client can't see the author.

### 5.4 Anonymous votes

`retro_vote.voter_id` is needed to enforce per-person budget and to let a user retract their own dot. But **who voted must never be displayed** (VISION #4 anti-surveillance). Two proposals:

- **If display anonymity is enough:** keep `voter_id` on a **server-only** vote table; sync only an aggregate (`retro_vote_tally(target_id → count)`) to clients, recomputed in the mutator. Clients see counts, never voters. Strongest privacy; costs a tally table.
- **If self-visible-only is enough:** sync vote rows but filter the read query so a client only ever receives **its own** vote rows plus aggregate counts. Row-level filter fits Zero naturally (`where voter_id = ctx.userID`), but requires a separate synced aggregate for totals since a client can't count rows it can't see.

**Recommendation:** server-only voter identity + synced tally. It is the only option that is robust against a user reading their local DB, and it matches the "team metrics, never individual surveillance" principle at the storage layer, not just the UI.

### 5.5 Reveal (optional)

Some tools reveal authors after voting/close. If yapm wants this, it's a **phase-gated read**: on `closed`, a mutator can copy `retro_card_author.author_id` into `author_display_id` **only if** `retro.is_anonymous` was set to reveal-on-close. Default: never reveal (safest, matches principle). Make reveal an explicit, logged facilitator choice, not a default.

---

## 6. Phase state machine (design proposal)

```
brainstorm ──▶ group ──▶ vote ──▶ discuss ──▶ actions ──▶ closed
     ▲__________|_________|__________|            (facilitator may step back)
```

- **Linear forward** by default; **facilitator (or team admin) may step back** one phase (e.g., reopen grouping). `phase` lives on `retro`; transitions are a `advancePhase`/`setPhase` mutator that only the facilitator/admin may call.
- **Phases gate what's editable** — enforced in **each write mutator** (authoritative) AND reflected in the UI (hide affordances):

| Phase | Allowed writes | Blocked |
|---|---|---|
| `brainstorm` | create/edit/delete **own** cards; (optionally) cards hidden from others until reveal | grouping, voting, actions |
| `group` | move cards into groups, label groups, reorder | creating new cards (optional lock), voting |
| `vote` | insert/retract **own** votes within budget | editing cards, grouping |
| `discuss` | create/edit `retro_action`; reorder by votes (read-only board) | new cards, new votes, regrouping |
| `actions` | finalize actions, set assignee + target cycle, **convert → issue** (§7) | card/vote edits |
| `closed` | read-only; (optional one-time reveal) | all edits |

- **Why enforce in the mutator, not just UI:** with optimistic local writes, a client could issue a write for a disallowed phase; only a server-side check against the current `retro.phase` is authoritative. Zero rolls back the rejected optimistic write.
- **Brainstorm "hidden until reveal"** (a common facilitation nicety — you can't see others' cards while writing your own): implement as a read filter — during `brainstorm`, the card read query returns only `own` cards (or only card existence/count for others); on phase advance to `group`, the query opens up. This is a natural Zero row-level read filter keyed on phase + `ctx.userID`. Note this needs the **server-only author table** (§5.2) so "own" can be computed even for anonymous cards — another reason to prefer Option 1.

---

## 7. Closing the loop: action item → tracked issue (the yapm differentiator)

This is where a retro stops being a whiteboard and becomes part of the work graph — the retro analogue of VISION #3 "reality over ritual."

**Proposed `convertActionToIssue` mutator:**

1. Input: `retro_action.id`.
2. Server checks: caller is team member; retro phase ∈ {`discuss`, `actions`, `closed`}; action not already converted (`issue_id IS NULL`).
3. Create an `issue` **through the same issue-creation path/mutator humans use** (so it inherits status defaults, triage rules, permissions, reality-strip layout, etc.):
   - `team_id = retro.team_id`
   - `title = retro_action.body` (first line) + description linking back to the retro
   - `assignee_id = retro_action.assignee_id`
   - `cycle_id = retro_action.target_cycle_id ?? retro.next_cycle_id` → lands the work in the **next cycle**
   - a label like `retro` (optional), and a backlink comment/relation to the source retro + group.
4. Set `retro_action.issue_id = <new issue id>` so the retro shows the action as "tracked → #123" with live status (via a `related('issue')` query — the issue's status now updates on the retro card automatically).

**Consequences (all free because it's one graph):**
- Actions become first-class work with assignee, cycle, and status — not an exported CSV. (Contrast EasyRetro/TeamRetro which *export* to Jira/GitHub; yapm creates natively.) [EasyRetro export](https://easyretro.io/), [TeamRetro](https://www.teamretro.com/)
- Next cycle's retro can show "actions from last retro and whether they shipped" by querying issues created from the prior retro — a genuinely native follow-through view.
- Auto-rollover already handles unfinished cycle work, so an unfinished retro action (now an issue) rolls over like any other issue.

**Bulk variant:** `actions` phase offers "convert all" → one mutator loop server-side.

---

## 8. Keyboard-first + tokenized-theme fit

**Keyboard (reuses existing command-palette + list-nav infra):**
- `c` new card in focused column; `Enter` submit + stay (rapid capture); arrow keys move focus card→card/column→column (same list-nav primitives as the issue list).
- `v` toggle a vote on the focused target; number keys could allocate multiple.
- `g` then drag-key / move-to-group command; grouping also available via command palette ("Group with…").
- Facilitator: `]` / `[` advance / step-back phase; `t` start/stop timer — all command-palette discoverable.
- Convert action: `⌘/Ctrl+Enter` on a focused action → creates issue (mirrors submit conventions).
- Everything is also a command-palette entry (yapm's "command palette everywhere," VISION #1).

**Theming (must obey the tokenized system, DESIGN.md):**
- Cards, columns, group chips, vote pips, phase stepper, timer all reference **semantic tokens only** — no hardcoded colors. Per-column accents use `retro_column.accent_token` (a token key, not a hex).
- Status of a converted action's issue renders with the existing status tokens (honey/indigo/green), so the retro visually matches the tracker.
- Works in Warm/Focused/Editorial + custom accent, light and dark, with the auto-contrast on-accent text token — anonymity/vote badges must pass WCAG in both modes like everything else.
- Reuse the issue-row primitive's density (~44px) for action rows so a retro's action list reads like a mini issue list.

---

## 9. Zero permission wiring (proposal summary)

| Table | Read (row filter) | Write (mutator checks) |
|---|---|---|
| `retro`, `retro_column`, `retro_group` | team members of `retro.team_id` | facilitator/admin for phase/timer/format; members can't advance phase |
| `retro_card` (synced, author-free for anon) | team members; **during `brainstorm`, filter to own cards** (needs server-only author, §5/§6) | author (via server-only author table) or facilitator/admin; phase-gated |
| `retro_card_author` (**server-only**) | **no client read permission — never synced** | server mutators only |
| `retro_vote` voter identity | **server-only**; clients get synced **tally** only | budget + phase enforced server-side |
| `retro_vote_tally` (synced aggregate) | team members | written by vote mutators |
| `retro_action` | team members | members can propose in discuss/actions; convert-to-issue reuses issue permissions |
| `retro_presence` | team members | self only; pruned by pg-boss |

Anchors on the same team-membership row-permission model shipped in `workspace-auth`; mutators follow the `ctx.userID` + server-override pattern from the [Zero mutators docs](https://zero.rocicorp.dev/docs/mutators). Read filtering follows Zero's filter-based read model ([permissions docs](https://zero.rocicorp.dev/docs/permissions)); the older declarative `definePermissions`/`preMutation` style ([marmelab, Feb 2025](https://marmelab.com/blog/2025/02/28/zero-sync-engine.html)) is an alternative surface but the **key constraint (no column-level reads) holds either way** — confirm against whichever Zero version yapm pins. **UNVERIFIED:** exact current Zero API names/signatures drift between betas; check the pinned `@rocicorp/zero` version.

---

## 10. Open questions / deferrals

- **Presence fidelity:** coarse rows now vs. sidecar cursors later (§4.3) — recommend coarse first to preserve 3-container simplicity.
- **Reveal-on-close:** ship as opt-in facilitator action or omit entirely (default: never reveal).
- **Async retros** (Parabol supports multi-day) — the phase machine + timer already allow it; just don't force same-session. Low extra cost, could be a fast-follow. [Parabol async](https://www.parabol.co/blog/asynchronous-retrospectives/)
- **Auto-grouping** (semantic clustering) — TeamRetro/others do it; would want the BYO-key AI (change #9) rather than a bundled model. Natural post-AI add. [TeamRetro auto grouping](https://www.teamretro.com/)
- **Templates/custom formats** — the `retro_column`-as-rows model already supports custom; a template editor UI is deferrable like the theme editor.
- **Exact Zero presence API existence** — UNVERIFIED; treat presence as app-modeled until confirmed against the pinned version.

---

## Sources

- Zero — home / concept: https://zero.rocicorp.dev/
- Zero — mutators (custom mutators, server overrides, raw SQL): https://zero.rocicorp.dev/docs/mutators
- Zero — permissions (filter-based, row-level, no column-level reads): https://zero.rocicorp.dev/docs/permissions
- Zero — when to use (fine-grained read/write permissions): https://zero.rocicorp.dev/docs/when-to-use
- marmelab — Zero permissions/`definePermissions` example (older declarative surface, Feb 2025): https://marmelab.com/blog/2025/02/28/zero-sync-engine.html
- Parabol — retrospective phases (reflect→group→vote→discuss): https://www.parabol.co/agile/retrospectives/
- Parabol — async retrospectives (phases over days): https://www.parabol.co/blog/asynchronous-retrospectives/
- Parabol — post-mortem 6-step: https://www.parabol.co/blog/how-to-run-a-post-mortem/
- Parabol — disable/optional anonymity (issue #2806): https://github.com/ParabolInc/parabol/issues/2806
- GoRetro — anonymity options ("show card's author" toggle): https://www.goretro.ai/help-articles/anonymity-options
- TeamRetro — grouping, dot voting, action list, timer: https://www.teamretro.com/
- EasyRetro — anonymous feedback, columns, export to Jira/Trello: https://easyretro.io/
- Neatro — free retro tool feature survey (voting importance): https://www.neatro.io/blog/free-retrospective-tools/
- Echometer — tool comparison (Parabol anonymity + timer as core): https://echometerapp.com/en/retrospective-tools-online/
- InstantDB — presence/cursors/typing API (contrast; presence primitive Zero lacks): https://www.instantdb.com/docs/presence-and-topics
