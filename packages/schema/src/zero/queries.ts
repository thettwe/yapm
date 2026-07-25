import { defineQueries, defineQuery, type Query, type Schema } from '@rocicorp/zero'
import * as z from 'zod'
import { type AuthContext, canManage, isAuthenticated, isMember } from './context.js'
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
export const CYCLES_BY_TEAM_QUERY_NAME = 'cycles.byTeam'
export const PROJECTS_ALL_QUERY_NAME = 'projects.all'
export const PROJECT_GET_QUERY_NAME = 'projects.get'
export const TRIAGE_INBOX_QUERY_NAME = 'triage.inbox'
export const LABELS_BY_TEAM_QUERY_NAME = 'labels.byTeam'
export const DEPLOYMENTS_BY_TEAM_QUERY_NAME = 'deployments.byTeam'
export const SAVED_VIEWS_BY_TEAM_QUERY_NAME = 'savedViews.byTeam'
