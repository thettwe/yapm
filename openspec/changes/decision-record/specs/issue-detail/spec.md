## ADDED Requirements

### Requirement: A thread can be ended in one sentence from the composer

The comment composer SHALL offer a **Decide** affordance beside the post control, reachable and
operable from the keyboard with no pointer, available exactly to the callers who may post a
comment. Activating it SHALL open a single-line plain-text field for the decision's sentence,
stating the remaining sentence budget, with an optional revisit cycle chosen from the team's
cycles, and SHALL submit through the shared decision mutator with the row's identifier minted at
the call site.

Submitting SHALL apply optimistically and SHALL be dismissable with Escape, returning focus to the
control that opened it. The affordance SHALL NOT be offered to a viewer, and a viewer's attempt
SHALL be rejected as not authorized.

The same action SHALL be offered in the surface's command palette, so the keyboard route does not
depend on the composer having focus.

#### Scenario: Deciding without a pointer

- **WHEN** a member tabs from the comment editor to the Decide control, activates it, types one
  sentence and submits it from the keyboard
- **THEN** the decision is recorded and appears immediately above the thread

#### Scenario: Escape abandons the sentence

- **WHEN** a member opens the Decide field and presses Escape
- **THEN** the field closes, nothing is written, and focus returns to the Decide control

#### Scenario: A viewer is not offered the decision

- **WHEN** a viewer opens an issue
- **THEN** no Decide affordance is rendered and any decision write is rejected as not authorized

### Requirement: A decision is pinned above the thread it distilled

Where an issue carries at least one decision, the detail surface SHALL pin those decisions above
the comment thread, newest first, each as a chip stating: the drawn decision mark **and** the word
`Decided`, the moment, the sentence in plain type, a mono provenance line naming the size of the
thread it came from and that the decision belongs to the team with no owner, and the revisit pill
where one is set. The chip SHALL name no person.

Where the source thread no longer exists, the chip SHALL keep its stated provenance and SHALL NOT
offer a doorway to the missing thread.

The chip SHALL be readable and its controls operable by keyboard, and no fact on it SHALL be
conveyed by colour alone.

#### Scenario: The chip states team ownership as fact

- **WHEN** an issue with a decision is opened
- **THEN** the chip renders the sentence, the word `Decided`, and a provenance line naming the
  thread size and stating the decision has no owner — and no name appears on it

#### Scenario: A deleted thread leaves an honest chip

- **WHEN** the comments a decision was distilled from have been deleted
- **THEN** the chip still states the thread size recorded at the time and offers no thread doorway

### Requirement: A settled thread collapses rather than merely dimming

Where an issue carries a decision, the comments posted at or before the newest decision's moment
SHALL collapse behind a single keyboard-operable control naming how many comments are behind it
and that they are settled, with its expanded state exposed to assistive technology. Comments posted
after that moment SHALL remain open, because a thread that kept moving after the settlement is not
settled. An issue with no decision SHALL render its thread unchanged.

Collapsing SHALL be presentation only: no comment is deleted, edited or hidden from the thread's
own count, and expanding SHALL require no network request.

#### Scenario: A settled thread is folded away

- **WHEN** a member opens an issue whose five-comment thread ended in a decision
- **THEN** the five comments are behind one control naming five settled comments, and the control
  expands and collapses them from the keyboard

#### Scenario: The conversation after the decision stays visible

- **WHEN** two comments are posted after a decision was recorded
- **THEN** those two remain open beneath the collapsed settled block

#### Scenario: An undecided thread is untouched

- **WHEN** an issue with no decision is opened
- **THEN** its comments render exactly as before, with no collapse control

## MODIFIED Requirements

### Requirement: Comment thread

The detail surface SHALL present the issue's comments in chronological order and allow a member to post, edit (own or as admin), and delete (own or as admin) comments through the shared mutators with optimistic application, fully keyboard-operable. Comment bodies SHALL be edited in the TipTap rich-text editor and stored as JSON.

The thread's section heading SHALL count every comment on the issue, whether or not a settled block
is collapsed.

Work-graph placement: `comment` rows hanging off the open `issue`, and `decision` rows distilled from them. Permission story: posting is gated by team-scoped `canWrite`; editing/deleting requires author-or-admin, checked before existence; viewers read but cannot post.

#### Scenario: Post a comment by keyboard

- **WHEN** a member types a comment and submits it with the keyboard
- **THEN** the comment appears optimistically in the thread and persists via the shared mutator with `author` from `ctx`

#### Scenario: Edit restricted to author or admin

- **WHEN** a user who is neither author nor admin attempts to edit or delete a comment
- **THEN** the action is rejected as not authorized without revealing the comment's existence

#### Scenario: Viewer cannot comment

- **WHEN** a `viewer` opens the issue
- **THEN** the comment composer is unavailable and any post attempt is rejected as not authorized

#### Scenario: The count is of comments, not of what is visible

- **WHEN** an issue with five settled comments and one later comment is opened with the settled
  block collapsed
- **THEN** the section heading counts six
