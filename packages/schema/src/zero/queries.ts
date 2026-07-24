import { defineQueries, defineQuery, type Query, type Schema } from '@rocicorp/zero'
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
})

export const WORKSPACE_CURRENT_QUERY_NAME = 'workspace.current'
export const MEMBERS_ALL_QUERY_NAME = 'members.all'
export const USERS_ALL_QUERY_NAME = 'users.all'
export const TEAMS_ALL_QUERY_NAME = 'teams.all'
export const INVITES_ALL_QUERY_NAME = 'invites.all'
export const PREFERENCES_MINE_QUERY_NAME = 'preferences.mine'
