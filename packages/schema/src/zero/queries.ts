import { defineQueries, defineQuery, type Query, type Schema } from '@rocicorp/zero'
import * as z from 'zod'
import {
  type AuthContext,
  canManage,
  isAuthenticated,
  isMember,
  NOTIFICATION_SYNC_LIMIT,
  PM_DIGEST_SYNC_LIMIT,
} from './context.js'
import { zql } from './schema.js'

export function denyAll<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends Schema,
  TReturn,
>(q: Query<TTable, TSchema, TReturn>): Query<TTable, TSchema, TReturn> {
  return q.where(({ or }) => or())
}

export function teamScoped<TTable extends keyof Schema['tables'] & string, TReturn>(
  q: Query<TTable, Schema, TReturn>,
  ctx: AuthContext | undefined,
): Query<TTable, Schema, TReturn> {
  if (!isMember(ctx)) return denyAll(q)
  // Workspace admins have workspace-wide access, mirroring the write-side `assertTeamAccess`
  // bypass: an admin can create issues in any team, so they must be able to read them too.
  if (ctx.role === 'admin') return q
  const scoped = (q as Query<'team_membership', Schema>).whereExists('team', (team) =>
    team.whereExists('members', (m) => m.where('userId', ctx.userID)),
  )
  return scoped as unknown as Query<TTable, Schema, TReturn>
}

// THE SECOND AUTHORIZATION AXIS. Written BESIDE `teamScoped` and never inside it, and the reason is
// worth spelling out because the cheap version of this change is a one-line widening of the function
// above.
//
// `teamScoped` has 17 call sites across ~15 named queries — issues, cycles, labels, deployments,
// saved views, attachments, retros, triage, projects and the team-internal digest. Teaching it about
// a disclosure audience would silently re-scope every one of them, in a diff that reads like a
// generalization. This predicate is therefore additive: `git diff` over this file shows `teamScoped`
// and all 17 of its call sites byte-unchanged, and the falsifiable pg check re-asserts that the same
// principal who reads a published PM digest still gets zero rows from every one of those queries.
//
// Three properties, each deliberate:
//
//   1. NO WORKSPACE-ADMIN BYPASS. `teamScoped` returns `q` unfiltered for `role === 'admin'`; this
//      does not. Membership of a team's audience list IS the entitlement — the answer to "who is the
//      PM" is nobody new — so an admin who is not on the list reads nothing HERE. That is not a
//      security gain (an admin already reads every team's internal digest through `teamScoped`); it
//      is a definition that stays true when someone later asks why the two predicates differ. The
//      falsifiable check asserts the surprising case, exactly as `notifications.mine` does.
//   2. THE PUBLISHED FILTER LIVES IN THE PREDICATE, NOT IN THE QUERY. A second query over
//      `pm_digest` that forgot `publishedAt` would be an unreviewable disclosure of unreleased
//      content. Putting it here makes forgetting impossible.
//   3. DENY BY EMPTY QUERY, ENTITLEMENT BEFORE EXISTENCE — so a caller cannot tell "not allowed"
//      from "does not exist", and there is no permission oracle to probe.
//
// The audience itself arrives on `ctx`, resolved server-side per `/query` request from admin-gated
// configuration that is not in the Zero schema (a predicate runs synchronously and cannot read
// Postgres). Absent ⇒ empty ⇒ denied, so a credential minted before this change denies rather than
// throwing.
export function pmAudienceScoped<TTable extends keyof Schema['tables'] & string, TReturn>(
  q: Query<TTable, Schema, TReturn>,
  ctx: AuthContext | undefined,
): Query<TTable, Schema, TReturn> {
  if (!isMember(ctx)) return denyAll(q)
  const teamIds = ctx.pmAudienceTeamIds
  if (teamIds === undefined || teamIds.length === 0) return denyAll(q)
  const scoped = (q as Query<'pm_digest', Schema>)
    .where('teamId', 'IN', teamIds as string[])
    .where('publishedAt', 'IS NOT', null)
  return scoped as unknown as Query<TTable, Schema, TReturn>
}

