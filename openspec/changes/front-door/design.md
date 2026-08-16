# Design — front-door

The mission input is `openspec/SCOPE-legibility.md` §"Track C — the front door". This file records the
decisions that scope left to the build, and corrects one fact it inherited.

The governing sentence: **a redirect is not an offer.** The deck may point at a team the reader is not on —
`apps/web/src/frame/team-context.ts:13-19` argues that case and this change does not reopen it — but the
place the product *puts* you after you sign in has to be somewhere you can read.

## Context

What exists and must be used rather than rebuilt:

- **The anchor.** `app-frame/spec.md:181` defines it; `team-context.ts:49-59` implements it (route > the
  remembered `yapm.frame.team` key > the first visible team, re-validated against the synced list every read);
  `useAnchorTeam` at `:61-77` binds it to the frame. Unit coverage is `team-context.test.ts` — the route-wins
  case at `:40-42`, the remembered case at `:44-46`, the stale-remembered case at `:50-52`, the stale-route
  case at `:54-56`, the empty-workspace case at `:59-62`, storage round-trip at `:64-70` and refused storage
  at `:75-90`.
- **The filter model.** `packages/schema/src/zero/filter.ts` — `IssueFilter.status` at `:31`, the evaluator's
  status clause at `:86`, `issueFilterSchema` at `:58-65`. The list holds it as `useState<IssueFilter>({})`
  at `issue-list.tsx:210` and the board holds a byte-identical line at `board.tsx:269`.
- **The route inventory.** `apps/web/src/routes.test.tsx:132-159` (`ROUTE_HOMES`), the equality assertion at
  `:171`, and the on-disk `<AppFrame` check at `:197`.
- **The frame-free sign-in surface.** `login.tsx` renders outside `Authenticated`, but `main.tsx:30-36` mounts
  `ZeroRoot` **above** `RouterProvider`, so `useQuery` works on `/login`. That is what makes a roster-aware
  redirect possible at all.

What is shipped and wrong: `/` is administration and it is where sign-in goes — and where invitation
acceptance goes too, on its own authority (`apps/web/src/routes/invite.tsx:97-99`, D10); the list's default
lens is empty and therefore total.

Constraints inherited and not negotiable here: all ZQL and the filter model live in `packages/schema`;
packages never import apps; sub-100ms; keyboard-first; tokens only; three containers.

## Goals / Non-Goals

**Goals**

- A member with a team of their own reaches work in zero clicks.
- The landing decision is taken in **one** place, and a test fails if a second one appears.
- The landing team is one the caller can read, not merely one they can see the name of.
- Opening Issues shows live work; asking for the archive still returns it, in one interaction.
- Nothing that reaches `/` deliberately stops working.

**Non-Goals**

- Moving administration off `/` (D7 — investigated and declined).
- Team Home's onward footer (D1 `destination-budget` owns it).
- A first-run surface (E2 `first-run`; it needs this change first).
- Any change to a phrase, a register, the reality track or a `how ·` affordance (B1, B2).
- Any change to the Board lens's default (D6).

## Decisions

### D1 — There are two redirects today, not one, and only one of them is in yapm's source

The scope brief and the research behind it named `login.tsx:21` as "the redirect". It is one of two, and it
is the one that fires **less** often.

| path | what fires | mechanism |
|---|---|---|
| email **sign-up** (`login-form.tsx:59`) | `login.tsx:21` `<Navigate to="/" />` | client route navigation |
| email **sign-in** (`login-form.tsx:54`) | better-auth `redirectPlugin` | `window.location.href = '/'` — full page load |
| GitHub (`login-form.tsx:78`) | the provider returns the browser to `callbackURL` | server-side redirect |
| SSO (`login-form.tsx:94`) | the IdP returns the browser to `callbackURL` | server-side redirect |

Verified rather than recalled: `sign-in.mjs:335-341` returns `{ redirect: !!ctx.body.callbackURL, url:
ctx.body.callbackURL, … }`; `sign-up.mjs:262-265` returns `{ token, user }` and nothing else;
`client/fetch-plugins.mjs:3-15` is the plugin, `client/config.mjs:50` enables it unless
`disableDefaultFetchPlugins` is set, and `isSafeUrlScheme('/')` returns `true` because `new URL('/')` throws
(`@better-auth/core/dist/utils/url.mjs:51-59`).

So the shipped product has two landing mechanisms that happen to agree on `/`, and nothing keeps them
agreeing. Editing only `login.tsx:21` would move the door for people creating an account and leave everyone
signing in on the old one.

**The decision: the route owns the landing, and the auth layer is pointed back at it.**

- The two **email** calls drop `callbackURL` entirely. `redirect` is then `false`, the plugin does not fire,
  no page reload happens, and `login.tsx` — which is still mounted, holding a fresh session — navigates
  client-side. This is also strictly faster: a `window.location.href` throws away the Zero client and the
  replica and rebuilds both.
- The two **provider** calls keep `callbackURL`, set to **`/login`**. A third-party redirect structurally
  needs a URL, and the honest URL is the one place the decision is taken. `/login` with a live session is a
  state the route already handles (`login.tsx:20-22`), and `ROUTE_HOMES:157`'s `'/login': 'open'` is unchanged.

