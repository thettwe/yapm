# authentication Specification

## Purpose
TBD - created by archiving change workspace-auth. Update Purpose after archive.
## Requirements
### Requirement: Free authentication methods

The instance SHALL support email/password, GitHub OAuth, and OIDC/SSO sign-in, provided by
better-auth running in-process on its native Kysely layer sharing the app's single Postgres pool.
All three methods SHALL be free and ungated — no method, and no SSO in particular, may be behind a
seat cap, license key, plan, or upsell UI.

A method SHALL be reported as available only when it is actually **usable on this instance**, and
the sign-in UI SHALL offer exactly the methods reported available. How a method becomes usable
differs by method and the report SHALL reflect what is true rather than a constant: GitHub OAuth is
usable when its client credentials are present in the environment; OIDC/SSO is usable when at least
one provider has been registered **and** its email domain proven. The system SHALL NOT advertise a
sign-in method that cannot complete — an unusable method is **absent**, never a control that leads
nowhere and never an empty state explaining what is missing to a person who cannot fix it.

Every method the instance advertises SHALL have a discoverable, documented configuration path an
operator can actually follow. A capability listed as shipped with no supported way to configure it
SHALL be treated as a defect in the capability, not merely in its documentation.

Work-graph placement: authentication produces the `user` identity (owned by better-auth) that the
`workspace_member` role edge and every assignee, creator, and mention reference points at.
Sync/permission story: `user`, `session`, `account`, `verification`, `jwks` and `ssoProvider` are
auth-internal tables; only `user` is exposed to the Zero client, read-only, and only member profiles
are readable (see workspace-membership). Provider configuration, including client secrets, SHALL
never enter the sync schema.

#### Scenario: Email and password sign-in

- **WHEN** a user submits valid email/password credentials
- **THEN** better-auth establishes a session and the app loads as that user

#### Scenario: GitHub OAuth sign-in

