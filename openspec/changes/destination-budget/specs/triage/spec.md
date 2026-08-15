## MODIFIED Requirements

### Requirement: A keyboard-first Triage view and command-palette actions

The system SHALL provide a Triage inbox view at `/teams/$teamId/triage`, reached from the
application frame's Triage destination (and its `g t` shortcut) rather than from a per-page view
switcher, listing the team's awaiting-triage issues **oldest first, all of them, with no fold** — a
queue whose purpose is to be emptied SHALL show its own floor.

The Triage destination SHALL sit in the deck's `more` menu, in its permanent list, rather than on
the bar. It is a destination and not a lens: it keeps its own route, its own masthead, its own
verdict keys and its own `g t` binding, and no surface offers it as a view switcher. It sits in the
menu because nothing in the shipped product fills its queue in the ordinary course of work — the
only path that sets `needs_triage` is a member choosing an action on an issue they are already
reading, which forwards work rather than receiving it. When a producer ships — an ingest of
externally-created issues, an inbound path, or a connector that creates them — Triage SHALL be
eligible to return to the bar by a change that names what it displaces, and no re-argument of what
triage *is* SHALL be required to move it back.

Every triage verdict SHALL be reachable and activatable without a pointer: `j`/`k` and the arrow
keys move between waiting issues, `⏎` opens the issue, and `a`, `r` and `d` invoke Accept, Route
and Decline on the issue under decision. The view SHALL be correct across all three theme presets
in light and dark, meeting the contrast bar on every ground it draws.

The command palette SHALL offer Accept, Decline, Route, and Send-to-triage on the targeted
issue(s), gated to writers. All triage actions SHALL be hidden and never written for a viewer.

The masthead SHALL state the page's name, a mono count of the waiting issues, and the ordering —
and SHALL NOT repeat the team name, which the application frame's deck already carries. The
ordering label SHALL NOT be drawn over an empty queue.

The count the masthead states SHALL be the length of the same `triage.inbox` result the team's
attention number counts, so the masthead, the deck badge, the statusline and Team Home can never
disagree about how many issues are waiting.

Work-graph placement: a destination over the same team-scoped issues, filtered to the inbox.
Permission story: actions rendered and dispatched only for `canWrite`; the move between deck tiers
changes no query, no predicate and no row.

#### Scenario: Keyboard-first accept from the inbox

- **WHEN** a member focuses an inbox issue and presses the accept key
- **THEN** the issue is accepted optimistically and leaves the inbox without a full-page reload

#### Scenario: Viewer sees a read-only inbox

- **WHEN** a viewer opens the Triage view
- **THEN** the inbox is readable but the accept/decline/route controls are absent, and the accept,
  route and decline keys are inert

#### Scenario: Reached from the frame rather than a view switcher

- **WHEN** a member on any team surface activates the deck's Triage destination, by opening the
  `more` menu or by pressing `g` then `t`
- **THEN** the Triage view opens with the Triage destination marked as the current page, and no
  view switcher anywhere in the product offers triage as a lens

#### Scenario: The shortcut a member already learned still works

- **WHEN** a member who learned `g t` before the destination moved presses it on any team surface
- **THEN** the same Triage view opens at the same route, and the menu item they can reach by
  pointer draws the same `g t` hint

#### Scenario: The masthead does not repeat the team

- **WHEN** a member opens the Triage view for a team
- **THEN** the masthead states the page name, the mono count and the ordering, and the team's name
  appears in the frame's deck rather than in the masthead

#### Scenario: An empty inbox keeps its place in the deck

- **WHEN** a team has never used triage, so its inbox has been empty since the workspace was
  created
- **THEN** the Triage destination is still listed in the `more` menu, `g t` still opens it, and the
  view draws its own empty state

#### Scenario: One count, everywhere

- **WHEN** a team has issues awaiting triage and no other exception
- **THEN** the masthead's count, the deck's attention badge and the statusline's attention segment
  state the same number
