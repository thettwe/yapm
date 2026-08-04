## ADDED Requirements

### Requirement: The disclosure audit log is retention-bounded by a scheduled sweep

The system SHALL run a scheduled, bounded retention sweep that deletes disclosure audit records
older than a configured number of days, defaulting to **365**, on a configured cron defaulting to a
nightly run offset from the notification retention sweep.

The sweep SHALL be registered on the **existing** shared background-job instance as an independent
block; the system SHALL NOT create an additional job-scheduler instance, service or container for
it. It SHALL be registered whether or not AI, the PM disclosure switches or an email transport are
configured, because the bound has to hold on an instance that once had disclosure enabled and later
turned it off.

The sweep SHALL delete disclosure audit records and nothing else. It SHALL NOT delete PM digests and
SHALL NOT delete team-internal cycle digests. Running it twice SHALL have the same effect as running
it once.

#### Scenario: A record past the window is swept and one inside it is not

- **WHEN** the retention sweep runs against a workspace holding one disclosure audit record older
  than the configured window and one newer than it
- **THEN** the older record is deleted, the newer record remains, and the count of deleted rows is
  logged

#### Scenario: The delete is targeted

- **WHEN** the retention sweep runs in a workspace that also holds a PM digest and a team-internal
  cycle digest for the same cycle
- **THEN** both digests are untouched and only disclosure audit records are deleted

#### Scenario: Running the sweep twice is safe

- **WHEN** the retention sweep runs a second time with no new records written between the runs
- **THEN** it deletes nothing, does not throw, and leaves the surviving records unchanged

#### Scenario: Retention holds with the feature switched off

- **WHEN** an instance has PM disclosure disabled but holds audit records from when it was enabled
- **THEN** the retention sweep is still registered and still deletes records past the window

### Requirement: An admin-only audit view of what was disclosed, never of who read it

The system SHALL expose an admin-gated read over the disclosure audit log, returning per-team
totals and the most recent disclosure events for the caller's workspace. Each event SHALL carry when
it happened, which event it was, the team it concerned, the acting user where one exists, and the
yapm-computed detail already recorded — the audience size, the run status, which switches changed,
and which team ids a policy write touched.

The read SHALL be refused to any caller who is not a workspace admin **before any disclosure record,
digest, team or configuration value is read**, and the refusal SHALL be identical whether or not the
workspace has ever enabled disclosure, so that it cannot be used to detect the feature's use.

The response SHALL NOT contain any record of a read: no reader identity, no read timestamp, no
per-reader count and no audience list. The system SHALL NOT record disclosure reads anywhere. The
response SHALL NOT aggregate any figure by person — totals are per team only — and SHALL NOT rank,
score or trend any individual.

The surface SHALL be present when the log is non-empty and cleanly absent when it is empty, so an
instance that has never disclosed anything shows no section at all, while an admin who has turned
disclosure off keeps the record of what happened while it was on.

#### Scenario: A non-admin is refused with no oracle

- **WHEN** a member or a viewer requests the disclosure audit read
- **THEN** the request is refused before any record is read, and the refusal is byte-identical to
  the one returned in a workspace that has never enabled disclosure

#### Scenario: An admin reads what was disclosed and to how many

- **WHEN** an admin requests the disclosure audit read after a policy change and a publication
- **THEN** both events are returned with their team, their time, their acting user and their
  yapm-computed detail, and the publication's detail carries the audience size recorded at release

#### Scenario: No reading data is surfaced

- **WHEN** an admin reads the disclosure audit view after named readers have opened a published
  digest
- **THEN** the response contains no reader identity, no read event, no per-reader count and no
  audience list, and no figure in it is aggregated by person

#### Scenario: Nothing disclosed means no section

- **WHEN** an admin opens the AI settings page in a workspace whose disclosure audit log is empty
- **THEN** no audit section is rendered, and no empty state is shown in its place

#### Scenario: The audit surface is fully keyboard-operable

