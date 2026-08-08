## MODIFIED Requirements

### Requirement: YOURS shows only the signed-in user's own work and says so

The YOURS band SHALL list the signed-in user's in-flight issues in this team (assignee =
viewer, status unfinished, not in triage), ordered by last movement, each row carrying the
issue-list anatomy: status glyph, key, title, reality track, and a two-line bifact whose
phrases come from the **shared phrase dictionary** defined in the reality-vocabulary
capability, in that dictionary's personal register. The band SHALL NOT hold a phrase table of
its own: the strings it speaks and the strings the issue list speaks SHALL resolve from one
dictionary keyed by one classifier over the delivery signal and the divergence computation, so
the two surfaces cannot drift apart.

Rows whose signal shows an open pull request awaiting review SHALL collapse into a single "N of
yours are waiting on others" row carrying the waiting ages. A "No reviews owed" reciprocal line
SHALL render only when no open pull request linked to the team's issues awaits review at all,
and SHALL fold otherwise — it never renders a claim the data cannot verify. The band SHALL close
with a mono derivation footnote ending "your work only — never compared", and every clause of
the footnote SHALL be true of the rendered derivation.

When the viewer has no in-flight issues, the band SHALL render a single warmth line instead of
an empty list, with a doorway to the ready work only while the READY FOR YOU band renders; on a
fully quiet day the READY band has folded, so the warmth line stands alone — a doorway SHALL NOT
point at a band that cannot render. The band SHALL never render another person's work, name, or
count.

#### Scenario: In-flight rows with delivery reality

- **WHEN** the viewer holds three unfinished issues in the team, one approved-and-unmerged,
  one in progress, one with failing checks
- **THEN** YOURS renders three rows whose say/git bifacts derive from each issue's own
  delivery signal, ordered by most recent movement

#### Scenario: The band speaks the shared dictionary

- **WHEN** YOURS renders a row for an issue whose checks are failing
- **THEN** its phrase resolves from the shared dictionary's personal register for the same key
  the issue list would resolve in its neutral register, and no second phrase table exists for
  that fact

#### Scenario: Waiting work collapses

- **WHEN** two of the viewer's issues have open pull requests awaiting review
- **THEN** those two collapse into the "2 of yours are waiting on others" row with their
  waiting ages

#### Scenario: Empty YOURS is warmth, not apology

- **WHEN** the viewer has no unfinished issue in the team
- **THEN** the band renders one warmth line and no table — with a Runway doorway when the
  READY FOR YOU band renders, and without one when that band has folded

#### Scenario: The lens is personal, never comparative

- **WHEN** any state of the team is rendered
- **THEN** the YOURS band contains no other user's identity or per-person count, and the
  footnote ends "your work only — never compared"
