# email-delivery Specification

## Purpose
TBD - created by archiving change notifications. Update Purpose after archive.
## Requirements
### Requirement: A provider-neutral mailer seam with two implementations

The system SHALL define a provider-neutral `Mailer` interface in `apps/server` and SHALL ship two
implementations of it: an **SMTP** transport driven by `SMTP_URL`, and an **HTTPS** transport
driven by a Resend API key.

The interface SHALL be shaped around *"send this rendered message to these recipients"* — a
subject, an HTML body, a plain-text body, and a recipient list — and SHALL NOT expose transport
concepts such as connections, envelopes, MIME parts or header bags. Neither implementation's
vocabulary SHALL leak into the interface, so that a third transport can be added by implementing
the interface alone.

The HTTPS transport SHALL be implemented as a single authenticated JSON request using the platform
`fetch`, without adding a vendor SDK. It exists because some hosts block outbound SMTP ports
entirely, on which SMTP cannot be made to work at all and an HTTPS sender is the only path out.

Adding an outbound mail client SHALL NOT change the three-container contract: a mailer is an
outbound client inside the existing app container, not a service.

#### Scenario: One rendered message, either transport

- **WHEN** the same notification digest is sent through the SMTP transport and through the HTTPS
  transport
- **THEN** both receive the identical rendered subject, HTML body and plain-text body, because
  rendering happens once and above the transport

#### Scenario: The interface names no transport concept

- **WHEN** the `Mailer` interface is inspected
- **THEN** it describes recipients and a rendered message only, with no SMTP- or HTTP-specific type
  in its signature

#### Scenario: Container count is unchanged

- **WHEN** the compose stack is inspected
- **THEN** it still defines exactly three services and requires no mail container

### Requirement: Deterministic transport selection, and clean disablement

The system SHALL select the active transport from configuration at boot: the HTTPS transport when
a Resend API key is set, the SMTP transport when only `SMTP_URL` is set, and — when **both** are
set — the HTTPS transport, logging once that the SMTP setting is being ignored and naming it.

When **neither** is configured, email SHALL be cleanly disabled: no mailer is constructed, no email
job is registered, boot succeeds and logs once that email is disabled, and every send site is a
no-op. A malformed value for a configured variable SHALL fail boot naming the variable and the
expected format, so that "absent" and "invalid" are never confused.

Sending SHALL never crash the process: a transport error SHALL be caught and logged at the call
site that owns retry semantics, and SHALL never produce an unhandled rejection or a job that
retries forever.

#### Scenario: Neither transport configured

- **WHEN** the app boots with no SMTP URL and no Resend key
- **THEN** it starts successfully, logs that email is disabled, and every in-app feature that does
  not require email works fully

#### Scenario: Both transports configured

- **WHEN** the app boots with both an SMTP URL and a Resend key
- **THEN** the HTTPS transport is used and a single warning names the ignored SMTP variable

#### Scenario: A malformed transport setting fails fast

- **WHEN** the app boots with a malformed transport value
- **THEN** it exits non-zero before listening, printing the variable name and expected format

### Requirement: Templates are rendered with react-email, once, above the transport

Email bodies SHALL be produced by react-email templates in a dedicated workspace package that
imports no transport and reads no environment. Each template SHALL return a rendered message
carrying subject, HTML and plain text, with the plain text produced from the **same** render so
that the two parts can never describe different things.

The package SHALL be independently unit-testable without booting a server or opening a network
connection.

#### Scenario: HTML and text agree

- **WHEN** a template is rendered
- **THEN** it yields an HTML body and a plain-text body derived from the same source, both naming
  the same subjects and links

#### Scenario: Rendering needs no server and no network

- **WHEN** the template package's tests run
- **THEN** they render messages and assert their content without a database, a server, or a network
  call

### Requirement: Email deep links use a configured public base URL

The system SHALL require a `PUBLIC_URL` — the browsable base URL a human clicks in an email —
whenever an email transport is configured, along with a From address, validated at boot and failing
fast by name when either is missing. Every link in an outgoing email SHALL be built from
`PUBLIC_URL`.

`PUBLIC_URL` SHALL be distinct from the authentication base URL and from the SPA's trusted browser
origin, whose meanings are documented so the three are not conflated.

#### Scenario: Configuring a transport without a public URL fails fast

- **WHEN** the app boots with a transport configured but no `PUBLIC_URL`
- **THEN** it exits non-zero before listening, naming `PUBLIC_URL` and what it is for

#### Scenario: Links point at the configured origin

- **WHEN** an email is rendered on an instance whose `PUBLIC_URL` is a real domain
- **THEN** every link in it resolves against that domain and none contains a localhost origin

#### Scenario: No transport, no requirement

- **WHEN** the app boots with no transport configured and no `PUBLIC_URL`
- **THEN** boot succeeds, because the variable is required only when email is in use

### Requirement: Delivery is testable without credentials or a network

Both transports SHALL be constructed with an injectable send mechanism so that tests exercise them
end-to-end with a double. The test suite SHALL make no real network call and SHALL require no SMTP
server and no API key, in CI or locally.

#### Scenario: CI sends nothing

- **WHEN** the full test suite runs in CI, which has no SMTP server and no API key
- **THEN** every mailer test passes, asserting what was handed to the transport rather than that a
  message arrived

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