- **WHEN** `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are configured and a user completes the GitHub
  authorization flow
- **THEN** a `user` and linked `account` are created (or matched) and a session is established

#### Scenario: OIDC/SSO sign-in is available and free

- **WHEN** an OIDC/SSO provider is configured and its domain is verified
- **THEN** a user can sign in through it and reach the app with no license key, seat check, or
  upgrade prompt anywhere in the flow

#### Scenario: An unconfigured method is absent, not paywalled

- **WHEN** GitHub OAuth credentials are not set
- **THEN** the GitHub option is not offered, and no UI implies it requires payment or an upgrade

#### Scenario: No provider registered means no SSO control

- **WHEN** an instance has no registered and verified SSO provider
- **THEN** the auth-methods report says SSO is unavailable and the sign-in form renders no SSO
  control at all

#### Scenario: A registered and verified provider makes the control appear

- **WHEN** an admin registers a provider and proves its domain
- **THEN** the auth-methods report says SSO is available and the sign-in form renders the SSO
  control, which starts a flow that reaches that provider

### Requirement: Email verification defaults off

Email verification SHALL default to disabled so a fresh self-hosted instance can onboard users without any SMTP configuration. An instance MAY enable verification when SMTP is configured, but the out-of-the-box default MUST allow email/password sign-up and immediate sign-in with no email round-trip.

#### Scenario: Sign-up without SMTP

- **WHEN** a fresh instance with no SMTP configured has a user sign up with email/password
- **THEN** the account is usable immediately without an email verification step

### Requirement: Session and Zero sync token issuance

On sign-in better-auth SHALL establish a session usable both as a cookie and as a bearer token, and SHALL expose a short-lived JWT for the sync engine via an authenticated endpoint. The web client SHALL obtain that JWT and hand it to the Zero client, refreshing it when the sync endpoints reject it as expired.

The endpoint SHALL additionally report when the issued token expires, and the client SHALL refresh **proactively** — before that expiry, on a schedule derived from the token's own remaining lifetime rather than a hardcoded duplicate of the server's setting — so an idle session does not first have to break the sync connection to be repaired. Because a browser suspends timers while a device sleeps, the client SHALL also re-check on regaining visibility and on regaining network connectivity, and SHALL refresh then if a substantial part of the lifetime has elapsed. Refresh SHALL remain lazy rather than periodic: each new credential value costs the sync layer a re-validation of the live connection, so the client SHALL NOT re-mint more often than the token lifetime requires. If the endpoint reports no expiry (an older server), the client SHALL fall back to a fixed refresh interval shorter than the shortest supported token lifetime.

A **failed** token request SHALL NOT be treated as an absent session: only an explicit unauthorized response means "signed out". A network failure, timeout, server error, or unparseable response SHALL preserve the caller's existing session state and be retried on backoff.

#### Scenario: Sync token is issued to an authenticated caller

- **WHEN** an authenticated client requests the Zero sync token
- **THEN** the server returns a signed JWT whose subject is the caller's verified user id, together with the time at which it expires

#### Scenario: Expired sync token is refreshed without a reload

- **WHEN** the sync endpoints reject the client's JWT as expired
- **THEN** the client fetches a fresh token and reconnects the sync socket without a page reload or lost input

#### Scenario: Token is refreshed before it expires

- **WHEN** an authenticated client holds a sync token whose remaining lifetime has fallen below the refresh threshold
- **THEN** the client mints a replacement before the token expires, and the sync connection is never broken by that expiry

#### Scenario: Waking from sleep re-checks the credential

- **WHEN** a tab regains visibility or the device regains network connectivity after an extended idle period
- **THEN** the client re-checks the token's remaining lifetime and re-mints if it is substantially spent, rather than waiting for a timer that did not fire while suspended

#### Scenario: Unauthenticated sync token request is refused

- **WHEN** an unauthenticated caller requests the sync token
- **THEN** the endpoint responds unauthorized and issues no token

#### Scenario: A failed token request is not a sign-out

- **WHEN** the sync-token request fails with a network error, timeout, or server error for a caller who has a valid session
- **THEN** the caller remains signed in and the request is retried on backoff, rather than being routed to the sign-in page

### Requirement: Server-side auth context from the verified session

The server SHALL derive the Zero auth context (`{userID, role}`) by verifying the incoming session/JWT locally against better-auth's signing keys and then resolving the caller's workspace role, replacing the foundation placeholder that returned a fixed anonymous member. The `userID` passed to the Zero query/mutate handlers MUST be the verified subject, and clients MUST NOT be able to supply or widen it.

Resolution SHALL report **why** there is no context, distinguishing a credential that was never presented from one that was presented and rejected. Both grant no authority, but only the rejected case SHALL cause the sync endpoints to answer unauthorized (see the local-first-sync capability); the absent case SHALL keep resolving to no context with a successful response, which is the signed-out path.

#### Scenario: Context reflects the verified user and role

- **WHEN** a request carries a valid session for a user who is a workspace `member`
- **THEN** the resolved context is that user's id with role `member`, and reads/writes are authorized accordingly

#### Scenario: Invalid or absent credentials yield no authority

- **WHEN** a request carries no valid session
- **THEN** the resolved context grants no read or write authority (queries return empty, mutators reject)

#### Scenario: Absent and rejected credentials are distinguishable

- **WHEN** one request carries no credential and another carries a credential that fails verification
- **THEN** resolution reports the two cases distinctly, so the sync endpoints can answer the first as signed-out and the second as unauthorized

### Requirement: Keyboard-operable authentication surfaces

All sign-in, sign-up, and sign-out surfaces SHALL be fully operable without a pointer: every field and control is reachable by Tab in a logical order, forms submit on Enter, and validation errors are announced to assistive technology.

#### Scenario: Keyboard-only email sign-in

- **WHEN** a user Tabs to the email field, types credentials, Tabs to password, and presses Enter
- **THEN** sign-in completes with no pointer interaction

#### Scenario: Keyboard-only provider sign-in

- **WHEN** a user Tabs to the GitHub or SSO sign-in control and activates it with Enter or Space
- **THEN** the provider flow starts with no pointer interaction

### Requirement: SSO provider administration is workspace-admin-only

Registering, updating, deleting and domain-verifying an SSO provider SHALL require the caller to be
a workspace **admin**. This is the same authority the connector and AI configuration surfaces
already require, resolved from the caller's own `workspace_member` role — the system SHALL NOT
introduce a second notion of administrator.

The refusal SHALL be **authorization-shaped and evaluated before any existence check**: a caller
with no session SHALL be answered unauthorized, a signed-in caller who is not a workspace admin
SHALL be answered forbidden, and neither answer SHALL depend on whether the provider named in the
request exists. A signed-in account with no workspace membership at all — the state an authenticated
non-member occupies at the access gate — SHALL be refused identically to a member and to a viewer.

The identity provider's own credentials SHALL be write-only. No response from the administration
surface SHALL contain a client secret, a private key, or a decryption key; the surface MAY report
that a credential is configured and MAY report a non-identifying fragment of a client id. Rotating a
credential SHALL be done by supplying a new one, never by reading the old one back.

Because provider registration binds an **email domain** to an authorization endpoint, the system
SHALL additionally require proof that the domain is controlled by the operator before that provider
may be used to sign anyone in, and SHALL enforce a bounded limit on how many providers a single
account may register. Domain proof SHALL be obtainable without deploying any service beyond the
three the self-hosting promise allows.

Admin-gating SHALL NOT be a paywall: SSO SHALL remain free, unlimited in users, and free of any
licence key, seat check, plan tier, or upsell surface. The gate limits **who configures** it, not
**who may use** it.

Every control on the administration surface SHALL be fully operable without a pointer, and its
success and failure messages SHALL be announced to assistive technology.

#### Scenario: A signed-in non-admin cannot register a provider

- **WHEN** a signed-in workspace member, a viewer, or an authenticated account with no workspace
  membership submits an SSO provider registration
- **THEN** the request is refused as forbidden, no provider is created, and the answer is the same
  whether or not the submitted provider id already exists

#### Scenario: An anonymous caller cannot register a provider

- **WHEN** a caller with no session submits an SSO provider registration
- **THEN** the request is refused as unauthorized and no provider is created

#### Scenario: The ungated provider-management endpoints are not on the network

- **WHEN** any caller, including a workspace admin, requests the identity library's own SSO
  provider-management paths directly
- **THEN** those paths are not served, and the only path that registers, updates, deletes or
  verifies a provider is the admin-gated one yapm documents

#### Scenario: A workspace admin registers a provider by the documented path

- **WHEN** a workspace admin submits an OIDC provider — issuer, client id, client secret and email
  domain — to the documented administration endpoint
- **THEN** the provider is created, the response carries no secret material, and the response tells
  the admin what DNS record proves control of the domain

#### Scenario: A provider is workspace configuration, not the registering admin's property

- **WHEN** a workspace admin other than the one who registered a provider updates or deletes it
- **THEN** the change is applied, so an admin's departure never strands the workspace's SSO
  configuration

#### Scenario: An unverified domain cannot be used to sign in

- **WHEN** a provider is registered but its email domain has not been proven
- **THEN** no user can complete an SSO sign-in through that provider, and the administration surface
  states what is outstanding

#### Scenario: Configuring SSO is keyboard-only and costs nothing

- **WHEN** an admin Tabs through the SSO settings surface, fills the provider fields, and submits
  with Enter
- **THEN** configuration completes with no pointer interaction, and no seat count, licence key,
  plan, or upgrade prompt appears anywhere in the flow

### Requirement: SSO sign-in remains reachable without a session

The endpoints that **start** an SSO sign-in and that **receive the identity provider's response**
SHALL remain reachable to callers with no session. Gating provider administration SHALL NOT gate
the sign-in flow: the initiation endpoint and every callback, assertion-consumer, logout and
service-provider-metadata endpoint SHALL stay anonymous, because the browser arriving at them has
not signed in yet — that is the point of the flow.

This SHALL be asserted together with the administration gate in a single test, so that a future
tightening of one cannot silently break the other.

#### Scenario: An anonymous user signs in through a verified provider

- **WHEN** a user with no session submits their work email to the SSO sign-in endpoint and a
  verified provider matches that email's domain
- **THEN** the flow starts and the user is sent to that provider's authorization endpoint

#### Scenario: Locking administration does not lock sign-in

- **WHEN** the provider-administration paths refuse an anonymous caller
- **THEN** the sign-in and callback paths still answer that same anonymous caller, and both facts
  are asserted by one test

