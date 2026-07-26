# authentication Specification

## Purpose
TBD - created by archiving change workspace-auth. Update Purpose after archive.
## Requirements
### Requirement: Free authentication methods

The instance SHALL support email/password, GitHub OAuth, and OIDC/SSO sign-in, provided by better-auth running in-process on its native Kysely layer sharing the app's single Postgres pool. All three methods SHALL be free and ungated — no method, and no SSO in particular, may be behind a seat cap, license key, plan, or upsell UI. Enabling a method SHALL be env-driven (a method whose credentials are unset is simply unavailable, not paywalled).

Work-graph placement: authentication produces the `user` identity (owned by better-auth) that the `workspace_member` role edge and every assignee, creator, and mention reference points at. Sync/permission story: `user`, `session`, `account`, `verification`, and `jwks` are auth-internal tables; only `user` is exposed to the Zero client, read-only, and only member profiles are readable (see workspace-membership).

#### Scenario: Email and password sign-in

- **WHEN** a user submits valid email/password credentials
- **THEN** better-auth establishes a session and the app loads as that user

#### Scenario: GitHub OAuth sign-in

- **WHEN** `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are configured and a user completes the GitHub authorization flow
- **THEN** a `user` and linked `account` are created (or matched) and a session is established

#### Scenario: OIDC/SSO sign-in is available and free

- **WHEN** an OIDC/SSO provider is configured
- **THEN** a user can sign in through it and reach the app with no license key, seat check, or upgrade prompt anywhere in the flow

#### Scenario: An unconfigured method is absent, not paywalled

- **WHEN** GitHub OAuth credentials are not set
- **THEN** the GitHub option is not offered, and no UI implies it requires payment or an upgrade

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