// The linked work-graph subtree the reality strip is computed over: each of an issue's
// issue->PR links, its PR, and that PR's CI checks + reviews. Team-scoping is inherited — the
// subtree is only ever reached through an already `teamScoped` issue, and every linked row
// shares the issue's `team_id` (enforced at ingest), so it never widens past the boundary.
function withLinkedDelivery<TTable extends keyof Schema['tables'] & string, TReturn>(
  q: Query<TTable, Schema, TReturn>,
): Query<TTable, Schema, TReturn> {
  return (q as Query<'issue', Schema>).related('issueLinks', (link) =>
    link.related('pullRequest', (pr) => pr.related('ciChecks').related('reviews')),
  ) as unknown as Query<TTable, Schema, TReturn>
}

export const queries = defineQueries({
  workspace: {
    current: defineQuery(({ ctx }) => {
      const q = zql.workspace.orderBy('createdAt', 'asc')
      return (isMember(ctx) ? q : denyAll(q)).one()
    }),
  },
  members: {
    all: defineQuery(({ ctx }) => {
      const q = zql.workspace_member.related('user').orderBy('createdAt', 'asc')
      return isMember(ctx) ? q : denyAll(q)
    }),
  },
  users: {
    all: defineQuery(({ ctx }) => {
      const q = zql.user.orderBy('createdAt', 'asc')
      return isMember(ctx) ? q : denyAll(q)
    }),
  },
  teams: {
    all: defineQuery(({ ctx }) => {
      const q = zql.team
        .where('archivedAt', 'IS', null)
        .related('members')
        .orderBy('createdAt', 'asc')
      return isMember(ctx) ? q : denyAll(q)
    }),
  },
  invites: {
    all: defineQuery(({ ctx }) => {
      const q = zql.invite.orderBy('createdAt', 'desc')
      return canManage(ctx) ? q : denyAll(q)
    }),
  },
  preferences: {
    // User-scoped: filtered by the verified ctx.userID (never args), gated on
    // authentication rather than membership, denied by an empty query otherwise.
    mine: defineQuery(({ ctx }) => {
      if (!isAuthenticated(ctx)) return denyAll(zql.user_preference).one()
      return zql.user_preference.where('userId', ctx.userID).one()
    }),
  },
  issues: {
    // Team-scoped: only issues in teams the ctx user belongs to, narrowed to one team.
    // The membership predicate is re-evaluated server-side, so the teamId arg can never
    // widen the result beyond the caller's teams.
    // Issues awaiting triage (`needsTriage`) are held out of the normal list/board — they live
    // only in `triage.inbox` until accepted.
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(
        withLinkedDelivery(
          zql.issue
            .where('teamId', args.teamId)
            .where('needsTriage', false)
            .related('assignee')
            .related('labels')
            .related('creator')
            .orderBy('createdAt', 'desc'),
        ),
        ctx,
      ),
    ),
    // Every issue assigned to the caller across all of their teams, excluding the triage inbox.
    mine: defineQuery(({ ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.issue)
      return teamScoped(
        withLinkedDelivery(
          zql.issue
            .where('assigneeId', ctx.userID)
            .where('needsTriage', false)
            .related('assignee')
            .related('labels')
            .related('creator')
            .orderBy('updatedAt', 'desc'),
        ),
        ctx,
      )
    }),
    // The DEEP-LINK resolver, and the only reason a query exists here that `detail` does not
    // already serve: the URL carries `<TEAMKEY>-<number>`, never the row's id, and the alternative
    // was syncing the WHOLE team's backlog with its linked-delivery subtree to find one row by
    // scanning it. `(teamId, number)` is the same pair the key spells.
    //
    // The predicate is its siblings' predicate, deliberately character for character: the same
    // `teamScoped` wrapper (so the `teamId` arg can never widen past the caller's memberships), the
    // same `withLinkedDelivery` subtree, and the same `needsTriage` false filter as `issues.byTeam`
    // — an issue the list holds back in the triage inbox does not become reachable by guessing its
    // number.
    byKey: defineQuery(z.object({ teamId: z.string(), number: z.number() }), ({ args, ctx }) =>
      teamScoped(
        withLinkedDelivery(
          zql.issue
            .where('teamId', args.teamId)
            .where('number', args.number)
            .where('needsTriage', false)
            .related('assignee')
            .related('creator')
            .related('labels')
            .related('comments', (comments) =>
              comments.related('author').orderBy('createdAt', 'asc'),
            ),
        ).one(),
        ctx,
      ),
    ),
    detail: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      teamScoped(
        withLinkedDelivery(
          zql.issue
            .where('id', args.id)
            .related('assignee')
            .related('creator')
            .related('labels')
            .related('comments', (comments) =>
              comments.related('author').orderBy('createdAt', 'asc'),
            ),
        ).one(),
        ctx,
      ),
    ),
  },
  cycles: {
    // Team-scoped: only cycles in teams the ctx user belongs to, narrowed to one team.
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.cycle.where('teamId', args.teamId).orderBy('startDate', 'asc'), ctx),
    ),
  },
  projects: {
    // Workspace-level: every project in the workspace, readable by any workspace member via the
    // same `isMember` gate as workspace/teams/members (deny by empty query otherwise). This is
    // what makes the roadmap a cross-team overview. The related `issues` are re-scoped with the
    // `teamScoped` predicate so a workspace-level project query can NEVER widen issue reads past
    // the caller's teams — a member only ever sees (and computes progress over) the project's
    // issues in teams they belong to. `needsTriage` issues are held out, matching the list.
    all: defineQuery(({ ctx }) => {
      const q = zql.project
        .related('lead')
        .related('issues', (issues) =>
          teamScoped(issues.where('needsTriage', false).related('assignee'), ctx),
        )
        .orderBy('createdAt', 'asc')
      return isMember(ctx) ? q : denyAll(q)
    }),
    get: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) => {
      const q = zql.project
        .where('id', args.id)
        .related('lead')
        .related('issues', (issues) =>
          teamScoped(issues.where('needsTriage', false).related('assignee').related('team'), ctx),
        )
      return (isMember(ctx) ? q : denyAll(q)).one()
    }),
  },
  triage: {
    // Team-scoped triage inbox: exactly the issues awaiting triage in one team, oldest first
    // (FIFO). Same predicate as `issues.byTeam`; a non-member gets an empty result.
    inbox: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(
        zql.issue
          .where('teamId', args.teamId)
          .where('needsTriage', true)
          .related('assignee')
          .related('labels')
          .related('creator')
          .orderBy('createdAt', 'asc'),
        ctx,
      ),
    ),
  },
  labels: {
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.label.where('teamId', args.teamId).orderBy('name', 'asc'), ctx),
    ),
  },
  deployments: {
    // Team-scoped deploy state for the issue-detail reality view. Deployments are repo/ref-
    // anchored with no per-issue edge (design decision 4), so the detail matches them to a
    // linked PR's repo client-side; the sync stays inside the team boundary either way.
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.deployment.where('teamId', args.teamId).orderBy('updatedAt', 'desc'), ctx),
    ),
  },
  savedViews: {
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.saved_view.where('teamId', args.teamId).orderBy('createdAt', 'asc'), ctx),
    ),
  },
  digests: {
    // Team-scoped, client-read-only cycle digests (written server-side only). A non-member gets an
    // empty result via `teamScoped`; viewers read (the digest is team-internal under the ordinary
    // role ceiling). `byCycle` narrows to one cycle for the cycle view; `byTeam` lists them.
    byCycle: defineQuery(z.object({ cycleId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.cycle_digest.where('cycleId', args.cycleId), ctx).one(),
    ),
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.cycle_digest.where('teamId', args.teamId).orderBy('generatedAt', 'desc'), ctx),
    ),
  },
  pmDigests: {
    // THE AUDIENCE AXIS — the only queries in this registry that do not scope by team membership.
    // Both go through `pmAudienceScoped`, so both are limited to PUBLISHED rows of teams whose
    // audience names the caller, with no admin bypass.
    //
    // NEITHER RELATES TO ANYTHING, and that is a requirement rather than an economy: the reader has
    // no membership of the producing team, so a `.related('cycle')` would sync a row their
    // entitlement never covered. Everything they need is baked into `content` server-side.
    byCycle: defineQuery(z.object({ cycleId: z.string() }), ({ args, ctx }) =>
      pmAudienceScoped(zql.pm_digest.where('cycleId', args.cycleId), ctx).one(),
    ),
    inbox: defineQuery(({ ctx }) =>
      pmAudienceScoped(zql.pm_digest, ctx)
        .orderBy('publishedAt', 'desc')
        .limit(PM_DIGEST_SYNC_LIMIT),
    ),
  },
  pmDigestReview: {
    // THE PRODUCING TEAM'S OWN VIEW OF THE SAME TABLE, and the reason one table carries two
    // predicates: the team must be able to read the exact text BEFORE anyone outside can, which is
    // both the safety gate and the transparency mechanism. So this one is ordinary `teamScoped` and
    // carries NO `publishedAt` filter — any status, published or not.
    //
    // The pairing is the thing to keep straight in review: `pmDigests.*` is the disclosure axis and
    // is published-only; `pmDigestReview.*` is the team axis and is unfiltered. Neither relates to
    // anything, so the two cannot diverge in what they traverse either.
    byCycle: defineQuery(z.object({ cycleId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.pm_digest.where('cycleId', args.cycleId), ctx).one(),
    ),
  },
  retroAiDrafts: {
    // The AI-drafted retro artifact: team-scoped and client-read-only, written server-side only.
    // No phase filter, and none is needed — the row is created LAZILY at the `brainstorm → group`
    // advance, so during `brainstorm` there is nothing to hide (design §D1). At most one per retro.
    byRetro: defineQuery(z.object({ retroId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.retro_ai_draft.where('retroId', args.retroId), ctx).one(),
    ),
  },
  retroAiProposals: {
    // Ordered by category then rank so the panel renders Wins/Losses/Improvements in a stable order
    // without sorting client-side.
    byRetro: defineQuery(z.object({ retroId: z.string() }), ({ args, ctx }) =>
      teamScoped(
        zql.retro_ai_proposal
          .where('retroId', args.retroId)
          .orderBy('category', 'asc')
          .orderBy('rank', 'asc'),
        ctx,
      ),
    ),
  },
  retros: {
    // Team-scoped like every other work-data query. Viewers read; non-members get an empty result.
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.retro.where('teamId', args.teamId).orderBy('createdAt', 'desc'), ctx),
    ),
    // The whole board in one query. Note what is NOT here: drafts and votes. Both carry the identity
    // the anonymity and vote-privacy guarantees depend on, so they are reachable only through the
    // self-filtered queries below — and the card -> author binding is not in the Zero schema at all,
    // so no relationship can reach it. The related rows inherit the retro's team scope (they share
    // its `team_id`), exactly like the linked-delivery subtree off an issue.
    detail: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      teamScoped(
        zql.retro
          .where('id', args.id)
          .related('cycle')
          .related('nextCycle')
          .related('columns', (columns) => columns.orderBy('rank', 'asc'))
          .related('cards', (cards) => cards.orderBy('rank', 'asc'))
          .related('groups', (groups) => groups.orderBy('rank', 'asc'))
          .related('voteTallies')
          .related('actions', (actions) => actions.related('issue').orderBy('createdAt', 'asc'))
          .related('presence', (presence) => presence.related('user'))
          .one(),
        ctx,
      ),
    ),
  },
  retroDrafts: {
    // SELF-SCOPED, and a deliberate deviation from `teamScoped`: a bare filter on the verified
    // `ctx.userID` with NO workspace-admin bypass. `teamScoped` grants admins workspace-wide read,
    // which is right for work data and WRONG here — a draft is what someone is still writing, and its
    // author is the identity an anonymous retro must never reveal. Nobody but the author, ever.
    mine: defineQuery(z.object({ retroId: z.string() }), ({ args, ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.retro_draft)
      return zql.retro_draft
        .where('retroId', args.retroId)
        .where('authorId', ctx.userID)
        .orderBy('rank', 'asc')
    }),
  },
  notifications: {
    // SELF-SCOPED WITH NO WORKSPACE-ADMIN BYPASS, and that is the deviation worth naming: this is
    // the `retroDrafts.mine` shape, NOT `teamScoped`. `teamScoped` hands workspace admins
    // everything, which is right for work data and catastrophic for an inbox — nobody but the
    // recipient reads a notification, not a teammate and not an admin (design D4, H4). Written as
    // `teamScoped` this looks completely normal in review, which is why the falsifiable check
    // asserts an ADMIN gets zero rows rather than merely a non-recipient member.
    //
    // `isMember` rather than `isAuthenticated`, matching `issues.mine`: a user demoted out of
    // membership loses their inbox outright. Their rows are deleted anyway (design D11), so the
    // two agree.
    //
    // `.limit()` is load-bearing, not hygiene: a per-user table that grows forever is a hydration
    // cost on every client, and the retention sweep is the other half of that bound.
    mine: defineQuery(({ ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.notification)
      return zql.notification
        .where('recipientId', ctx.userID)
        .related('actor')
        .orderBy('createdAt', 'desc')
        .limit(NOTIFICATION_SYNC_LIMIT)
    }),
  },
  subscriptions: {
    // SELF-SCOPED WITH NO ADMIN BYPASS — the `retroDrafts.mine` shape again, NOT `teamScoped`.
    //
    // Scoping to ONE ISSUE is what bounds the synced set: at most one row for the issue currently
    // open, so this needs no `.limit()` and no retention story. A `mine` list over every issue would
    // grow forever, and truncating it would render an old subscription as "not following" and hide
    // its unfollow control — the mail trap again, by accident.
    //
    // THE ABSENCE OF ANY OTHER QUERY OVER THIS TABLE IS THE POINT. There is no watcher list and no
    // follower count for anybody, admins included; the only way to learn who follows an issue is a
    // server-side read inside the fan-out. The non-surveillance property of this change is expressed
    // as missing code rather than as a policy, so adding a second query here would silently undo it.
    mine: defineQuery(z.object({ issueId: z.string() }), ({ args, ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.issue_subscription).one()
      const q = zql.issue_subscription.where('issueId', args.issueId).where('userId', ctx.userID)
      return q.one()
    }),
  },
  attachments: {
    // Team-scoped like every other work-data query: a non-member gets an empty result, viewers
    // read. `createdAt asc` so the Files list is upload order and a new row appends rather than
    // reshuffling what somebody is looking at.
    //
    // THERE IS NO `attachment` MUTATOR ANYWHERE, AND THE ABSENCE IS DELIBERATE. Every other synced
    // table has at least one; this one has none, because a row without bytes is meaningless and a
    // Zero mutator cannot carry bytes. Every write — insert on upload, attach on save, delete —
    // happens on the REST path, where the row and the object move together. Consequences, all
    // wanted: a client cannot forge an attachment row, and the derived agent-tool registry gains
    // nothing it could call.
    byIssue: defineQuery(z.object({ issueId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.attachment.where('issueId', args.issueId).orderBy('createdAt', 'asc'), ctx),
    ),
  },
  retroVotes: {
    // SELF-SCOPED for the same reason and with the same deviation: a voter sees their own dots (which
    // is how the remaining-budget readout stays instant and offline-correct), and everyone else reads
    // only `retro_vote_tally`. Who voted for what never leaves the server for anyone else.
    mine: defineQuery(z.object({ retroId: z.string() }), ({ args, ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.retro_vote)
      return zql.retro_vote.where('retroId', args.retroId).where('voterId', ctx.userID)
    }),
  },
  retroAiReactions: {
    // SELF-SCOPED WITH NO WORKSPACE-ADMIN BYPASS — the `retroDrafts.mine` / `retroVotes.mine` shape
    // again, NOT `teamScoped`. `teamScoped` hands workspace admins every team's work data, which is
    // right for issues and wrong here for exactly the reason a retro exists: it is the one surface
    // where a member is invited to say something unwelcome, and a signal an admin can read is not a
    // signal a quiet dissenter will send. Written as `teamScoped` this looks completely normal in
    // review, which is why the falsifiable check asserts an ADMIN gets zero rows rather than merely
    // a non-recipient member.
    //
    // THE ABSENCE OF ANY OTHER QUERY OVER THIS TABLE IS THE POINT. There is no "n of m responded"
    // count and no aggregate for anybody, so "no client can read another member's reaction" is
    // expressed as missing code rather than as a policy — and the verdict a client does read is
    // written once by the server at the phase advance, with no per-person dimension in it.
    mine: defineQuery(z.object({ retroId: z.string() }), ({ args, ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.retro_ai_reaction)
      return zql.retro_ai_reaction.where('retroId', args.retroId).where('userId', ctx.userID)
    }),
  },
})

