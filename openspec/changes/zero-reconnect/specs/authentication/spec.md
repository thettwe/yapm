## MODIFIED Requirements

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
