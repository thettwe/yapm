## ADDED Requirements

### Requirement: The client owns its own recovery, not the library's reload

The sync client SHALL supply handlers for the conditions the library would otherwise resolve by
reloading the page — an unknown client (`ClientStateNotFound`) and a version mismatch
(`UpdateNeeded`). A reload issued by the library takes the page out from under whoever is using it,
which can discard an edit in progress, and it does so without the product having said anything.

An unknown client SHALL recover through the product's own recovery path. A version mismatch SHALL
be surfaced to the user rather than applied silently, and SHALL NOT reload while a write is in
flight. The recovery state SHALL be distinguishable from an ordinary outage in what the statusline
renders, drawn from theme tokens, correct in all three presets in light and dark, and operable by
keyboard.

This closes a real gap: the library's reload-on-error default is undocumented in this repository,
and two changes were scoped without knowing it existed. It is **not** the cause of the E2E failures
those changes were scoped to fix — the reload markers are zero in every environment measured — and
any documentation of this requirement SHALL state both facts together, so that a reader inherits
the evidence rather than the story.

#### Scenario: An unknown client recovers without a reload

- **WHEN** the sync client reports that the server does not know this client
- **THEN** the product's recovery path runs, and the page is not reloaded by the library

#### Scenario: A version mismatch is surfaced, not applied under the user

- **WHEN** the sync client reports that the client version is no longer supported
- **THEN** the user is told, and the page is not reloaded while a write is in flight

#### Scenario: Recovery is distinguishable from an outage

- **WHEN** the client is recovering from an unknown-client or version condition
- **THEN** the statusline says so in a way that differs from an ordinary disconnection, using only
  theme tokens, and remains keyboard-operable

### Requirement: A test may not silently reload the page

The E2E harness SHALL fail any test whose page reloads without the test having asked for it,
naming the reload and its reason. This is a tripwire rather than a fix: a reload chain was
hypothesized as the cause of a long-running failure and survived a merged proposal before being
falsified by measurement, and a cheap assertion that would have killed the theory in an afternoon
is worth keeping after the theory dies.

#### Scenario: An unrequested reload fails the test that saw it

- **WHEN** a page under test reloads without the test navigating or reloading deliberately
- **THEN** the test fails, naming the reload and the reason the client gave for it

#### Scenario: A deliberate navigation is not a reload

- **WHEN** a test navigates or reloads on purpose
- **THEN** the watcher stays quiet
