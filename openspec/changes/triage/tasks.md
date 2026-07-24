# triage — tasks

## 1. Schema: triage flag on issue

- [x] 1.1 Migration `0007_triage`: `issue.needs_triage` (`boolean not null default false`) + composite index on `(team_id, needs_triage)`
- [x] 1.2 `issue.needs_triage` in the Kysely `DB` interface (`Generated<boolean>`) and the Zero schema (`needsTriage` boolean)
- [x] 1.3 Extend the schema-drift test (`issue.needs_triage`); verify against live Postgres
- [x] 1.4 Seed a couple of demo triage issues so the inbox has content on first run

## 2. Mutators + queries

- [x] 2.1 `issue.create` gains optional `needsTriage`; `issue.flagTriage` (enter triage) + unit tests
- [x] 2.2 `issue.acceptTriage`, `issue.declineTriage` (clear flag; decline → canceled) + unit tests
- [x] 2.3 `issue.routeIssue` (clear flag + status/assignee/cycle/labels, same-team validated) + unit tests
- [x] 2.4 `triage.inbox` team-scoped synced query; exclude `needsTriage` from `issues.byTeam`/`issues.mine`; export the new surface

## 3. Triage view (web)

- [x] 3.1 `TriageView` + `/teams/$teamId/triage` route: keyboard-first inbox with Accept (A), Decline (D), Route (R)
- [x] 3.2 View-switch entry (List ↔ Board ↔ Cycles ↔ Triage)
- [x] 3.3 Command-palette triage actions (Accept / Decline / Route / Send to triage), writer-gated

## 4. Documentation

- [x] 4.1 `apps/docs` Triage feature page + sidebar + home link; `pnpm --filter @yapm/docs build` passes
- [x] 4.2 Root docs: README (status + features), ROADMAP (#6 status)

## 5. Tests + gates

- [x] 5.1 E2E (Playwright, `apps/web/e2e/triage.spec.ts`): keyboard-first flag → inbox → accept/decline/route; correct across all three presets in light and dark; existing suites still pass
- [x] 5.2 `pnpm turbo lint typecheck test build` green (with live Postgres); boundary guard clean