Rejected: computing a team URL as the `callbackURL`. The team is not known at submit time — the roster is a
Zero query that may not have settled, and for the provider paths the tab has left the origin entirely by the
time it would be known. An auth layer that has never heard of `team_membership` cannot pick a team.

Four paths, two mechanisms — and the table is still one mechanism short. **D10** names the third:
`/invite`, which sends every invitation acceptor to `/` on its own authority.

### D2 — The landing team is a stricter test than the deck's anchor

`queries.ts:108-116` is the fact that makes this necessary:

```ts
  teams: {
    all: defineQuery(({ ctx }) => {
      const q = zql.team
        .where('archivedAt', 'IS', null)
        .related('members')
        .orderBy('createdAt', 'asc')
      return isMember(ctx) ? q : denyAll(q)
    }),
  },
```

Every workspace member sees **every** non-archived team. `resolveAnchorTeam`'s `return teams[0] ?? null`
(`:58`) therefore returns the workspace's oldest team, which may be one the caller has no membership in — and
`teamScoped` (`queries.ts:21-33`) grants row access only to workspace admins and to members of the team, so
that caller's Home would render an empty digest for strangers' work.

Today that costs nothing, because nobody is *sent* there. Under this change it would be the front door.

```
resolveAnchorTeam(teams, routeTeamId, remembered)      — the DECK. Unchanged.
  route team → remembered team → teams[0] → null

resolveLandingTeam(teams, remembered, viewer)          — the REDIRECT. New.
  remembered team, if the viewer can read it
  → the first team the viewer can read
  → null   (⇒ land on `/`)

  "can read" = viewer.role === 'admin'                 (teamScoped's own bypass)
             || team.members.some(m => m.userId === viewer.userID)
```

`team.members` is already on the row (`schema.ts:671-676` relates `team → team_membership`, whose `userId`
is `schema.ts:82`), so this costs **no new query and no new sync**. The two resolvers share `FrameTeam` and
live in the same file so a reader finds both at once.

The asymmetry is deliberate and it is the file's own argument applied consistently: an offer may be wrong; a
redirect may not.

### D3 — The decision waits for the roster, the wait has an end, and both are surfaces that exist

`useQuery(queries.teams.all())` returns `[]` before it settles. A redirect taken on that empty array sends a
member with five teams to administration — a coin flip decided by whether the socket beat the render.

The gate is two facts, both already available on `/login`:

1. `useSyncSession().status === 'ready'` — the server has resolved the caller's authoritative role
   (`zero/provider.tsx:40`, `:83-86`). Before that, `role` is `null` and "no team" is indistinguishable from
   "not asked yet". A settled `role === null` is an authenticated non-member, whose destination is the access
   gate, which every route renders — so `/` is right for them.
2. `teamsResult.type === 'complete'` — Zero's own answer to "is this list the whole list", used exactly this
   way at `team-home.tsx:56` and `:106-112`.

While either is outstanding, `login.tsx` renders the `Loading…` surface it already has at `:10-18`. No new
component, no spinner, no flash of administration.

**The invariant condition 2 rests on, written down because nothing in the code writes it down.** `complete` is
Zero's answer to "is this the whole list", not to "is this the right list". Before the sync credential settles
there is no `ctx`, so `queries.teams.all()` (`packages/schema/src/zero/queries.ts:108-116`) fails
`isMember(ctx)` at `:114` and returns `denyAll(q)` — `q.where(({ or }) => or())`, `:13-19` — an empty roster
that reports itself **complete**. Read alone, condition 2 is satisfiable by a roster that is empty only
because nobody has been identified yet, and the gate would send a member with five teams to `/` after all.

What saves it is ordering rather than luck: `userID` is in the ZeroProvider options memo's dependency list
(`apps/web/src/zero/provider.tsx:562-576`), so identity settling rebuilds the Zero client and re-issues every
query — a complete-and-empty roster observed before sign-in is superseded, not acted on. Condition 1 is what
makes that ordering a guarantee rather than an observation, which is exactly why both are required and
neither is redundant. Task 6.3 carries the case that would catch an edit dropping either one.

**And the wait must end, because `ready` is not the only settled state.** `provider.tsx:40` declares
`type SyncStatus = 'pending' | 'logged-out' | 'ready'` — three settled values, not two — with `unavailable`
carried beside them as a further condition (`:54`, set by `applyCredential`'s `case 'unavailable'` at `:95`,
exposed on `SyncSessionState` at `:126`). A caller holding a better-auth session whose sync-credential request
fails never reaches `ready`: an unreachable server keeps `status === 'pending'` with `unavailable === true`
(`:95` preserves the previous status by design), and an endpoint that rejects the credential settles at
`logged-out` (`:93`, from the 401/403 branch at `zero/session.ts:85`). A gate written as "hold until `ready`"
holds both of those forever, which is a spinner where the product already has an answer:

