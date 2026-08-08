## MODIFIED Requirements

### Requirement: A keyboard-first Triage view and command-palette actions

The system SHALL provide a Triage inbox view at `/teams/$teamId/triage`, reached from the
application frame's Triage destination (and its `g t` shortcut) rather than from a per-page view
switcher, listing the team's awaiting-triage issues with keyboard-first Accept, Decline, and Route
actions, correct across all three theme presets in light and dark. The command palette SHALL offer
Accept, Decline, Route, and Send-to-triage on the targeted issue(s), gated to writers. All triage
actions SHALL be hidden and never written for a viewer.

Work-graph placement: a destination over the same team-scoped issues, filtered to the inbox.
Permission story: actions rendered and dispatched only for `canWrite`.

#### Scenario: Keyboard-first accept from the inbox

- **WHEN** a member focuses an inbox issue and presses the accept key
- **THEN** the issue is accepted optimistically and leaves the inbox without a full-page reload

#### Scenario: Viewer sees a read-only inbox

- **WHEN** a viewer opens the Triage view
- **THEN** the inbox is readable but the accept/decline/route controls are absent

#### Scenario: Reached from the frame rather than a view switcher

- **WHEN** a member on any team surface activates the deck's Triage destination, by pointer or by
  pressing `g` then `t`
- **THEN** the Triage view opens with the Triage destination marked as the current page