export const WORKSPACE_CURRENT_QUERY_NAME = 'workspace.current'
export const MEMBERS_ALL_QUERY_NAME = 'members.all'
export const USERS_ALL_QUERY_NAME = 'users.all'
export const TEAMS_ALL_QUERY_NAME = 'teams.all'
export const INVITES_ALL_QUERY_NAME = 'invites.all'
export const PREFERENCES_MINE_QUERY_NAME = 'preferences.mine'
export const ISSUES_BY_TEAM_QUERY_NAME = 'issues.byTeam'
export const ISSUES_MINE_QUERY_NAME = 'issues.mine'
export const ISSUE_DETAIL_QUERY_NAME = 'issues.detail'
export const ISSUE_BY_KEY_QUERY_NAME = 'issues.byKey'
export const CYCLES_BY_TEAM_QUERY_NAME = 'cycles.byTeam'
export const PROJECTS_ALL_QUERY_NAME = 'projects.all'
export const PROJECT_GET_QUERY_NAME = 'projects.get'
export const TRIAGE_INBOX_QUERY_NAME = 'triage.inbox'
export const LABELS_BY_TEAM_QUERY_NAME = 'labels.byTeam'
export const DEPLOYMENTS_BY_TEAM_QUERY_NAME = 'deployments.byTeam'
export const SAVED_VIEWS_BY_TEAM_QUERY_NAME = 'savedViews.byTeam'
export const DIGESTS_BY_CYCLE_QUERY_NAME = 'digests.byCycle'
export const DIGESTS_BY_TEAM_QUERY_NAME = 'digests.byTeam'
export const PM_DIGESTS_BY_CYCLE_QUERY_NAME = 'pmDigests.byCycle'
export const PM_DIGESTS_INBOX_QUERY_NAME = 'pmDigests.inbox'
export const PM_DIGEST_REVIEW_BY_CYCLE_QUERY_NAME = 'pmDigestReview.byCycle'
export const RETRO_AI_DRAFTS_BY_RETRO_QUERY_NAME = 'retroAiDrafts.byRetro'
export const RETRO_AI_PROPOSALS_BY_RETRO_QUERY_NAME = 'retroAiProposals.byRetro'
export const RETROS_BY_TEAM_QUERY_NAME = 'retros.byTeam'
export const RETRO_DETAIL_QUERY_NAME = 'retros.detail'
export const RETRO_DRAFTS_MINE_QUERY_NAME = 'retroDrafts.mine'
export const RETRO_VOTES_MINE_QUERY_NAME = 'retroVotes.mine'
export const RETRO_AI_REACTIONS_MINE_QUERY_NAME = 'retroAiReactions.mine'
export const NOTIFICATIONS_MINE_QUERY_NAME = 'notifications.mine'
export const SUBSCRIPTIONS_MINE_QUERY_NAME = 'subscriptions.mine'
export const ATTACHMENTS_BY_ISSUE_QUERY_NAME = 'attachments.byIssue'
