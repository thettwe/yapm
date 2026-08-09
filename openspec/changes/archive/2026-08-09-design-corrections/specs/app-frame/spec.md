## MODIFIED Requirements

### Requirement: The statusline states the team's day, and the sync state

On a page with a team in context the statusline SHALL state, as labels and numbers only:
the active cycle and its day (`Cycle N, day X of Y`), the count shipped this cycle, the
count of deployments this week, and the attention count. Each segment SHALL fold
individually when the fact behind it is absent — a team with no active cycle shows no cycle
segment rather than a placeholder.

The statusline SHALL carry the connection indicator, right-aligned, as the application's
only such indicator. It SHALL report the sync state, announce reconnection to assistive
technology via a polite live region, and offer a keyboard-operable retry control once the
backoff delay has stretched. No second connection indicator SHALL be rendered anywhere.

The indicator's label SHALL name what the reader has, not what the socket is doing: the
healthy state SHALL read **`Synced`**. Every other state SHALL keep naming its own
condition specifically — connecting, reconnecting, offline, an expired sign-in, a sync
error, and closed are each distinct and SHALL NOT be collapsed into one word. The label
SHALL be produced by the single function that turns a connection state into words, and the
indicator's `data-testid`, its connection-state attribute, its recovery-phase attribute and
its retry control SHALL be unchanged by any wording change, because they are the contract
the end-to-end suite reads.

The statusline SHALL contain no sentences.

#### Scenario: The team's day in one line

- **WHEN** a member with an active cycle on day 9 of 14, 8 issues shipped, 3 deployments
  this week and 4 exceptions opens any page of that team
- **THEN** the statusline reads the cycle and day, 8 shipped, 3 deploys this week and 4
  needing attention, with the sync state right-aligned

#### Scenario: The healthy sync state says Synced

- **WHEN** the sync connection is established on any authenticated page
- **THEN** the statusline's indicator reads `Synced`

#### Scenario: An unhealthy state still says what is wrong

- **WHEN** the connection is connecting, offline, has an expired sign-in, has a sync error or is closed
- **THEN** the indicator names that specific condition rather than the healthy word

#### Scenario: Segments fold rather than placehold

- **WHEN** the team has no active cycle
- **THEN** the cycle-and-day segment is absent and the remaining true segments still render

#### Scenario: One connection indicator, in the statusline

- **WHEN** the sync connection drops on any authenticated page
- **THEN** the statusline's indicator reports the reconnecting state and offers a
  keyboard-reachable retry, and no other connection indicator exists on the page
