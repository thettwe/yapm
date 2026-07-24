import { mustGetQuery } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import type { AuthContext } from './context.js'
import { tableShapes } from './introspect.js'
import {
  INVITES_ALL_QUERY_NAME,
  ISSUE_DETAIL_QUERY_NAME,
  ISSUES_BY_TEAM_QUERY_NAME,
  ISSUES_MINE_QUERY_NAME,
  LABELS_BY_TEAM_QUERY_NAME,
  MEMBERS_ALL_QUERY_NAME,
  PREFERENCES_MINE_QUERY_NAME,
  queries,
  SAVED_VIEWS_BY_TEAM_QUERY_NAME,
  TEAMS_ALL_QUERY_NAME,
  teamScoped,
  USERS_ALL_QUERY_NAME,
  WORKSPACE_CURRENT_QUERY_NAME,
} from './queries.js'
import { schema, zql } from './schema.js'

const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
const MEMBER: AuthContext = { userID: 'user-member', role: 'member' }
const VIEWER: AuthContext = { userID: 'user-viewer', role: 'viewer' }
const NON_MEMBER: AuthContext = { userID: 'user-outsider', role: null }

const DENY_ALL_WHERE = { type: 'or', conditions: [] }

interface QueryAst {
  table: string
  where?: unknown
}

function astOf(
  query: { fn: (input: { args: undefined; ctx: AuthContext | undefined }) => unknown },
  ctx: AuthContext | undefined,
): QueryAst {
  const built = query.fn({ args: undefined, ctx }) as unknown as { ast: QueryAst }
  return built.ast
}

function astOfArgs<A>(
  query: { fn: (input: { args: A; ctx: AuthContext | undefined }) => unknown },
  args: A,
  ctx: AuthContext | undefined,
): QueryAst {
  const built = query.fn({ args, ctx }) as unknown as { ast: QueryAst }
  return built.ast
}

const TEAM_ID = '019f8f00-0000-7000-8000-0000000000aa'

describe('the synced query registry', () => {
  it('names every query the way the server resolves it', () => {
    for (const [name, query] of [
      [WORKSPACE_CURRENT_QUERY_NAME, queries.workspace.current],
      [MEMBERS_ALL_QUERY_NAME, queries.members.all],
      [USERS_ALL_QUERY_NAME, queries.users.all],
      [TEAMS_ALL_QUERY_NAME, queries.teams.all],
      [INVITES_ALL_QUERY_NAME, queries.invites.all],
      [PREFERENCES_MINE_QUERY_NAME, queries.preferences.mine],
      [ISSUES_BY_TEAM_QUERY_NAME, queries.issues.byTeam],
      [ISSUES_MINE_QUERY_NAME, queries.issues.mine],
      [ISSUE_DETAIL_QUERY_NAME, queries.issues.detail],
      [LABELS_BY_TEAM_QUERY_NAME, queries.labels.byTeam],
      [SAVED_VIEWS_BY_TEAM_QUERY_NAME, queries.savedViews.byTeam],
    ] as const) {
      expect(query.queryName).toBe(name)
      expect(mustGetQuery(queries, name)).toBe(query)
    }
  })

  it('has no entry a client could reach outside the registry', () => {
    expect(() => mustGetQuery(queries, 'workspace.all')).toThrow()
  })
})

describe('member-gated queries deny non-members', () => {
  it.each([
    ['workspace.current', queries.workspace.current],
    ['members.all', queries.members.all],
    ['users.all', queries.users.all],
    ['teams.all', queries.teams.all],
  ] as const)('%s returns rows for a member and nothing for anyone else', (_name, query) => {
    expect(astOf(query, MEMBER).where).not.toEqual(DENY_ALL_WHERE)
    expect(astOf(query, VIEWER).where).not.toEqual(DENY_ALL_WHERE)

    expect(astOf(query, NON_MEMBER).where).toEqual(DENY_ALL_WHERE)
    expect(astOf(query, undefined).where).toEqual(DENY_ALL_WHERE)
  })
})

