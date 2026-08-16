## ADDED Requirements

### Requirement: Signing in lands on work, not on administration

Completing sign-in SHALL land the caller on a team's Home rather than on the workspace
administration surface. The team SHALL be resolved from the anchor concept this capability already
defines — the caller's remembered team, or failing that the first team they can reach — narrowed by
one further condition the deck does not apply: **the landing team SHALL be one whose work the caller
can actually read.** A workspace member may see the name of every team in the workspace; being able
to name a team is not being able to open it. The deck MAY offer a stop pointing at such a team,
because navigation is an offer and an offer may be wrong without lying; a redirect is not an offer,
and SHALL NOT resolve to a team whose rows the caller's own queries would return empty.

Where no such team exists — a workspace holding no team, a member belonging to none, or an
authenticated non-member — the caller SHALL land on the workspace administration surface, which this
change neither moves nor renames. That surface SHALL remain reachable from the frame rather than by
URL alone, so a member who wants it still finds it, and every navigation that reaches it today SHALL
still reach it. Where that surface should ultimately live is not settled by this requirement.

The landing decision SHALL NOT be taken before the team roster has settled. A decision computed over
an unsynced roster would send a member with teams to administration, so until the caller's
authoritative role is resolved **and** the team list reports itself complete, the sign-in surface
SHALL hold — showing the loading state it already shows — rather than guess. An unidentified caller's
roster can report itself complete while empty, so a complete roster SHALL NOT on its own release the
decision.

Nor SHALL a settled credential release it on its own. The roster the decision reads SHALL be one the
caller's OWN identity produced: a resolved credential and a synchronised replica are two facts, and
on sign-in they arrive one render apart, so a roster answered before the caller was identified is
complete, empty and wrong. The decision SHALL therefore be taken only where the identity that
resolved the roster is the identity the credential names — including the role it names, since a role
that has just changed reads a different roster than the one on screen.

That wait SHALL have an end, on both of the things it waits for. Where the caller holds a session but
the credential the sync layer needs cannot be obtained — the request never landing, or the endpoint
rejecting it — and equally where the credential mints but the sync connection itself does not come
back, so the roster never settles, the sign-in surface SHALL resolve to a surface the caller can act
on: the retry surface the application already uses when the server is unreachable, or the sign-in
form where the rejection is clean and settled. The bound on the connection SHALL be the one the
statusline already applies, so the surface clears itself once the connection holds. It SHALL NOT hold
a loading state indefinitely, and it SHALL NOT navigate into a surface that navigates back to it.

The landing decision SHALL be taken in exactly one place. No second mechanism — an authentication
callback URL, a route guard, or a redirect issued by a dependency — SHALL also choose where a
signed-in caller arrives; where a third-party provider structurally requires a return URL, that URL
SHALL point at the one place the decision is taken. Two mechanisms that happen to agree today are
one edit away from disagreeing.

This binds every door into the product, not only the sign-in form. A surface that completes entry by
another route — accepting an invitation — SHALL send the caller through the same landing resolution
rather than a destination of its own. Where acceptance grants membership of a named team, that team
SHALL be the landing, because the grant that just happened is stronger evidence of readability than
any test over a synced roster; where acceptance grants workspace membership without naming a team,
the ordinary resolution applies unchanged.

Work-graph placement: navigation over entities that already sync; no entity, query or mutator is
introduced. Sync/permission story: the landing team is resolved from the team-scoped rows the caller
already syncs, including the membership rows those already carry, so the frame can never send a
caller to a team it could not have shown them. On the invitation path the team is the one the
acceptance itself granted membership of, which the accepting request already reports, so that landing
rests on a membership row that exists before the navigation is taken.

#### Scenario: A member lands on their team's work

- **WHEN** a member of a team completes sign-in
- **THEN** they arrive on that team's Home digest, not on the Members / Teams / Invitations surface

#### Scenario: The remembered team wins where it is still the caller's

- **WHEN** a member who last visited the Engineering team signs in again, and Engineering is still a
  team they can read
- **THEN** they arrive on Engineering's Home

#### Scenario: A team the caller cannot read is never the landing

- **WHEN** a member signs in whose workspace holds an older team they do not belong to, alongside one
  they do
- **THEN** they arrive on the team they belong to, and never on the one whose rows their queries
  would return empty

#### Scenario: With no team of their own the caller lands on administration

- **WHEN** a caller signs in to a workspace holding no team at all, or belongs to none of the teams
  it holds
- **THEN** they arrive on the workspace administration surface — `/`, as this change leaves it — and
  no team page is opened on their behalf

#### Scenario: The decision waits for the roster rather than guessing

- **WHEN** sign-in completes while the caller's role or the team list has not yet settled
- **THEN** the sign-in surface shows its loading state and no navigation is taken, and once both have
  settled the caller is sent to the team the settled data names

#### Scenario: An empty roster that reports itself complete is not a decision

- **WHEN** the team list reports itself complete while the caller's identity has not yet settled, so
  it is empty because nobody has been identified rather than because they belong to no team
- **THEN** no navigation is taken, and the decision is retaken once identity settles and the roster
  is re-read

#### Scenario: The credential settling is not the replica settling

- **WHEN** a caller submits the sign-in form, the credential resolves and names them a member of
  teams, but the roster on screen is still the one answered before they were identified — complete
  and empty
- **THEN** no navigation is taken on that roster, and the caller arrives on their team once the
  roster being read is the one their own identity resolved

#### Scenario: A sync session that never becomes ready does not hang the door

- **WHEN** the caller holds a session but the sync credential cannot be obtained — the server is
  unreachable, or it rejects the credential outright — or the credential mints and the sync
  connection stays down long enough that the statusline would offer its retry
- **THEN** the sign-in surface shows the retry surface the product already uses for an unreachable
  server, or the sign-in form for a clean settled rejection, and never an indefinite loading state,
  and no pair of routes navigates at each other; and the retry surface gives way to the landing
  decision once the connection holds

#### Scenario: One landing decision, not two

- **WHEN** the same account signs in by creating an account, by email and password, and by a
  configured provider
- **THEN** all three arrive in the same place by the same decision, and no dependency-issued redirect
  lands the caller anywhere else on the way

#### Scenario: Accepting a team-bound invitation lands on that team

- **WHEN** a caller accepts an invitation that grants membership of a named team
- **THEN** they arrive on that team's Home, not on the administration surface, by the same landing
  decision the sign-in surface takes

#### Scenario: Accepting a workspace-level invitation falls to the ordinary decision

- **WHEN** a caller accepts an invitation that grants workspace membership without naming a team
- **THEN** they arrive wherever the ordinary landing decision sends them — a team they can read where
  one exists, and the administration surface otherwise

#### Scenario: Administration keeps its place in the frame

- **WHEN** a member who is not on the workspace administration surface looks for it
- **THEN** it is reachable from the frame — today from the workspace switcher and the command
  palette — and every navigation that reached it before this change still arrives
