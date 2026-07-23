# authentication Specification

## ADDED Requirements

### Requirement: Free authentication methods

The instance SHALL support email/password, GitHub OAuth, and OIDC/SSO sign-in, provided by better-auth running in-process on its native Kysely layer sharing the app's single Postgres pool. All three methods SHALL be free and ungated — no method, and no SSO in particular, may be behind a seat cap, license key, plan, or upsell UI. Enabling a method SHALL be env-driven (a method whose credentials are unset is simply unavailable, not paywalled).

Work-graph placement: authentication produces the `user` identity (owned by better-auth) that the `workspace_member` role edge and every future assignee/creator/mention reference points at. Sync/permission story: `user`, `session`, `account`, `verification`, and `jwks` are auth-internal tables; only `user` is exposed to the Zero client, read-only, and only member profiles are readable (see workspace-membership).

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

#### Scenario: Sync token is issued to an authenticated caller

- **WHEN** an authenticated client requests the Zero sync token
- **THEN** the server returns a signed JWT whose subject is the caller's verified user id

#### Scenario: Expired sync token is refreshed without a reload

- **WHEN** the sync endpoints reject the client's JWT as expired
- **THEN** the client fetches a fresh token and reconnects the sync socket without a page reload or lost input

#### Scenario: Unauthenticated sync token request is refused

- **WHEN** an unauthenticated caller requests the sync token
- **THEN** the endpoint responds unauthorized and issues no token

### Requirement: Server-side auth context from the verified session

The server SHALL derive the Zero auth context (`{userID, role}`) by verifying the incoming session/JWT locally against better-auth's signing keys and then resolving the caller's workspace role, replacing the foundation placeholder that returned a fixed anonymous member. The `userID` passed to the Zero query/mutate handlers MUST be the verified subject, and clients MUST NOT be able to supply or widen it.

#### Scenario: Context reflects the verified user and role

- **WHEN** a request carries a valid session for a user who is a workspace `member`
- **THEN** the resolved context is that user's id with role `member`, and reads/writes are authorized accordingly

#### Scenario: Invalid or absent credentials yield no authority

- **WHEN** a request carries no valid session
- **THEN** the resolved context grants no read or write authority (queries return empty, mutators reject)

### Requirement: Keyboard-operable authentication surfaces

All sign-in, sign-up, and sign-out surfaces SHALL be fully operable without a pointer: every field and control is reachable by Tab in a logical order, forms submit on Enter, and validation errors are announced to assistive technology.

#### Scenario: Keyboard-only email sign-in

- **WHEN** a user Tabs to the email field, types credentials, Tabs to password, and presses Enter
- **THEN** sign-in completes with no pointer interaction

#### Scenario: Keyboard-only provider sign-in

- **WHEN** a user Tabs to the GitHub or SSO sign-in control and activates it with Enter or Space
- **THEN** the provider flow starts with no pointer interaction