- **`unavailable === true`, in either status** → render the retry surface the application already uses:
  `SyncUnavailable` (`apps/web/src/components/authenticated.tsx:52-67`), its `data-testid="sync-unavailable"`
  node and its `retry` button intact. It is module-private today and is exported so `/login` renders the
  identical surface rather than a second copy — `reconnect.spec.ts:340-341` and `:369-372` drive that testid,
  and a near-copy is how two retry surfaces drift apart.
- **A clean, settled `logged-out`** → render `<LoginForm />`, the node `login.tsx:24-28` already has. The
  sync-token endpoint is the authoritative auth check (`authenticated.tsx:8-11`); when it says this caller has
  no session, asking them to sign in is the honest answer — and the only one that cannot loop.

Navigating to `/` is the cheaper-looking option and it is wrong in the second case: `authenticated.tsx:22-30`
sends a clean `logged-out` straight back to `/login`, which is D4's starvation exactly. In the first case it
would not loop (`:19` and `:27-29` render the retry surface without navigating), but it would move the URL for
a transient outage and hand the recovered caller administration instead of the landing decision — the one
thing this change exists to stop.

```
/login  ┬─ isPending ──────────────────────────► "Loading…"        (today, :10-18)
        ├─ no session ────────────────────────► <LoginForm/>       (today, :24-28)
        └─ session ┬─ sync unavailable ───────► retry surface      (new, authenticated.tsx:52-67)
                   ├─ sync logged-out, clean ─► <LoginForm/>       (new, same node as :24-28)
                   ├─ sync not ready ─────────► "Loading…"         (new, same node)
                   ├─ roster not complete ────► "Loading…"         (new, same node)
                   ├─ landing team resolved ──► /teams/{teamId}    (new)
                   └─ none ───────────────────► /                  (today's behaviour, :21)
```

The order of those branches is load-bearing: `unavailable` is checked **before** `ready`, because it coexists
with `pending` rather than replacing it.

### D4 — Two routes that `Navigate` at each other starve the renderer, and this change must not build one

`apps/web/src/components/authenticated.tsx:22-30` carries a hard-won comment:

> A stale `logged-out` with a failed re-mint on top of it must be a visible retry surface, not a redirect:
> `/login` sends a live session straight back here, and two routes that Navigate at each other starve the
> renderer so completely that no timer or fetch callback ever runs again. Only a settled, clean
> `logged-out` may steer the router.

That last sentence is the one this change leans on hardest: it is already the rule that a
non-clean `logged-out` renders rather than navigates, so D3's third branch is not a new
principle — it is the existing one, applied at the other end of the same loop.

The loop it warns about is `/login` ⇄ any framed route. This change changes the *target* of `/login`'s
navigation from `/` to `/teams/{id}` — both of which render `<Authenticated>` — so the loop's shape is
unchanged in kind. What D3's gate adds is a set of states that are neither redirect nor render-through, which
strictly *reduces* the window: `/login` no longer navigates at all until the sync session is `ready`, and
`ready` is the exact condition under which `Authenticated` renders its children rather than bouncing back.

The comment above is also why D3's failure branch is a **render**, not a navigation. The one state that would
re-arm this loop is a clean, settled `logged-out` held by a caller better-auth still considers signed in:
`Authenticated` at `:30` sends it to `/login`, and a `/login` that answered by navigating to `/` would send it
straight back — the same starvation, rebuilt from the other end by a change that had read the warning.

Recorded because it is the failure mode that would not show up in a unit test and would take the whole tab
down in production.

### D5 — The default lens is a value of the Status axis, not a rule behind it

The Issues page opens on `54 Done of 57`. Two ways to fix it:

| | how it reads | how it clears | cost |
|---|---|---|---|
| **A hidden predicate** | the bar looks unfiltered | needs a control invented to undo it | a rule nothing states — the thing `SCOPE-legibility.md` exists to remove |
| **A seeded axis value** (chosen) | `Status 4`, the menu shows which four | the axis's existing clear | one interaction is slower (below) |

The seeded value wins because it needs no new mechanism at all: `IssueFilter.status` already exists
(`filter.ts:31`), already serialises into a saved view (`issueFilterSchema`, `filter.ts:58-65`), and already
draws a count suffix beside its axis. The member can *see* why Done is missing, which is the whole ethos of
the family this change belongs to.

The value is **derived, never listed**:

```ts
// packages/schema/src/zero/filter.ts
export const TERMINAL_ISSUE_STATUSES = ['done', 'canceled'] as const
export const DEFAULT_ISSUE_STATUS_FILTER: readonly IssueStatus[] =
  ISSUE_STATUSES.filter((s) => !TERMINAL_ISSUE_STATUSES.includes(s as never))
```

A positive include-list is only safe if it cannot fall behind the status set. Deriving it means a status added
later joins the default; a hard-coded four would silently hide it. A unit test asserts the derivation rather
than the literal, so the guarantee survives an edit to `ISSUE_STATUSES` (`context.ts:9-16`).

