## MODIFIED Requirements

### Requirement: One attention number over four disjoint exception classes

The NEEDS ATTENTION band SHALL present exactly four exception classes, each issue assigned
to at most one class by precedence: (1) done in git but not on the board — the work-graph
divergence `status_behind_merge`; (2) checks failing — rolled-up CI health failing; (3)
waiting on review over a day — an open, unapproved linked pull request whose review age
exceeds 24 hours; (4) new in triage — the team's triage inbox rows. Each class row SHALL be
a doorway to the surface where the exception is fixed and SHALL carry drawn evidence
derived from the same rows (broken reality track with the `//` mark; tick-bar with failing
ticks and the failure age; the waiting ages; triage dots).

The attention count SHALL be the sum of the four class counts (a distinct-issue count by
construction) and SHALL be the single value rendered everywhere the number appears — not
only on this page, but anywhere in the application, including the frame's deck badge and its
statusline. The digest SHALL consume that value from the shared derivation rather than
computing its own, so the page and the frame cannot disagree. When the count is zero the
band SHALL fold and the hero's "need attention" status word SHALL be absent.

#### Scenario: The number agrees with itself

- **WHEN** one issue diverges (`status_behind_merge`), one issue's checks are failing, two
  open pull requests have waited over a day, and three issues sit in triage
- **THEN** the band header, the hero status word, and every other occurrence of the
  attention number all render 7

#### Scenario: The number agrees with the frame

- **WHEN** the team home is open with that same set of exceptions
- **THEN** the deck's attention badge and the statusline's attention segment also render 7,
  from the same derivation

#### Scenario: An issue in two classes counts once

- **WHEN** an issue both diverges as `status_behind_merge` and has failing checks
- **THEN** it appears only in the divergence class and contributes exactly one to the
  attention count

#### Scenario: Zero folds the band

- **WHEN** no issue matches any exception class and triage is empty
- **THEN** the NEEDS ATTENTION band does not render and no attention number appears
  anywhere on the page

#### Scenario: Exception rows are doorways

- **WHEN** a member activates the triage exception row with Enter
- **THEN** the triage view for the team opens
