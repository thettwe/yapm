## MODIFIED Requirements

### Requirement: An AI draft section beside the data panel, never inside the format's columns

The retro surface SHALL be able to show AI-drafted proposals in a section adjacent to the
auto-seeded data panel, and SHALL NOT place them into the retro format's own columns: the shipped
formats include two whose columns do not map onto wins, losses and improvements, so the AI's buckets
are its own and are labelled as such. The section SHALL be absent — rendering nothing, firing no
error and consuming no space — whenever the capability is off for the team, unavailable for the
workspace, or produced no surviving proposal, leaving the auto-seeded data panel as the unchanged
raw-evidence fallback.

The section SHALL state that its content is AI-drafted and not agreed by the team until the team has
decided. During `group` and `vote` it SHALL offer each member a private means of agreeing or
disagreeing with a proposal, showing that member **only their own** reaction; from `discuss` onward
it SHALL show each proposal's team verdict and counts instead. **Ratification SHALL apply to AI
proposals only** — a human-written card SHALL NOT gain any agree/disagree control, because dot
voting already ranks human cards and a second differently-shaped ranking signal on the same board
would be two scoreboards with no defined resolution between them.

The section SHALL be fully operable with the keyboard alone and SHALL render entirely from semantic
tokens, correct and AA-contrast in the Warm, Focused and Editorial presets in both light and dark,
consistent with the rest of the retro surface. Its presence SHALL NOT make any existing retro
interaction wait on the network.

#### Scenario: The retro is unchanged when the capability is off

- **WHEN** a member opens a retro on a team that has not enabled AI participation
- **THEN** the retro renders exactly as it does without this capability, with no extra section, no extra query and no error

#### Scenario: Proposals never take over a format's columns

- **WHEN** a retro using a format whose columns are not wins/losses/improvements shows AI proposals
- **THEN** the proposals appear only in their own labelled section and no column's contents are altered

#### Scenario: The section is reachable and operable by keyboard

- **WHEN** a member tabs from the data panel into the draft section and activates a proposal's references and its reaction controls, using no pointer
- **THEN** focus is visible at each step and every reference and control is activatable

#### Scenario: A human card records no agree/disagree

- **WHEN** a member reads a human-written card on the board during `group` or `vote`
- **THEN** the card offers no agree or disagree control, and the only ranking signal on it remains the dot vote

#### Scenario: Nothing is presented as decided before the team decides

- **WHEN** a member reads an AI proposal before the retro has left `vote`
- **THEN** the section still states that the content is AI-drafted and not agreed, and no verdict, count or other member's opinion is shown

### Requirement: Action items become tracked issues in the next cycle

A retro SHALL record action items carrying a body, an optional assignee, an optional target cycle, an
optional provenance reference to the card or group that produced them, and an optional provenance
reference to the AI proposal that produced them. During `discuss`, `actions`, or `closed`, an action
SHALL be convertible into a **real issue created through the same shared issue-creation mutator,
permissions and server-authoritative numbering as any human-created issue** — team-scoped, assigned
when an assignee was set, and placed in the action's target cycle or, absent one, the retro's next
cycle. The new issue's id SHALL be minted at the call site. Conversion SHALL be idempotent:
converting an already-converted action SHALL be a no-op rather than creating a second issue. After
conversion the action SHALL display the issue's live status.

An action created from an AI proposal SHALL be created **with no assignee**, and no part of that path
SHALL suggest, default or infer one. An action SHALL survive the deletion of the AI proposal it came
from, losing only its provenance reference.

#### Scenario: Converting an action creates a real issue in the next cycle

- **WHEN** a member converts an action during `actions`
- **THEN** an issue is created in the retro's team with a server-assigned per-team number, placed in the next cycle, and the action shows the issue's live status

#### Scenario: Converting twice creates only one issue

- **WHEN** the convert action is invoked again on an already-converted action
- **THEN** no second issue is created and the existing reference is unchanged

#### Scenario: A viewer cannot convert an action

- **WHEN** a `viewer` invokes convert-to-issue
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Conversion is keyboard-operable

- **WHEN** a member focuses an action and presses `⌘/Ctrl+Enter`, using no pointer
- **THEN** the issue is created and the action's tracked state updates in place

#### Scenario: An action from an AI proposal carries no owner

- **WHEN** an action is created from an AI proposal and then converted
- **THEN** both the action and the resulting issue have a null assignee, and a human assigns it afterwards through the ordinary control

#### Scenario: Losing the proposal does not lose the action

- **WHEN** the AI proposal an action came from is deleted
- **THEN** the action still exists with its body and target cycle intact and its AI provenance reference is empty
