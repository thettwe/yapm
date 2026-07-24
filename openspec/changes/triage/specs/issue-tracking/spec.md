## ADDED Requirements

### Requirement: Issue carries an orthogonal triage flag

An issue SHALL carry a `needs_triage` boolean (`NOT NULL DEFAULT false`), orthogonal to its status. It SHALL be settable through `issue.create` (optional `needsTriage`) and `issue.flagTriage`, and cleared through `issue.acceptTriage`, `issue.declineTriage`, and `issue.routeIssue`. Each triage mutator SHALL be gated exactly as other issue writes (viewers rejected, team-scoped, cross-team routed fields rejected). Issues with `needs_triage = true` SHALL be excluded from `issues.byTeam` and `issues.mine` and returned only by `triage.inbox`.

Work-graph placement: a boolean flag on `issue`, orthogonal to `status`. Permission story: `canWrite` + team access; routed assignee/cycle/label validated same-team.

#### Scenario: Triage issues are held out of the normal list

- **WHEN** an issue has `needs_triage = true`
- **THEN** it is absent from `issues.byTeam` and `issues.mine` and present in `triage.inbox`, and clearing the flag returns it to the normal list

#### Scenario: Routing applies same-team fields atomically

- **WHEN** a writer routes an inbox issue with a status, a same-team assignee, a same-team cycle, and same-team labels
- **THEN** the flag clears and all fields apply in one optimistic write, and any cross-team field is rejected