**One carried scenario is reworded, and the reword is named here rather than left to a diff.** An OpenSpec
`## MODIFIED Requirements` block replaces its requirement wholesale, so every live scenario is carried
forward — `specs/issue-list/spec.md` drops none. It changes one word in one of them: the live scenario at
`openspec/specs/issue-list/spec.md:15` reads "grouped under the **six fixed** status categories **in
order**", and the delta reads "grouped under the status categories **in the fixed order**". The reason is
that under the new default only four groups render, so a scenario asserting six would be false of the surface
on the first screen a member sees. **The six-category order itself is unchanged** and still stated verbatim in
the requirement prose — "the fixed category order (Backlog, Todo, In Progress, In Review, Done, Canceled)" —
and the delta's own "Asking for the archive returns the archive" scenario proves all six still render when
asked for. Nothing about grouping, ordering or category membership moved; only the count that a first render
happens to show.

**The cost, stated:** the Status axis menu is a toggle set (`filter-bar.tsx:211`, `:586`). With four values
seeded, clicking `Todo` removes Todo instead of narrowing to it. Narrowing to one status is three toggles
where it was one. Accepted rather than papered over: the common case is opening the page, not re-slicing it,
and inventing an "only this" affordance to recover one click would add vocabulary to a change whose purpose
is removing it. It is named here so that whoever finds it irritating finds the reasoning too.

### D6 — The Board lens keeps `{}`, and its columns are the argument

`board.tsx:269` is byte-identical to `issue-list.tsx:210`, which makes "change both" look like the tidy
answer. It is the wrong one.

`board/model.ts:30` builds columns by mapping `STATUS_ORDER` unconditionally, so all six render whatever the
filter says — `board.test.tsx:287-291` asserts the empty Canceled column down to its accessible name
(`'Canceled, 0 issues'`), and `board.spec.ts:117` asserts it is in the viewport at three widths. The board's
columns **are** the status axis. Excluding two of them from the data while still drawing them produces the
one thing a board must never do: a card dragged into Done disappears under the cursor.

`issue-list.md:96` already documents the consequence — "Filters are per-lens: switching starts the other lens
unfiltered" — so the two lenses differing is the contract readers were already given, and switching to Board
is the second way to reach the archive.

### D7 — Administration stays on `/`, and here is what moving it would actually cost

`SCOPE-legibility.md` C1 says "move administration to Settings". This change deliberately does not, and the
cost is specific rather than vague:

- **`ROUTE_HOMES` is an exact-equality table.** `routes.test.tsx:171` asserts the registered route ids equal
  its keys, and `:197` reads each route file off disk looking for `<AppFrame`. A new `/settings/workspace`
  means a new key, a new file, and `'/'` either deleted (breaking every navigation below) or kept as a
  redirect (a route whose "home in the frame" is a fiction).
- **Six in-app navigations point at `/`**: `app-frame.tsx:104-108`'s `frame:workspace` command labelled
  "Go to workspace overview", `apps/web/src/issues/command.tsx:842-852` and its dispatch at `:392-395`,
  `switcher.tsx:58`,
  `invite.tsx:98` and `:133`, `team-detail.tsx:313` (after archiving a team), and
  `inbox-view.tsx:515` — which labels `/` **"Home"**, a mislabel this change makes visible and D1
  `destination-budget` should settle. `header-menus.test.tsx:106` asserts the switcher's "Workspace" group.
  Five of the six survive this change untouched; `invite.tsx:98` is the exception and D10 is why it goes.
  `:133`'s `BackHome` link stays — it is an escape hatch a reader chooses, not a landing taken for them.
- **22 mid-test navigations to `/` across 13 e2e specs mean at least three different things.** Some reach
  administration on purpose (`issues.spec.ts:332-334` mints an invite; `search.spec.ts:65` and `:312` create
  a team; `mentions.spec.ts:98-99` and `notifications.spec.ts:146-147` click a team link out of `TeamsPanel`).
  Others just want *any* authenticated page — `notifications.spec.ts:239-240` checks the inbox badge,
  `pm-digest.spec.ts:254-258`, `:453-457` and `:499-503` check the account menu, `retro-ai.spec.ts:238`
  re-enters the app, and `harness.spec.ts:54-56` is a **signed-out** probe expecting the sign-in heading. A
  blanket rewrite would be wrong nine times.

None of that is prohibitive; all of it is a different change. The redirect is one line and delivers the whole
of the complaint's relief; bundling a route move into it would make a two-file change a twenty-file one and
put the cheap win behind the expensive one. `/` keeps rendering administration, keeps `'/': 'switcher'` at
`routes.test.tsx:133`, and every navigation above keeps working untouched.

**What the delta may therefore say, and what it may not.** Declining a move is not the same act as forbidding
one, and the spec is where that difference becomes permanent. `specs/app-frame/spec.md` states that the
zero-team caller lands on the workspace administration surface, that the surface stays reachable from the
frame rather than by URL alone, and that this change does not move it — and deliberately does **not** state
that administration SHALL live at `/`. This family's rule is that a recorded position may be changed but
never quietly contradicted; a sentence written in passing here would make a future Settings move re-argue a
position this change never took. The cost analysis above is the record; the spec carries only the deferral.

### D8 — What the two surfaces look like after

Signing in, for a member of the Engineering team:

```
BEFORE                                    AFTER
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Acme ▾   Home Issues Triage …    ⌘K  │  │ Acme / Engineering ▾  Home Issues …  │
├──────────────────────────────────────┤  ├──────────────────────────────────────┤
│ Acme                                 │  │ Cycle 7 · day 9 of 14                │
│ Project management that respects     │  │                                      │
│ your keyboard.                       │  │ NEEDS ATTENTION            4         │
│                                      │  │ SINCE YESTERDAY                      │
│ Members                              │  │ YOURS                                │
│  Ada Lovelace      admin  ▾          │  │ READY FOR YOU                        │
│  Grace Hopper      member ▾          │  │ SHIP CADENCE                         │
│ Teams                                │  │ SHIPPED THIS CYCLE                   │
│  Engineering  ENG                    │  │                                      │
│ Invitations                          │  │ Issues › Board › Delivery › Retro …  │
│  [Create invite]                     │  │                                      │
├──────────────────────────────────────┤  ├──────────────────────────────────────┤
│ Acme                        ● Synced │  │ Cycle 7, day 9 of 14 · 8 shipped …   │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
   one click from work                       work
```

The zero-team caller keeps the left-hand page exactly, and that is the point: administration is not being
demoted, it is being addressed to the reader it is for.

Opening Issues:

```
BEFORE                                            AFTER
Issues  57                                        Issues  3
⌥ Status Priority Assignee Delivery Label …       ⌥ Status 4  Priority Assignee Delivery …
   Group Status · Sort Priority                      Group Status · Sort Priority
────────────────────────────────────────          ────────────────────────────────────────
▸ In Progress  2                                  ▸ In Progress  2
▸ In Review    1                                  ▸ In Review    1
▸ Done        51        ← the page                (Done and Canceled do not render:
▸ Canceled     3                                   `model.ts:216` folds an empty group)
```

`Status 4` is a real control. Opening it shows Backlog · Todo · In Progress · In Review ticked; clearing it
restores the 57.

### D9 — Test tiers (PROCESS.md §3)

This change touches a permission-adjacent surface (which team a caller is sent to) and the application's
entry point, but adds no entity, no mutator and no synced query. Unit and component tiers carry it; **e2e is
required for the landing route** because the landing route is the one behaviour no component test can
observe end to end — and because twenty-four e2e helpers currently encode the old answer.

- **Unit**: `resolveLandingTeam` over the six cases in D2; `DEFAULT_ISSUE_STATUS_FILTER` derived from
  `ISSUE_STATUSES` rather than listed; `resolveAnchorTeam` unchanged (its existing suite is the guard).
- **Component**: `/login` with a session and a resolved team navigates to that team; with no readable team
  navigates to `/`; with an unsettled roster navigates nowhere and renders `Loading…`; **with a roster
  reporting complete-and-empty while the sync session is still `pending`, navigates nowhere** (the D3
  invariant — the case that fails if a later edit drops the `ready` condition and keeps only `complete`);
  with `unavailable` set, renders the retry surface; with a clean settled `logged-out`, renders the sign-in
  form and navigates nowhere (D3); the sign-in form passes no `callbackURL` on the email paths and `/login`
  on the provider paths; `/invite` on a team-bound acceptance navigates to that team and on a
  workspace-level one falls to the same resolution (D10); the list opens on the four live statuses and
  clearing the axis restores the rest.
- **E2E**: signing in reaches a team Home rather than administration; a fresh workspace with no team still
  reaches administration (which is also what keeps `scripts/smoke.mjs:76` green); accepting a team-bound
  invitation reaches that team rather than administration; Issues opens without the archive and the Status
  axis brings it back.

### D10 — There is a fourth door, it lands on its own authority, and "exactly one place" has to mean it too

The requirement's own scenario enumerates three ways in: creating an account, email sign-in, a provider.
D1's table covers all three — four call sites, two mechanisms. There is a fourth door and a third mechanism,
three files away, which the scope brief did not name either. `apps/web/src/routes/invite.tsx:97-99`:

```ts
  useEffect(() => {
    if (state === 'done') void navigate({ to: '/' })
  }, [state, navigate])
```

Every invitation acceptor is sent to administration — including the acceptor of a **team-bound** invite, who
by definition now has a team. `packages/schema/src/db/invite.ts:118-128` inserts the `team_membership` row
whenever `invite.team_id` is not null (`schema.ts:91` is where that column is optional), `:139-145` returns
that `teamId`, and the accept route already hands it back to the browser
(`apps/server/src/auth-routes.ts:203-208`). The client reads the response body only on failure
(`invite.tsx:87-89`) and throws the success body away.

Left alone, this change ships contradicting its own SHALL: a second mechanism deciding where a signed-in
caller arrives, in the same repository as the requirement saying there is only one.

**The decision: `/invite` lands through the same resolution, and a team-bound acceptance passes its team in.**

- Acceptance that grants membership of a named team navigates to `/teams/{teamId}` taken from the accept
  response. No roster wait, no readability test: the server has just written the membership row, which is
  stronger evidence than any client-side check of a synced roster could be.
