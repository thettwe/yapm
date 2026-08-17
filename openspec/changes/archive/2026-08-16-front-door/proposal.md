## Why

Sign in to yapm and the first screen is **Members, Teams, Invitations**. `apps/web/src/routes/index.tsx`
renders `WorkspaceName` (:34), `MembersPanel` (:47), `TeamsPanel` (:48) and `InvitesPanel` (:49) — workspace
administration, and nothing else. The morning digest that this design series spent a whole change building
(`team-home-digest`, PR #31) sits one click behind it. The front door opens into the utility closet.

Then the closet's neighbour: opening Issues on the seeded workspace shows **54 Done of 57**. The default lens
is `useState<IssueFilter>({})` (`apps/web/src/issues/issue-list.tsx:210`), and an absent status axis matches
everything — `packages/schema/src/zero/filter.ts:31` declares `readonly status?: readonly IssueStatus[]` and
the evaluator at `:86` reads `if (filter.status && !filter.status.includes(issue.status)) return false`. So the
three live rows are buried under an archive, in a list whose own spec calls itself the surface where "the work
graph is visible where the work is".

`SCOPE-legibility.md` states the finding plainly: the product "becomes too complicated and too text heavy",
and C1 is the cheapest, most visible relief in the family. Neither half of it is a redesign. Both are the
product failing to point at its own best work.

Vision principles served: **speed is the feature** — the fastest interaction is the one nobody has to make,
and today every member makes two (read an admin page, then click through to work); **opinionated defaults** —
"a list of everything ever" is not an opinion, it is the absence of one; **sub-100ms** — the landing team is
resolved from rows already synced and the default lens is a pure predicate over them, so nothing here newly
waits on the network.

## What Changes

**Signing in lands on the anchor team's Home.** The redirect that exists today is
`apps/web/src/routes/login.tsx:21` — `return <Navigate to="/" />` inside `if (session) {`. It becomes a
navigation to `/teams/{teamId}`, resolved from the anchor concept `app-frame/spec.md:181` already owns and
`apps/web/src/frame/team-context.ts:49-59` already implements.

**But `login.tsx:21` is not the only redirect, and the brief that scoped this change believed it was.**
`apps/web/src/components/auth/login-form.tsx:19` declares `const CALLBACK_URL = '/'` and passes it to all four
sign-in paths — email sign-in (:54), email sign-up (:59), GitHub (:78), SSO (:94). better-auth 1.6.24's
`sign-in/email` returns `redirect: !!ctx.body.callbackURL` and `url: ctx.body.callbackURL`
(`dist/api/routes/sign-in.mjs:335-341`), and the default-enabled `redirectPlugin`
(`dist/client/config.mjs:50`, `dist/client/fetch-plugins.mjs:3-15`) responds with
`window.location.href = context.data.url`. `sign-up/email` returns neither field
(`dist/api/routes/sign-up.mjs:262-265`). So today **sign-up navigates client-side through `login.tsx:21`
while sign-in performs a full page load through better-auth** — two mechanisms for one act, only one of them
in yapm's source. Changing `login.tsx:21` alone would fix the front door for people creating an account and
leave it broken for everyone who already has one. This change makes the landing decision happen in exactly
one place, and adds a test that says so.

**And there is a third mechanism, on a route nobody was looking at.** `apps/web/src/routes/invite.tsx:97-99`
navigates every invitation acceptor to `/` — including the acceptor of a **team-bound** invite, who by
definition now has a team, because `packages/schema/src/db/invite.ts:118-128` just wrote their
`team_membership` row and `:139-145` returned the `teamId` that `apps/server/src/auth-routes.ts:203-208`
already hands back to the browser. The invite page throws that success body away (`invite.tsx:87-89`). So
`/invite` routes through the same landing resolution as `/login`, passing the accepted team in where there is
one; `design.md` §D10 has the reasoning, including what dropping `callbackURL` does on the invite page, where
`LoginForm` is also mounted (`invite.tsx:57`).

**The landing team is one the caller can actually read.** `queries.teams.all()`
(`packages/schema/src/zero/queries.ts:108-116`) returns **every non-archived team in the workspace** to any
member, so `resolveAnchorTeam`'s `return teams[0] ?? null` (`team-context.ts:58`) can name a team the caller
does not belong to. The deck may point there — `team-context.ts:13-19` records why: "navigation is an offer,
and an offer can be wrong without lying". A redirect is not an offer. The landing resolver therefore applies a
stricter test than the deck's, using the `members` relation `teams.all()` already carries
(`packages/schema/src/zero/schema.ts:671-676`); `resolveAnchorTeam` and the deck are unchanged.

**Where no such team exists, the caller lands on `/`, exactly as today.** A workspace with no teams, a member
who belongs to none, an authenticated non-member at the access gate: all three land on administration, because
for all three that page **is** the work. This is `app-frame/spec.md:202-206`'s existing scenario — "A workspace
with no teams drops the stops" — arriving at its logical destination rather than being contradicted.

**The redirect waits for the roster to settle, and the wait ends.** A landing decision computed while
`teams.all()` is still empty sends a member with five teams to administration. The decision holds behind the
sync session reporting a role and the teams query reporting `complete`, on the precedent
`apps/web/src/home/team-home.tsx:56` and `:106-112` already set. `login.tsx:10-18` already renders the
surface it waits on. But `ready` is not the only settled state — `apps/web/src/zero/provider.tsx:40` declares
three (`'pending' | 'logged-out' | 'ready'`) and carries `unavailable` beside them at `:54` — so a caller
whose sync credential cannot be minted would otherwise wait on that surface forever. `unavailable` renders
the retry surface the app already uses (`apps/web/src/components/authenticated.tsx:52-67`); a clean settled
`logged-out` renders the sign-in form. Neither navigates: `/login` sending a live session at a route that
sends it back is the renderer starvation `authenticated.tsx:22-30` was written to prevent.

**The Issues default lens stops including terminal statuses.** `Done` and `Canceled` leave the default, and
they leave it **as a visible, clearable value of the Status axis** rather than a hidden rule: the bar reads
`Status 4`, the menu shows which four, and clearing it brings the archive back. The default is *derived* —
`ISSUE_STATUSES` minus the terminal pair — so a status added later joins the default rather than being
silently excluded by a hard-coded list.

**The Board lens does not change.** `apps/web/src/board/board.tsx:269` keeps `useState<IssueFilter>({})`, and
the reason is structural: the board's columns **are** the status axis (`apps/web/src/board/model.ts:30` maps
`STATUS_ORDER` unconditionally, which is why `apps/web/e2e/board.spec.ts:117` is immune to all of this), and
a Done column you drag a card into and watch it vanish is a broken board. `issue-list.md:96` already tells
readers "Filters are per-lens: switching starts the other lens unfiltered", so the two lenses differing is
the documented contract, not a new inconsistency.