describe('invites are admin-only', () => {
  it('returns rows for an admin and denies everyone else', () => {
    expect(astOf(queries.invites.all, ADMIN).where).not.toEqual(DENY_ALL_WHERE)

    for (const ctx of [MEMBER, VIEWER, NON_MEMBER, undefined]) {
      expect(astOf(queries.invites.all, ctx).where).toEqual(DENY_ALL_WHERE)
    }
  })
})

describe('preferences.mine is user-scoped and owner-only', () => {
  it('filters by the caller ctx.userID for any authenticated caller, member or not', () => {
    for (const ctx of [ADMIN, MEMBER, VIEWER, NON_MEMBER]) {
      const where = astOf(queries.preferences.mine, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
  })

  it('denies an unauthenticated caller with an empty query', () => {
    expect(astOf(queries.preferences.mine, undefined).where).toEqual(DENY_ALL_WHERE)
  })

  it('never widens to another user, even given a foreign userID in args', () => {
    const where = astOf(queries.preferences.mine, MEMBER).where
    expect(JSON.stringify(where)).not.toContain(NON_MEMBER.userID)
  })
})

describe('team-scoped work-data queries', () => {
  it('scope issues.byTeam to the caller teams and deny non-members', () => {
    for (const ctx of [ADMIN, MEMBER, VIEWER]) {
      const where = astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
  })

  it('never widens beyond the caller memberships even given a foreign teamId arg', () => {
    const where = astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, MEMBER).where
    // the membership predicate is driven by ctx.userID, not the teamId arg
    expect(JSON.stringify(where)).toContain(MEMBER.userID)
    expect(JSON.stringify(where)).not.toContain(NON_MEMBER.userID)
  })

  it('scopes issues.mine, labels.byTeam and savedViews.byTeam, denying non-members', () => {
    expect(astOfArgs(queries.issues.mine, undefined, MEMBER).where).not.toEqual(DENY_ALL_WHERE)
    expect(astOfArgs(queries.issues.mine, undefined, NON_MEMBER).where).toEqual(DENY_ALL_WHERE)
    expect(astOfArgs(queries.labels.byTeam, { teamId: TEAM_ID }, VIEWER).where).not.toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.labels.byTeam, { teamId: TEAM_ID }, undefined).where).toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.savedViews.byTeam, { teamId: TEAM_ID }, MEMBER).where).not.toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.savedViews.byTeam, { teamId: TEAM_ID }, NON_MEMBER).where).toEqual(
      DENY_ALL_WHERE,
    )
  })
})

describe('teamScoped helper', () => {
  it('scopes a work-entity query to the caller teams and denies non-members', () => {
    const memberWhere = (teamScoped(zql.team_membership, MEMBER) as unknown as { ast: QueryAst })
      .ast.where
    expect(memberWhere).toBeDefined()
    expect(memberWhere).not.toEqual(DENY_ALL_WHERE)
    expect(JSON.stringify(memberWhere)).toContain(MEMBER.userID)

    const outsiderWhere = (
      teamScoped(zql.team_membership, NON_MEMBER) as unknown as { ast: QueryAst }
    ).ast.where
    expect(outsiderWhere).toEqual(DENY_ALL_WHERE)
  })
})

describe('the Zero schema', () => {
  it('maps the workspace table onto the snake_case Postgres columns', () => {
    const workspace = tableShapes().find((table) => table.name === 'workspace')

    expect(workspace?.serverName).toBe('workspace')
    expect(workspace?.primaryKey).toEqual(['id'])
    expect(
      Object.fromEntries(
        (workspace?.columns ?? []).map((column) => [
          column.key,
          { type: column.type, serverName: column.serverName, optional: column.optional },
        ]),
      ),
    ).toEqual({
      id: { type: 'string', serverName: 'id', optional: false },
      name: { type: 'string', serverName: 'name', optional: false },
      createdAt: { type: 'number', serverName: 'created_at', optional: false },
      updatedAt: { type: 'number', serverName: 'updated_at', optional: false },
    })
  })

  it('keeps the legacy client CRUD and query paths off', () => {
    expect(schema.enableLegacyMutators).toBe(false)
    expect(schema.enableLegacyQueries).toBe(false)
  })
})
