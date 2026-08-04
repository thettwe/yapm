## ADDED Requirements

### Requirement: Mentioning teammates from the description and the comment thread

The detail surface SHALL support `@`-mentions in the description editor, the comment composer and
the comment editor, supplying candidates from the team member list the surface already builds for
the assignee control — no additional query and no network request on the keystroke.

Mentions SHALL be inserted, navigated and dismissed by keyboard alone. Dismissing the mention popup
SHALL NOT discard the draft being written or close the detail surface.

Rendered mentions in a saved description or comment SHALL display the mentioned person's current
name, resolved from synced data, and SHALL be non-interactive text rather than a link or a tab stop
— there is no person route in this version, and a link would inject focus stops into the middle of
prose.

Work-graph placement: mentions live inside the existing team-scoped `issue.description` and
`comment.body` documents; no new entity is introduced on this surface. Permission story: mention
candidates and mention notifications are constrained to people who can already read the issue, and
the constraint is enforced server-side rather than by the control.

#### Scenario: Mention a teammate in a comment by keyboard

- **WHEN** a member types `@`, types part of a teammate's name, and presses Enter
- **THEN** a mention is inserted into the draft with no pointer interaction, and posting the comment
  notifies that teammate once

#### Scenario: Dismissing the popup preserves the draft

- **WHEN** a member has typed a comment, opens the mention popup, and presses Escape
- **THEN** the popup closes while the drafted comment text and the detail surface both remain

#### Scenario: A mention chip is not a tab stop

- **WHEN** a member tabs through a rendered description containing mentions
- **THEN** focus does not stop on the mentions

#### Scenario: A viewer sees mentions but cannot write them

- **WHEN** a `viewer` opens an issue
- **THEN** rendered mentions display normally and no editor is available in which to create one —
  while the follow control remains available to them, because a viewer can be mentioned and must be
  able to stop following

### Requirement: Following an issue is visible and reversible from the issue itself

The detail surface SHALL show whether the viewer currently follows the issue and SHALL let them
toggle it, fully keyboard-operable, with its state exposed to assistive technology.

When the viewer follows the issue, the surface SHALL make clear that they will receive updates and
how to stop, so that a subscription created automatically by a mention is discoverable and
reversible from the thing it subscribes them to.

The control SHALL reflect only the viewer's own subscription. No follower count and no list of who
follows the issue SHALL be shown to anyone, including a workspace admin.

#### Scenario: A mentioned person finds and uses the unfollow control

- **WHEN** a person who was auto-subscribed by a mention opens the issue and reaches the control by
  keyboard
- **THEN** the control shows that they are following, and activating it stops further updates for
  them

#### Scenario: Following state updates within the interaction budget

- **WHEN** the control is activated
- **THEN** its state changes optimistically without waiting on the network

#### Scenario: No follower list is exposed

- **WHEN** any user, including a workspace admin, opens the issue
- **THEN** no follower count and no subscriber list is rendered