- Acceptance that grants only workspace membership — `invite.team_id` null, the workspace-wide invite —
  falls to `resolveLandingTeam` under D3's gate, exactly as `/login` does. A brand-new member with no team
  still lands on `/`; a returning member accepting a second invitation does not.

**`LoginForm` is mounted on two routes, so D1's edits land here as well** — `login.tsx:26` and
`invite.tsx:57`, the latter for a signed-out invitee. What each edit does on the invite page:

- Dropping `callbackURL` from the email paths (`login-form.tsx:54`, `:59`) **fixes a live bug in passing**,
  and D1's asymmetry is exactly why the bug exists on one path and not the other. An invitee **creating an
  account** on the invite page is fine today: `sign-up/email` returns no `redirect` field, so the plugin never
  fires and the page stays mounted — which is why `auth.spec.ts:73` (`Create one`) passes. An invitee who
  **already has an account and signs in** is not: `CALLBACK_URL = '/'` (`:19`) makes the `redirectPlugin`
  perform `window.location.href = '/'`, the tab leaves `/invite?token=…`, and the invitation is never
  accepted at all. With no `callbackURL` on either call, both stay mounted; the changed `authUserId` re-mints
  the credential (`provider.tsx:477-484`), `status` flips to `ready`, and `AcceptInvite` runs. Not a goal of
  this change; a consequence, and an improvement.
- Pointing the provider paths at `/login` (`:78`, `:94`) leaves the invite page's provider flow **exactly as
  broken as it is today**: the tab leaves the origin and returns to a URL without the token, so the
  invitation is not accepted. `'/'` and `'/login'` lose the token identically — no regression, no fix.
  Recorded rather than quietly repaired: carrying an invitation token through a third-party round trip is its
  own change, and this one may not make it look solved.

Rejected: excepting `/invite` in the requirement text. The exception would have to read "except the one path
that knows for certain which team the caller belongs to", which is an argument against itself.

## Risks / Trade-offs

- **Twenty-four e2e helpers assert `[data-testid="workspace-name"]` immediately after `ensureAccount`.**
  That testid lives at `workspace-name.tsx:88` and is rendered only by `routes/index.tsx:34`. The suite runs
  against a shared database, so whether a team exists when a given spec signs in is **not deterministic** —
  which means this would land as flakiness, not as a clean red. Every helper is fixed the same way and named
  in `tasks.md`: sign in, then navigate to `/` explicitly, which is what four helpers already do
  (`search.spec.ts:65`, `issues.spec.ts:332`, `attachments.spec.ts:111`, `pm-digest.spec.ts:125`).
- **`triage.spec.ts:140-143` is the only assertion that needs a Canceled issue in the default lens.** It is
  fixed by asking for the status it is testing, not by weakening the assertion: the test still proves a
  declined issue becomes Canceled and appears in the list — it just states which lens it is looking through.
  Its Todo sibling at `:179-182` needs nothing.
- **`issue-list.test.tsx`'s Status-axis case inverts.** `:426` — `['Status', /Todo$/, 'Alpha row']` in the
  seven-axis sweep at `:425-446` — clicks `Todo` expecting to narrow to it. With four values seeded the click
  toggles Todo *off*. The case is rewritten to prove the same property (this axis and no other decides which
  row survives) through the seeded default rather than against it; the other six cases are untouched.
- **The masthead count drops from 57 to 3, and someone will read that as data loss.** It is not: the count
  is the filtered count by existing spec (`issue-list/spec.md:313-314`), the Status axis states why, and the
  Board lens shows all six columns one keystroke away. Named because it is the most likely support question
  this change creates.
- **A member of no team in a populated workspace still lands on administration.** That is correct — it is the
  only page whose contents are theirs — but it is also thin, and E2 `first-run` is where it gets a considered
  answer. This change deliberately does not build one.
