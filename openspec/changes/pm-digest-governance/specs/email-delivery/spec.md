## ADDED Requirements

### Requirement: A second template and a second sweep under the same mailer seam

The system SHALL render the disclosure ready notice with the same template library, above the same
provider-neutral mailer seam, as every other message the product sends. It SHALL NOT add a second
transport, a second sender abstraction or a direct provider call.

The template's input type SHALL have **no field capable of carrying digest content** — the absence
of the field is the enforcement, not a rule the caller is asked to follow — and the delivery sweep
SHALL be registered on the existing shared job scheduler, never a new instance.

A transport failure SHALL be caught inside the sweep, logged, and leave the affected notices
unstamped for the next window; it SHALL NOT throw out of the worker and SHALL NOT disturb other
scheduled work sharing the process.

#### Scenario: Clean disablement with no transport

- **WHEN** no email transport is configured
- **THEN** no disclosure delivery sweep is registered, boot succeeds, the in-app notice still
  works, and nothing throws

#### Scenario: A broken transport degrades rather than breaks

- **WHEN** the configured transport fails while delivering a disclosure notice
- **THEN** the failure is logged, the notice remains unstamped and eligible for the next window, the
  worker does not throw, and the notification delivery sweep in the same process is unaffected

#### Scenario: The rendered message is asserted, not the template

- **WHEN** the disclosure notice is rendered for a digest with content
- **THEN** the assertion is made against the rendered HTML and text, which contain the application
  link and no substring of the content
