# triage — design

## Triage is an orthogonal boolean, never a status

The six statuses (Backlog, Todo, In Progress, In Review, Done, Canceled) are fixed and not configurable (VISION). Triage is a distinct question — "has a human sorted this incoming issue yet?" — so it is a separate column, `issue.needs_triage` (`NOT NULL DEFAULT false`), orthogonal to `status`. An issue in the inbox still has a normal status (typically Backlog); it is merely held out of the normal views until triaged. This keeps the status enum untouched, keeps the drift/introspect surface simple, and lets a connector drop an issue into the inbox with whatever status it maps to.

Polarity is deliberate: the default is `false`, so every pre-existing issue is not in triage and no backfill is needed; the board/list/cycles behavior for existing content is unchanged.

## Entering triage: created-into or flagged

Two entry paths, both reserved to make the later connectors work a pure reuse:

1. **Created into triage** — `issue.create` gains an optional `needsTriage` (default false). A connector importing an externally-created issue sets it true; nothing else changes.
2. **Flagged** — `issue.flagTriage(id)` sets `needs_triage = true` on an existing issue, moving it into the inbox. This backs the command-palette "Send to triage" and is the manual counterpart to a connector.

## Held out of the normal views

`issues.byTeam` and `issues.mine` gain `.where('needsTriage', false)`, so awaiting-triage issues do not appear in the list, the board, or "assigned to me" — they live only in the inbox until accepted. The `issues.detail` query is unchanged, so an inbox issue can still be opened directly. A new `triage.inbox({ teamId })` is the exact team-scoped counterpart: `needs_triage = true`, oldest first (FIFO), under the same `teamScoped` predicate — a non-member gets an empty result (deny by empty query), a viewer reads but cannot act.

## Three inbox actions, each a shared mutator clearing the flag

All three run the issue-mutator gate exactly (`canWrite` in the caller, then `loadIssueForWrite` — auth before existence, team-scoped, generic not-authorized for missing/wrong-team). Each is optimistic and sub-100ms because it only updates existing rows:

- **Accept** (`issue.acceptTriage`) — `needs_triage → false`, status untouched. The issue becomes a normal issue and reappears in the list/board at its current status.
- **Decline** (`issue.declineTriage`) — `needs_triage → false` and `status → canceled`. A rejected incoming issue leaves the inbox as a canceled record, never deleted.
- **Route** (`issue.routeIssue`) — accept-with-routing. In one atomic write it clears the flag and applies any of: a `status` (a normal status), an `assigneeId` (same-team-validated, nullable), a `cycleId` (same-team-validated, nullable), and `addLabelIds` (each same-team-validated, upserted onto the issue). Reuses the same-team validation the existing assign/setCycle/addLabel mutators use, so routing cannot cross a team boundary.

Accept/Decline are idempotent in effect (re-running on an already-cleared issue is a harmless no-op update); Route is last-writer-wins on the fields it sets.

## Keyboard-first Triage view

`/teams/$teamId/triage` reuses the view shell (Switcher, ViewSwitch, ConnectionStatus, ThemeControls, UserMenu) and the tokenized `IssueRow`. j/k (and arrows) move focus; **A** accepts, **D** declines, **R** opens the route dialog on the focused issue; Enter opens the issue. The route dialog offers status/assignee/cycle/labels and commits with a single `routeIssue`. All actions are hidden and never written for a viewer (`useMembership().canWrite`). No hardcoded colors or fonts — only Warm tokens.

## Reuse

Triage reuses: the `teamScoped` synced-query predicate (unchanged), `assertTeamAccess`/`loadIssueForWrite`/`assertTeamMember`, the tokenized `IssueRow`/status/priority visuals, the command palette, the view-switch, `runMutation`/`newId`, and the theme tokens. The only schema surface added is one boolean column.

## Decisions made during implementation

- **Boolean `needs_triage`, not a nullable `triaged_at` or a `triage_state` enum.** A single boolean answers the only question v1 asks ("is this in the inbox?") with zero ambiguity — a nullable timestamp cannot distinguish "never needed triage" from "not yet triaged" without a second marker, and an enum reserves states nothing consumes yet (YAGNI). The column is the orthogonal state the task calls for; richer triage sub-states remain an additive follow-up.
- **Triage issues are excluded from `issues.byTeam`/`issues.mine`, not merely tagged.** An inbox that also clutters the main list defeats its purpose (this is the Linear model). Because the default is `false`, no existing test issue is hidden, so the exclusion regresses nothing; new triage issues are simply held until accepted. `issues.detail` stays unfiltered so an inbox issue is still openable.
- **Route stays within the issue's team.** The task lists "team" among routable fields, but moving an issue between teams collides with the per-team `number` (it would go stale or collide) and the team-scoped sync/permission model. Rather than a risky renumber inside a mutator, `routeIssue` assigns assignee/cycle/labels/status within the team and team reassignment is deferred to the connectors work, which owns cross-team ingestion.
- **Accept keeps the status; Decline forces Canceled.** "It becomes a normal backlog/todo issue" means the flag clears and the existing status (typically Backlog) stands — Accept does not force a status, so a connector's mapped status is preserved. Decline is the only action that mutates status, to Canceled, so a rejected issue leaves a canceled audit record instead of vanishing.
- **Composite `(team_id, needs_triage)` index, not a partial index.** Kysely 0.28's `createIndex().where(...)` types the predicate column to the indexed columns only, so a partial index on `team_id` filtered by `needs_triage` does not typecheck under the hand-written `Kysely<unknown>` migration signature (no TS-compiler-API tooling is allowed to work around it). A plain composite index on `(team_id, needs_triage)` serves the inbox query's `team_id = ? and needs_triage = true` equally well and stays fully typed.
- **Route navigates from the command palette; the route dialog lives in the Triage view.** Accept, Decline, and Send-to-triage are one-shot mutators, so the palette dispatches them directly on the ambient target. Route needs field selection (status/assignee/cycle/labels), which is a form, so the palette's "Route…" navigates to the Triage view where the keyboard-first **R** action opens the routing dialog — keeping the palette free of a bespoke multi-field sub-page.
- **The `sendToTriage` e2e helper filters the palette and selects with Enter, never clicks the unfiltered item.** cmdk re-sorts its list on every render while Zero sync settles, so a click on the deep, unfiltered "Send to triage" row raced the DOM re-sort and detached mid-click (60s timeout). This matches the codebase's existing convention (`issues.spec.ts` filters to "Progress" then presses Enter to "avoid click races with cmdk's re-render churn"; `board.spec.ts` fills the palette before clicking). The helper now types the action to narrow the list to one stable option and fires it off the input — immune to the churn and more keyboard-first than a click.
- **The preset-coverage e2e drives the appearance control, not a localStorage write + reload.** The synced user preference is the source of truth for the theme (`theme/provider.tsx`), so injecting `yapm:pref` and reloading loses to the sync override the moment any preference has been persisted — and `theme.spec` (alphabetically first) persists `focused` for the shared admin account, so the triage theme test read back `focused` regardless of the injected preset. The board/cycles/issues preset tests only pass because they run before `theme.spec` on a fresh DB. The triage test now selects each preset through the real `Appearance settings` popover (authoritative, echoed back by the sync) and toggles the device-local mode, making it deterministic in isolation and in the full suite irrespective of any persisted preference.