- **`/` gets slower to reach for admins who live there.** It is two keystrokes (`⌘K` → "Go to workspace
  overview", `command.tsx:842-852`) or one click (the switcher, `switcher.tsx:58`). Accepted: the population
  that opens administration daily is one or two people per workspace; the population that opens work daily is
  everyone.

## Migration Plan

Nothing to migrate. No schema, no data, no env var, no container, no route added or removed. The change is a
redirect target, a callback URL, one new pure resolver and one seeded default. A member who had bookmarked `/`
still lands on administration; nothing they had is gone.

## Open Questions

None blocking. Two are named for whoever picks up the neighbouring changes:

- `inbox-view.tsx:515` labels `/` as **"Home"** while the deck labels `/teams/{id}` "Home". This change makes
  the collision visible and does not resolve it; it belongs with D1 `destination-budget`, which owns what the
  deck's words mean.
- `routes/index.tsx:43-45` renders the sentence *"Project management that respects your keyboard."* on a page
  that is now explicitly the administration surface. That is B1 `explanation-at-rest`'s call, not this
  change's.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **The landing decision is taken in exactly one place** — `login.tsx` — and the email sign-in paths stop
  carrying a `callbackURL` so better-auth's `redirectPlugin` cannot take a second one (D1).
- **The provider paths keep `callbackURL`, pointed at `/login`**, because a third-party redirect needs a URL
  and that is where the decision lives (D1).
- **`resolveLandingTeam` is stricter than `resolveAnchorTeam`, and `resolveAnchorTeam` does not change** —
  the deck keeps pointing where it points today (D2).
- **The redirect waits for `status === 'ready'` and `teamsResult.type === 'complete'`**, rendering the
  existing `Loading…` node meanwhile (D3).
- **The wait has an end**: `unavailable` renders the application's existing retry surface
  (`authenticated.tsx:52-67`, exported for the purpose) and a clean settled `logged-out` renders the sign-in
  form. Neither navigates, because `/login` navigating into a surface that navigates back is D4's
  starvation (D3).
- **`/invite` lands through the same resolution** rather than its own `navigate({ to: '/' })` — a team-bound
  acceptance goes to that team, using the `teamId` the accept response already returns; a workspace-level one
  falls to `resolveLandingTeam` (D10).
- **`/` keeps rendering administration** and keeps `'/': 'switcher'` in `ROUTE_HOMES`; no route is added,
  renamed or removed. The spec delta defers the Settings move rather than forbidding it, and says nothing
  about where administration lives permanently (D7).
- **The default lens is a seeded value of the existing Status axis, derived from `ISSUE_STATUSES`**, visible
  as a count and clearable through the control that already exists (D5).
- **The Board lens's default is unchanged** (D6).
- **No new table, query, mutator, migration, dependency, env var or container.** Nothing new syncs.
- **Keyboard-first**: every route this change touches is reached and cleared without a pointer; the Status
  axis is the same menu it was.
- **Sub-100ms**: the landing team is resolved from already-synced rows and the default lens is a pure
  predicate; no interaction newly waits on the network.
- **No assertion is weakened to make a gate pass.** Where a test's premise moved, the test states the new
  premise and proves the same property.
- **`ROADMAP.md` is not edited by this change** — parallel builds make it the one file two branches always
  collide on. The integrator has already added its row (`ROADMAP.md:65`, row 46, `📋 scoped`), so the debt is
  discharged rather than owed: the build updates the status column at archive time and adds nothing.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### `DEFAULT_ISSUE_STATUS_FILTER` is an `IssueFilter`, not a bare array of statuses

**Ambiguous:** D5's snippet types it `readonly IssueStatus[]`, while its consumer
(`issue-list.tsx:210`) holds a `useState<IssueFilter>` and every other reader of the value — a saved
view, the axis count, the evaluator — speaks in filters.

**Chosen:** `export const DEFAULT_ISSUE_STATUS_FILTER: IssueFilter = { status: ISSUE_STATUSES.filter(…) }`,
with `TERMINAL_ISSUE_STATUSES` beside it exactly as D5 specifies. **Why:** the name says *filter*, the
seed site takes a filter, and an array would have made the seed read
`{ status: DEFAULT_ISSUE_STATUS_FILTER }` — a value whose name promises a filter being spliced into
one. The derivation D5 actually cares about is unchanged and is what `filter.test.ts` asserts: the
status list is `ISSUE_STATUSES` minus the terminal ones, computed, never listed. A third case asserts
the object constrains **only** the status axis, so the seed can never quietly acquire a second
predicate.

### The landing decision lives in `components/auth/login-page.tsx`, mounted by `routes/login.tsx`

**Ambiguous:** tasks 3.1–3.3 place the decision in `routes/login.tsx`. A route file cannot export a
second symbol without the TanStack plugin refusing to code-split it (it says so, by name, at build
time), and a decision this load-bearing needs a component test that renders it directly.

**Chosen:** `routes/login.tsx` is now four lines — `createFileRoute('/login')({ component: LoginPage })`
— and `LoginPage` lives beside `LoginForm`, which is the house pattern every other route already
follows (`routes/inbox.tsx` → `InboxView`, `routes/teams.$teamId.index.tsx` → `TeamHome`). The
decision is still taken in exactly one place; that place is now importable. `ROUTE_HOMES` and
`routes.test.tsx` are untouched, per task 6.6.

### The roster query is issued by a child, so a signed-out visitor issues none

**Ambiguous:** hooks cannot be conditional, so the naive shape calls `useQuery` above the
`isPending` / no-session branches — for a visitor who has not signed in and whose roster resolves
through `denyAll` regardless.

**Chosen:** `LoginPage` reads only the better-auth session; when one exists it renders
`<LandingDecision />`, which is where `useSyncSession` and `useQuery` live. **Why:** a sign-in page
should not subscribe to a workspace roster on behalf of someone who has no workspace. It also keeps
`routes.test.tsx`'s four route-registration cases green **without edits** — they render `/login`
outside any `ZeroProvider`, and `useZero` throws there. A change that had queried unconditionally
would have forced an edit to the file task 6.6 names as the guard.

### `resolveLandingTeam`'s viewer is `{ userID, role }` — the two fields `SyncSessionState` already carries

D2 writes the readability test as `viewer.role === 'admin' || team.members.some(m => m.userId ===
viewer.userID)` without fixing the parameter's shape. It is typed as exactly those two nullable
fields, so both call sites (`login-page.tsx`, `invite.tsx`) pass what `useSyncSession()` already
hands them and nothing has to be assembled. A `userID` of `null` reads no team: an unidentified
caller is never a member of one.

### `/invite` now reads the accept response on the success path, not only on failure

`invite.tsx:87-89` parsed the body only when the request failed. The team-bound landing needs
`teamId`, which is on the success body, so the parse moved above the `response.ok` branch and both
paths read one body. The failure branch's `reasonText` call and copy are unchanged; the success
branch takes `teamId` only when it is a string, so a workspace-level acceptance (a null `team_id`)
falls to `resolveLandingTeam` exactly as D10 requires.

### `/invite`'s body moved to `components/auth/invite-page.tsx`, for the reason `/login`'s did

**Ambiguous:** task 6.5 asks for component coverage of `/invite`, and `InvitePage` lived inside the
route file. It cannot be reached from a test there: `vite.config.ts:23` sets `autoCodeSplitting:
true`, so the router plugin rewrites `component: InvitePage` into `lazyRouteComponent(() =>
import('…?tsr-split=component'))` — the failure is a runtime `No "lazyRouteComponent" export is
defined on the "@tanstack/react-router" mock`, three frames from anything that names the cause.

**Chosen:** `routes/invite.tsx` keeps `validateSearch` and reads the token; the page moved beside
`login-page.tsx` and takes `token` as a prop. **Why:** it is the same constraint and the same
answer as the login-page move logged above, and doing it once more makes the pattern the rule
rather than the exception. Nothing about the page's behaviour, copy or state machine changed —
the file is a move plus a prop.

### The shared e2e step waits for the door to resolve *before* it navigates

**Ambiguous:** task 7.1 asks for one "…and open the workspace overview" step. The obvious body is
`page.goto('/')` and the `workspace-name` assertion, which is what four helpers already inline.

**Chosen:** the step first waits for the URL to leave `/login` and `/invite`, and only then
navigates. **Why:** `signIn` (`support.ts:37-41`) returns the moment it has clicked submit, and the
old `workspace-name` assertion was doing the waiting by accident. A bare `goto` fired in its place
aborts whatever request is in flight — the sign-in POST, or on the invitation path the
`POST /api/invites/accept` that grants the membership the spec is about to assert. That is a
same-day flake with a cause three files away, so the wait is the step's first line rather than each
caller's problem.

### Five team-bound invitation acceptances break too, and eight role-only ones do not

`tasks.md` §7.4 names three inline sites. Opening the acceptance sites showed the split D10 makes:
an acceptance whose invite named a team now lands on that team, so its `workspace-name` assertion
moves — `attachments.spec.ts:112-116`, `mentions.spec.ts:62-65`, `notifications.spec.ts:65-68`,
`retro.spec.ts:530-533` and `search.spec.ts:313-316` are the five that select **Team (optional)**.
The other eight acceptances set a **Role only**, so `invite.team_id` is null, the acceptor belongs
to no team, and the ordinary resolution still returns `/` — exactly the reason `auth.spec.ts:80-81`
survives verbatim (§7.5). All thirteen were read rather than pattern-matched; the five that move
take the same shared step as the helpers.

### The Status axis left the seven-axis sweep instead of being rewritten inside it

**Ambiguous:** task 6.8 says rewrite the sweep's Status case to prove the same property through the
seeded default. The sweep's shape is "click one option → exactly one row survives", and under a
seeded axis a click *removes* a value. Keeping the row in the table would have made the table's own
title ("narrows to the row its predicate matches") false for one of its seven entries.

**Chosen:** the six untouched axes stay in `test.each`; Status becomes its own test that states the
seeded premise, asserts both rows are admitted first, then toggles `In Progress` **off** and proves
exactly one row survives. **Why:** the property under test is unchanged — this axis and no other
decides which row stands — and the case now reads as what it does rather than as an exception the
reader has to reconcile with the title above it.

### The `callbackURL` findings went into `reference/server-stack.md`, not only into this file

The reference's §4.4 documented `signIn.email({ email, password })` and `signIn.social({ provider
})` and said nothing about `callbackURL`. That silence is what made D1's bug plausible in the first
place. §4.4 now carries the four verified files, the asymmetry between `sign-in/email` (returns
`redirect`/`url`) and `sign-up/email` (returns neither), the default-enabled `redirectPlugin`, and
why `isSafeUrlScheme('/')` is true — checked against the installed 1.6.24 tarball rather than
recalled.

### What the gates prove, and what is still owed to CI

`typecheck`, `lint`, the full Vitest run (66 files, 790 tests) and `check-boundaries.mjs` are green
locally, as is `pnpm --filter @yapm/docs build`. Tasks 10.1's `build`, 10.2's compose smoke test and
10.3's Playwright suite are **not** ticked: port 3000 is held on this machine by an unrelated
container, so the compose smoke test cannot run here, and CI owns both it and the e2e suite. Task
10.4's scenario walk was done by reading; three of its scenarios — the sign-in landing, the
team-bound acceptance and the keyboard clear of the Status axis — are only observable in the
Playwright tier and rest on that run. 10.5 and 10.6 are hand checks against a live stack and remain
open.
