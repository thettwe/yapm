## MODIFIED Requirements

### Requirement: Disconnection is visible and lossless

Reads SHALL continue to resolve from the local replica while disconnected. Writes are NOT supported offline (Zero rejects them), so the UI SHALL surface connection state and prevent write attempts that would silently lose user input. On reconnect, syncing resumes automatically.

Recovery SHALL NOT depend on a page reload. The client SHALL recover from every non-terminal broken-sync state, not only from an expired credential: when the sync client reports `needs-auth` or `error` — states from which the sync engine does not retry on its own — the client SHALL re-mint its sync credential and explicitly resume the connection; when it reports `disconnected` beyond a short grace period, the client SHALL re-mint the credential so the sync engine's own retry presents a fresh one. Re-minting a credential whose value is unchanged SHALL still resume a paused connection, so a stalled client can never be left waiting on a value that will never differ.

Recovery attempts SHALL be spaced by exponential backoff with jitter and a bounded maximum delay, and the schedule SHALL reset once the connection is established. A persistent server-side fault SHALL therefore degrade to a calm, bounded retry — never an unbounded retry loop that saturates the CPU or the sync endpoints.

The recovering state SHALL be visible on every authenticated surface, not silent: the connection indicator SHALL report that the client is reconnecting (distinguishing offline, expired sign-in, and sync error), SHALL announce the transition to assistive technology via a polite live region, SHALL offer a keyboard-operable control to retry immediately once the backoff delay has stretched, and SHALL take every color from theme tokens so it renders correctly in every shipped preset in both light and dark.

A failure to reach the server SHALL never be presented as a sign-out: the client SHALL treat only an explicit unauthorized response as "no session", SHALL treat a thrown request error, timeout, server error, or unparseable response as "temporarily unavailable" and retry it, and SHALL bound every credential request with a timeout so a hung request can never leave the app in an indefinite loading state.

#### Scenario: Reading while disconnected
- **WHEN** the network drops
- **THEN** already-synced data continues to render and navigate without errors

#### Scenario: Writes are blocked, not lost
- **WHEN** a user attempts an edit while disconnected
- **THEN** connection state is visible and the edit is prevented or held in the editing surface — never accepted and silently dropped

#### Scenario: Reconnect resumes sync
- **WHEN** connectivity returns
- **THEN** the client resumes syncing and converges with server state without a page reload

#### Scenario: Recovery from a terminal sync error

- **WHEN** the sync engine reports a fatal connection error from which it will not retry by itself
- **THEN** the client re-mints its sync credential, resumes the connection, and converges with server state without a page reload

#### Scenario: A persistent fault degrades to a calm retry

- **WHEN** the sync endpoint keeps failing across repeated recovery attempts
- **THEN** successive attempts are spaced by an increasing, jittered delay up to a bounded maximum, and the client neither saturates the CPU nor retries faster than that bound

#### Scenario: Backoff resets after recovery

- **WHEN** a recovery attempt succeeds and the connection reaches `connected`
- **THEN** the retry schedule resets, so the next unrelated interruption is retried promptly rather than at the previous backed-off delay

#### Scenario: Recovering is announced and keyboard-operable

- **WHEN** the client is reconnecting and the backoff delay has stretched
- **THEN** the connection indicator announces the reconnecting state to assistive technology and exposes a retry control that is reachable and activatable with the keyboard alone, using only theme tokens for color

#### Scenario: A failed credential request does not sign the user out

- **WHEN** the sync-credential request fails with a network error, a timeout, or a server error while the user has a valid session
- **THEN** the user stays signed in, the failure is surfaced as temporarily unavailable with a retry, and the client retries on backoff rather than navigating to the sign-in page

#### Scenario: A hung credential request cannot wedge the app

- **WHEN** the sync-credential request never settles
- **THEN** the request is aborted by its timeout and the app shows an actionable retry state instead of an indefinite loading state

## ADDED Requirements

### Requirement: Sync endpoints reject an invalid credential with an unauthorized status

The synced-query and mutate endpoints SHALL distinguish a credential that is **absent** from one that is **presented and invalid**, because the sync engine treats the two differently.

When a request carries no credential, the endpoints SHALL continue to respond successfully with a null user identity, so a legitimately signed-out client is denied by the empty-query and mutator-rejection paths without being pushed into an authentication loop. When a request carries a credential that fails verification (expired, malformed, or wrongly signed), the endpoints SHALL respond with HTTP **401** and SHALL NOT return a success response carrying a null user identity — a success response asserting an identity that contradicts the caller's connection causes the sync engine to invalidate that connection, which can leave the caller's client group with no validated connection and take down sync for every client on it.

A failure that is not an authentication failure (for example the role lookup failing because the database is unreachable) SHALL keep returning a server-error status rather than being reported as unauthorized, so the client's recovery path retries it instead of re-minting a credential that was never the problem.

#### Scenario: An expired credential is refused, not silently accepted

- **WHEN** the sync engine forwards a bearer credential that has expired
- **THEN** the endpoint responds 401 and does not return a success response carrying a null user identity

#### Scenario: An absent credential is still the signed-out path

- **WHEN** a request arrives at a sync endpoint with no credential at all
- **THEN** the endpoint responds successfully with a null user identity, every query is denied by the empty-query filter, and every mutator rejects

#### Scenario: A valid credential is unaffected

- **WHEN** a request carries a valid, unexpired credential
- **THEN** the endpoint resolves the verified subject and its workspace role exactly as before, and the response is unchanged

#### Scenario: A server fault is not reported as an auth fault

- **WHEN** resolving the auth context fails for a non-authentication reason
- **THEN** the endpoint responds with a server-error status, and the client retries on backoff rather than treating it as an expired credential
