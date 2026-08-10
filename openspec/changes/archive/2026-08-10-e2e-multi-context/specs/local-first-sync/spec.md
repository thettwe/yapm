## MODIFIED Requirements

### Requirement: Disconnection is visible and lossless

Reads SHALL continue to resolve from the local replica while disconnected. Writes are NOT supported offline (Zero rejects them), so the UI SHALL surface connection state and prevent write attempts that would silently lose user input. On reconnect, syncing resumes automatically.

Recovery SHALL NOT depend on a page reload. The client SHALL recover from every non-terminal broken-sync state, not only from an expired credential: when the sync client reports `needs-auth` or `error` — states from which the sync engine does not retry on its own — the client SHALL re-mint its sync credential and explicitly resume the connection; when it reports `disconnected` beyond a short grace period, the client SHALL re-mint the credential so the sync engine's own retry presents a fresh one. Re-minting a credential whose value is unchanged SHALL still resume a paused connection, so a stalled client can never be left waiting on a value that will never differ.

**The application SHALL own the response to every sync-engine condition whose default handling is a
full-page reload.** The sync engine reloads the page by itself when it is told the client's schema
or protocol version is unsupported, or that the server has no record of this client, unless the
application supplies its own handler for those conditions. The application SHALL supply them, so
that no page in the product is ever reloaded by the sync layer without the product deciding to. A
condition the client can recover from SHALL be recovered from in place, through the same recovery
path as any other broken-sync state. A condition that genuinely requires reloading the running
application — the deployed client being older than the server will serve — SHALL be surfaced to the
user as a visible, dismissible-until-safe prompt rather than an immediate reload, and SHALL NOT
reload while a write is in flight.

Recovery attempts SHALL be spaced by exponential backoff with jitter and a bounded maximum delay, and the schedule SHALL reset once the connection is established. A persistent server-side fault SHALL therefore degrade to a calm, bounded retry — never an unbounded retry loop that saturates the CPU or the sync endpoints.

The recovering state SHALL be visible on every authenticated surface, not silent: the connection indicator SHALL report that the client is reconnecting (distinguishing offline, expired sign-in, and sync error), SHALL announce the transition to assistive technology via a polite live region, SHALL offer a keyboard-operable control to retry immediately once the backoff delay has stretched, and SHALL take every color from theme tokens so it renders correctly in every shipped preset in both light and dark. That indicator SHALL live in the application frame's statusline, right-aligned, and SHALL be the **only** connection indicator in the application — the statusline is on every authenticated surface, so relocating it there widens the guarantee rather than narrowing it.

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

#### Scenario: The sync layer never reloads the page on its own

- **WHEN** the server tells the client its state is unknown, or its schema or protocol version is
  unsupported
- **THEN** the application's own handler runs and the sync engine's built-in page reload does not,
  whichever of those conditions arrives

#### Scenario: An unknown client recovers in place

- **WHEN** the server reports that it has no record of this client
- **THEN** the client discards its local sync state and re-establishes the connection through the
  ordinary recovery path, and the user's page is not reloaded under them

#### Scenario: An out-of-date client is told, not reloaded

- **WHEN** the server reports that the running client is too old to sync
- **THEN** the user is shown that a reload is needed and the page is not reloaded while a write is
  in flight

#### Scenario: A persistent fault degrades to a calm retry

- **WHEN** the sync endpoint keeps failing across repeated recovery attempts
- **THEN** successive attempts are spaced by an increasing, jittered delay up to a bounded maximum, and the client neither saturates the CPU nor retries faster than that bound

#### Scenario: Backoff resets after recovery

- **WHEN** a recovery attempt succeeds and the connection reaches `connected`
- **THEN** the retry schedule resets, so the next unrelated interruption is retried promptly rather than at the previous backed-off delay

#### Scenario: Recovering is announced and keyboard-operable

- **WHEN** the client is reconnecting and the backoff delay has stretched
- **THEN** the connection indicator announces the reconnecting state to assistive technology and exposes a retry control that is reachable and activatable with the keyboard alone, using only theme tokens for color

#### Scenario: The indicator is in the statusline, and there is only one

- **WHEN** an authenticated member visits any in-app surface, including the ones that previously drew their own header
- **THEN** the connection indicator is present in the statusline, and no second connection indicator is rendered anywhere on the page

#### Scenario: A failed credential request does not sign the user out

- **WHEN** the sync-credential request fails with a network error, a timeout, or a server error while the user has a valid session
- **THEN** the user stays signed in, the failure is surfaced as temporarily unavailable with a retry, and the client retries on backoff rather than navigating to the sign-in page

#### Scenario: A hung credential request cannot wedge the app

- **WHEN** the sync-credential request never settles
- **THEN** the request is aborted by its timeout and the app shows an actionable retry state instead of an indefinite loading state
