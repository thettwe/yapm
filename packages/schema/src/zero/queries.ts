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
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(
        zql.issue
          .where('teamId', args.teamId)
          .related('assignee')
          .related('labels')
          .related('creator')
          .orderBy('createdAt', 'desc'),
        ctx,
      ),
    ),
    // Every issue assigned to the caller across all of their teams.
    mine: defineQuery(({ ctx }) => {
      if (!isMember(ctx)) return denyAll(zql.issue)
      return teamScoped(
        zql.issue
          .where('assigneeId', ctx.userID)
          .related('assignee')
          .related('labels')
          .related('creator')
          .orderBy('updatedAt', 'desc'),
        ctx,
      )
    }),
    detail: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      teamScoped(
        zql.issue
          .where('id', args.id)
          .related('assignee')
          .related('creator')
          .related('labels')
          .related('comments', (comments) => comments.related('author').orderBy('createdAt', 'asc'))
          .one(),
        ctx,
      ),
    ),
  },
  labels: {
    byTeam: defineQuery(z.object({ teamId: z.string() }), ({ args, ctx }) =>
      teamScoped(zql.label.where('teamId', args.teamId).orderBy('name', 'asc'), ctx),
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
export const LABELS_BY_TEAM_QUERY_NAME = 'labels.byTeam'
export const SAVED_VIEWS_BY_TEAM_QUERY_NAME = 'savedViews.byTeam'
