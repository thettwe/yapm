## ADDED Requirements

### Requirement: Command palette offers triage actions

The command palette SHALL offer Accept, Decline, Route, and Send-to-triage on the focused or selected issue(s), gated to writers. These actions SHALL dispatch the corresponding shared mutators and SHALL be absent for viewers.

Work-graph placement: palette actions over the ambient issue target. Permission story: rendered and dispatched only for `canWrite`.

#### Scenario: Writer triages from the palette

- **WHEN** a writer opens the palette on an inbox issue and picks Accept
- **THEN** the issue is accepted and leaves the inbox

#### Scenario: Viewer sees no triage actions

- **WHEN** a viewer opens the palette on an issue
- **THEN** no triage actions are offered
