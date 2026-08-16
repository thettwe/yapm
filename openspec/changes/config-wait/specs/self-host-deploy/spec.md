## MODIFIED Requirements

### Requirement: The browser-facing sync origin is runtime configuration

The origin the browser opens its sync WebSocket to SHALL be resolved at **runtime**, served by the
app process, and SHALL NOT be a build-time constant compiled into the web bundle. A prebuilt image
SHALL therefore sync correctly against any host and any domain with **no rebuild** — changing the
served value SHALL change where the client connects.

The app SHALL serve the value from a single unauthenticated endpoint under `/api`, uncacheable, so
that it is reachable through the existing development proxy and inspectable with an HTTP client. The
value SHALL come from a validated environment variable whose default is the local development origin,
so that the development loop is unchanged and requires no configuration.

The SPA SHALL NOT construct its sync client until the origin is known: it SHALL hold a neutral boot
state while the value is in flight rather than rendering an error.

That boot state SHALL be silent only for as long as silence is honest. For a first beat it SHALL
draw nothing and announce nothing, because the ordinary same-origin request resolves inside that
beat and a state that flashes for one frame reads as a glitch. Once the wait outlasts the beat, the
boot state SHALL say that it is waiting **on the screen and in the accessibility tree at the same
moment, in the same words** — a screen a sighted reader can only read as empty, while a screen
reader is told the page is loading, is the same defect as an unlabelled drawing with the modalities
swapped. Those words SHALL be the ones the application already uses for a wait in progress: waiting
for configuration is not a new concept and SHALL NOT introduce a new word for one.

The application SHALL name the endpoint once the wait has outlasted the patience the application
already applies to its other waits — the same bound it uses before offering a manual retry on a
connection that has not come back. That bound SHALL be measured as **time elapsed since the first
attempt**, and SHALL NOT be a count of attempts: a count is a proxy for patience and it is wrong in
both directions, naming the endpoint within seconds where the endpoint refuses connections quickly
and withholding the name for over a minute where it accepts them and hangs. One elapsed bound SHALL
give one answer in every failure mode. That bound SHALL be longer than the bound on a single
request, so the endpoint is never named before at least one bounded attempt has actually failed.

Naming the endpoint SHALL NOT end the wait. The surface SHALL state that retrying continues, SHALL
offer a keyboard-operable control that takes the next attempt immediately, and SHALL give way to the
application on its own once the configuration lands — whether it landed because that control was
pressed or because a scheduled attempt succeeded — so that naming the endpoint early costs a caller
nothing worse than a sentence that turns out to have been pessimistic. An attempt taken from that
control that also fails SHALL leave the surface in place; the application SHALL NOT return to the
waiting state and re-name the endpoint later.

Work-graph placement: none — deployment surface of the sync capability. Permission story: the
endpoint discloses only the sync origin, which is already public to every browser that connects.

#### Scenario: Changing the served origin changes the connection, with no rebuild

- **WHEN** the served sync origin is changed and a browser loads the same unchanged bundle
- **THEN** the sync client connects to the new origin

#### Scenario: No build-time sync origin survives on the connection path

- **WHEN** the web application's sources are searched for a compile-time sync-origin constant
- **THEN** none appears anywhere on the path that constructs the sync client

#### Scenario: The pre-config paint is deliberate

- **WHEN** the SPA is loading and the runtime configuration request has not yet resolved, within the
  first beat before the wait has outlasted it
- **THEN** the application renders a neutral boot state, renders no error, and constructs no sync
  client

#### Scenario: A boot that resolves normally says nothing at all

- **WHEN** the runtime configuration request resolves inside the first beat, as a same-origin request
  ordinarily does
- **THEN** no waiting message is drawn and none is announced, and the application paints its first
  real surface with no flash between them

#### Scenario: The wait is drawn as well as announced

- **WHEN** the runtime configuration request has not resolved once the wait has outlasted the first
  beat
- **THEN** the boot state states that it is waiting in words that are on the screen and in the
  accessibility tree at the same moment, and neither reader is told something the other is not

#### Scenario: An unreachable configuration endpoint is eventually named

- **WHEN** the runtime configuration request fails repeatedly
- **THEN** the application surfaces a failure that names the configuration endpoint, rather than an
  empty workspace or a silent sync failure

#### Scenario: A hung endpoint and a refused one are named on the same clock

- **WHEN** one instance's configuration endpoint accepts connections and never answers, and another's
  refuses them immediately
- **THEN** both callers reach the named failure at the same elapsed point, rather than one waiting
  several times longer than the other because the attempts happened to be spaced differently

#### Scenario: The endpoint is not named before one bounded attempt has failed

- **WHEN** the configuration endpoint has been unresponsive for less time than a single request is
  allowed to take
- **THEN** the application is still in its waiting state and has claimed nothing about the endpoint

#### Scenario: The named failure clears itself

- **WHEN** the configuration endpoint starts answering after the failure has been named
- **THEN** the application boots without a page reload, whether the answer came from the retry control
  or from a scheduled attempt

#### Scenario: A failed retry does not hide the failure

- **WHEN** a caller presses the retry control and the attempt it takes also fails
- **THEN** the failure surface stays on screen with its control, rather than reverting to the waiting
  state and naming the endpoint again later

#### Scenario: The wait and the way out are operable without a pointer

- **WHEN** a caller using the keyboard alone reaches the named failure
- **THEN** the retry control is reachable by Tab and activatable from the keyboard, and both the
  waiting state and the failure are announced by a polite live region rather than needing a pointer
  to reveal them

#### Scenario: The development loop needs no configuration

- **WHEN** a contributor runs the development stack with no sync-origin variable set
- **THEN** the served origin is the local development default and sync works
