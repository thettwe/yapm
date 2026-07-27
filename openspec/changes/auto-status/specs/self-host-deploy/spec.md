## ADDED Requirements

### Requirement: Status automation adds no container and no configuration

Opt-in status automation SHALL add no container, no service, no job queue, no scheduled task, no
environment variable, and no provider permission scope. Its entire configuration surface SHALL be one
nullable column per team, set from the admin UI. `.env.example` and the configuration reference
SHALL be unchanged by it, and an operator SHALL need to read no runbook to adopt or abandon it:
enabling is one control, disabling is the same control, and disabling restores the previous behaviour
exactly. Upgrading an instance SHALL leave every team's automation off, so the upgrade changes no
issue and no flag.

Work-graph placement: none — this is a deployment property of the status-automation capability.
Permission story: unchanged; the setting is admin-gated and holds no secret.

#### Scenario: The container count does not move

- **WHEN** the deployment is inspected after this change
- **THEN** it is still exactly `app`, `zero-cache`, and `postgres`

#### Scenario: No new environment variable

- **WHEN** the validated configuration schema and `.env.example` are compared before and after this
  change
- **THEN** they are identical, and the feature is configured entirely from the database

#### Scenario: Upgrading changes nothing until someone opts in

- **WHEN** an existing instance is upgraded and the migration runs
- **THEN** every team has automation off, no issue's status changes, and every divergence flag reads
  as it did before

#### Scenario: Turning it off restores the previous behaviour exactly

- **WHEN** an admin disables automation for a team that had it on
- **THEN** no further transition occurs for that team and the divergence flag resumes being the only
  response to a status that disagrees with git