- **WHEN** an admin navigates the AI settings page with the keyboard alone
- **THEN** every element of the audit section is reachable and readable without a pointer, with
  visible focus

### Requirement: Named readers are told a digest was released, by a notice carrying a link only

When a human publishes a PM digest, the system SHALL write one per-recipient notice for each
member of that team's resolved audience at that moment, addressed to them individually, pointing at
the disclosure surface.

The notice SHALL be attributed to the system, never to the individual who released the digest: the
identity of the publisher is recorded in the disclosure audit log, which only an admin reads, and is
not disclosed to a reader outside the team.

When an email transport is configured **and** the instance-level ready-email switch is on, the
system SHALL mail those notices. The mailed body SHALL contain a link to the application resolved
against the configured public base URL, the team name and the cycle name, and **SHALL NOT contain
any part of the digest content** — no summary, no highlight, no risk flag, no evidence label. This
is a deliberate refusal rather than an omission: a mailed artifact sits outside the kill switch,
outside retention and outside the audit log simultaneously, so the notice carries only enough to
decide whether to follow the link into the governed surface.

Entitlement SHALL be re-resolved at send time through the same single resolver that grants the read,
so a recipient dropped from the audience, a team whose sharing was turned off, or a workspace whose
kill switch was set between publication and delivery is not mailed. The system SHALL NOT widen the
existing notification delivery sweep's access predicate to accommodate this, and SHALL NOT hold a
second copy of the entitlement rule.

Each notice SHALL be mailed at most once, SHALL NOT be mailed if the recipient has already read it
in the application, and SHALL be governed by the recipient's existing email preference.

#### Scenario: The mailed body carries a link and no content

- **WHEN** the ready notice is rendered for a published digest whose content carries a summary, a
  highlight and an evidence label
- **THEN** the rendered body contains the link to the disclosure surface and contains no substring
  of the summary, the highlight or the evidence label

#### Scenario: No transport means no mail and no failure

- **WHEN** no email transport is configured
- **THEN** the notice is still written, no delivery sweep is registered, boot succeeds, and nothing
  throws

#### Scenario: Losing entitlement between publication and delivery stops the mail

- **WHEN** a recipient is removed from the team's audience, or the team's sharing is switched off,
  or the kill switch is set, after publication but before the delivery sweep runs
- **THEN** no mail is sent to that recipient

#### Scenario: The notice is attributed to the system

- **WHEN** a member of the producing team publishes a digest
- **THEN** the notices written for the audience carry the system actor, and no reader can learn
  which individual released the digest

#### Scenario: Delivered once, and not at all once read

- **WHEN** the delivery sweep runs twice over the same notice, or the recipient opens it in the
  application before the first sweep
- **THEN** at most one message is sent, and none is sent for a notice already read

### Requirement: The disclosure configuration is env-validated and fails fast by name

The system SHALL validate the retention window, the retention cron and the ready-email switch at
startup, failing with the offending variable's name. The ready-email switch SHALL default to off,
because it is the one path in this feature whose output leaves the governed surface.

Enabling the ready email while the PM disclosure run itself is disabled SHALL fail at boot naming
**both** variables, because it describes mail for an artifact that is never generated.

`.env.example` and the validated schema SHALL agree, enforced by a mechanical check rather than by
convention, with any variable absent from one of them declared in an explicit, commented exception
list.

#### Scenario: An invalid retention window is refused by name

- **WHEN** the instance boots with a retention window of zero
- **THEN** boot fails and the error names the retention variable

#### Scenario: Mail for an artifact that is never generated is refused by name

- **WHEN** the instance boots with the ready email enabled and the PM disclosure run disabled
- **THEN** boot fails and the error names both variables

#### Scenario: The documented environment matches the validated one

- **WHEN** the mechanical environment check runs
- **THEN** every validated variable appears in `.env.example` and every documented variable is
  validated, except those in the declared exception lists