Non-goals — deliberately not built:

- **Moving administration to `/settings/workspace`.** `/` keeps rendering Members, Teams and Invitations, and
  keeps both of its homes in the frame (`routes.test.tsx:133` — `'/': 'switcher'`; `switcher.tsx:58`;
  `app-frame.tsx:104-108`'s `frame:workspace` command). The move is investigated and costed in `design.md` §D7
  and deliberately declined here: 22 mid-test navigations to `/` across 13 e2e specs mean different things,
  and moving the route would put a route rename inside a change whose whole value is a one-line redirect.
  **Declined is not forbidden**: the spec delta says the administration surface stays reachable from the
  frame and that this change does not move it, and deliberately does not write "administration SHALL live at
  `/`" into the record for a later Settings change to have to argue its way back out of.
- **Team Home's onward footer.** It is spec-mandated (`openspec/specs/team-home/spec.md:12`), and the honest
  count is that **four of its five items are already deck-reachable and one is not**:
  `apps/web/src/home/team-home.tsx:985` links Issues (a stop, `routes.test.tsx:144`), `:1000` Delivery (a
  stop, `:147`), `:1011` Retro and `:1018` Roadmap (both behind `more▾`, `:148` and `:150`), and `:992` Board
  — a lens (`:153`), and the only one of the five with no home in the deck at all. So the footer is mostly
  duplication with one genuine exception, and deciding how much of it to ration is D1 `destination-budget`'s
  work, not this change's.
- **A first-run surface.** What a workspace with no cycle, no issues and no linked change should show is
  E2 `first-run` in `SCOPE-legibility.md`, and it needs C1 to land first. This change routes the zero-team
  caller to the page that exists today and builds no new one.
- **The reality track, the phrases and the footnotes.** B1 and B2 own those. Nothing here touches a phrase, a
  register or a `how ·`.
- **No new table, query, mutator, migration, route, dependency, env var or container.**

## Capabilities

### New Capabilities

<!-- none: this change re-points an existing redirect and changes one default -->

### Modified Capabilities

- `app-frame`: a new requirement that signing in lands on work rather than administration — which team is
  chosen, why it is a stricter test than the deck's anchor, what happens when there is no such team, that the
  decision waits for the roster (and that a complete-but-unidentified roster is not a settled one), that the
  wait ends in a surface the caller can act on rather than an endless spinner, that it is taken in exactly
  one place including the invitation door, and that the administration surface stays reachable from the frame
  — without the requirement claiming where it should permanently live.
- `issue-list`: the list's default lens excludes terminal statuses, stated as a visible value of the Status
  axis rather than a hidden rule, with the fixed group order and every filter capability unchanged. Because
  a `## MODIFIED Requirements` block replaces its requirement whole, every live scenario is carried; one is
  reworded, and `design.md` §D5 says which and why — the "six fixed status categories" phrasing becomes "the
  status categories in the fixed order", since the default lens renders four groups while the six-category
  order itself is unchanged and still stated in the requirement prose.

## Impact

- `apps/web/src/routes/login.tsx`: the one landing decision — the anchor-aware redirect at `:21`, gated on the
  sync session and the settled roster, with the two settled-but-not-`ready` branches (`unavailable`, clean
  `logged-out`) resolving to a surface rather than a spinner.
- `apps/web/src/components/authenticated.tsx`: `SyncUnavailable` (`:52-67`) is exported so `/login` renders
  the same retry surface, testid and all, rather than a second copy of it. Nothing about the component's
  behaviour changes and `authenticated.test.tsx:93`, `:107` and `:137` keep passing untouched.
- `apps/web/src/routes/invite.tsx`: `:97-99` stops navigating to `/` on its own authority — a team-bound
  acceptance goes to that team using the `teamId` the accept response already returns
  (`apps/server/src/auth-routes.ts:203-208`, which is unchanged), a workspace-level one goes through the same
  resolution `/login` uses.
- `apps/web/src/components/auth/login-form.tsx`: `CALLBACK_URL` at `:19` stops being `/`. The two email paths
  (`:54`, `:59`) drop `callbackURL` entirely so better-auth's `redirectPlugin` cannot fire a second landing;
  GitHub (`:78`) and SSO (`:94`) keep one, pointed at `/login`, because a third-party callback structurally
  needs a URL and the honest URL is the one place the decision is taken. The form is mounted on **two**
  routes — `login.tsx:26` and `invite.tsx:57` — so both edits land on the invite page as well; `design.md`
  §D10 records what each does there, including the live bug the email edit incidentally fixes.
- `apps/web/src/frame/team-context.ts`: `resolveLandingTeam` beside `resolveAnchorTeam`, over the same
  `FrameTeam` shape plus the `members` relation. `resolveAnchorTeam` (`:49-59`) and `useAnchorTeam` (`:61-77`)
  are unchanged — the deck does not move.
- `packages/schema/src/zero/filter.ts`: `TERMINAL_ISSUE_STATUSES` and a derived `DEFAULT_ISSUE_STATUS_FILTER`,
  exported through `packages/schema/src/index.ts`. No change to `IssueFilter`, `issueFilterSchema` or
  `matchesFilter` — the default is a value the existing axis already accepts.
- `apps/web/src/issues/issue-list.tsx:210`: the default lens seeds from that constant.
  `apps/web/src/board/board.tsx:269` is deliberately left alone, with the reason in a comment.
- Tests updated, every one named by file and line in `tasks.md`: `login-form.test.tsx` (three `callbackURL: '/'`
  assertions), `issue-list.test.tsx` (a `done` fixture and the Status-axis case of the seven-axis sweep),
  `team-context.test.ts` (new cases beside the anchor suite), and the twenty-four e2e helpers that assert
  `workspace-name` immediately after signing in. `apps/web/e2e/support.ts`'s `ensureAccount` (`:46-64`)
  survives untouched — it asserts nothing about the landing route, so the breakage is entirely in its callers.
- `apps/web/e2e/triage.spec.ts:140-143` is the only e2e assertion that needs a terminal-status issue to appear
  in the default Issues lens. Its Todo sibling at `:179-182` and `board.spec.ts:117` are unaffected.
- `scripts/smoke.mjs:76` (`app.goto(url + '/')` waiting on `connection-status`) is untouched and must stay
  green: a fresh workspace has no team, so the redirect never fires there — which is exactly why the zero-team
  fallback matters.
- No dependency, env var, container, table, query, mutator or migration is added or changed. `ROADMAP.md` is
  not edited by this branch — parallel builds collide there — and it does not need to be: the integrator has
  already added row 46 (`ROADMAP.md:65`, `📋 scoped`). The build only flips its status column at archive time.

Docs: `apps/docs/src/content/docs/features/app-frame.md` (where sign-in lands, and the §"Off a team"
paragraph at `:71-86` gaining the distinction between the deck's anchor and the landing team);
`features/issue-list.md` §"The filter bar" (`:86-130` — the default Status axis, that it is clearable, and
that the Board lens starts unfiltered); `features/team-home.md` (Home is the front door);
`README.md:92-93` (the digest is what you see when you sign in).
