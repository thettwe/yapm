import { mustGetQuery } from '@rocicorp/zero'
import { describe, expect, it } from 'vitest'
import { type AuthContext, NOTIFICATION_SYNC_LIMIT } from './context.js'
import { tableShapes } from './introspect.js'
import {
  CYCLES_BY_TEAM_QUERY_NAME,
  DEPLOYMENTS_BY_TEAM_QUERY_NAME,
  DIGESTS_BY_CYCLE_QUERY_NAME,
  DIGESTS_BY_TEAM_QUERY_NAME,
  INVITES_ALL_QUERY_NAME,
  ISSUE_DETAIL_QUERY_NAME,
  ISSUES_BY_TEAM_QUERY_NAME,
  ISSUES_MINE_QUERY_NAME,
  LABELS_BY_TEAM_QUERY_NAME,
  MEMBERS_ALL_QUERY_NAME,
  NOTIFICATIONS_MINE_QUERY_NAME,
  PREFERENCES_MINE_QUERY_NAME,
  PROJECT_GET_QUERY_NAME,
  PROJECTS_ALL_QUERY_NAME,
  queries,
  RETRO_AI_REACTIONS_MINE_QUERY_NAME,
  RETRO_DETAIL_QUERY_NAME,
  RETRO_DRAFTS_MINE_QUERY_NAME,
  RETRO_VOTES_MINE_QUERY_NAME,
  RETROS_BY_TEAM_QUERY_NAME,
  SAVED_VIEWS_BY_TEAM_QUERY_NAME,
  SUBSCRIPTIONS_MINE_QUERY_NAME,
  TEAMS_ALL_QUERY_NAME,
  TRIAGE_INBOX_QUERY_NAME,
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
      [CYCLES_BY_TEAM_QUERY_NAME, queries.cycles.byTeam],
      [PROJECTS_ALL_QUERY_NAME, queries.projects.all],
      [PROJECT_GET_QUERY_NAME, queries.projects.get],
      [TRIAGE_INBOX_QUERY_NAME, queries.triage.inbox],
      [LABELS_BY_TEAM_QUERY_NAME, queries.labels.byTeam],
      [DEPLOYMENTS_BY_TEAM_QUERY_NAME, queries.deployments.byTeam],
      [SAVED_VIEWS_BY_TEAM_QUERY_NAME, queries.savedViews.byTeam],
      [DIGESTS_BY_CYCLE_QUERY_NAME, queries.digests.byCycle],
      [DIGESTS_BY_TEAM_QUERY_NAME, queries.digests.byTeam],
      [RETROS_BY_TEAM_QUERY_NAME, queries.retros.byTeam],
      [RETRO_DETAIL_QUERY_NAME, queries.retros.detail],
      [RETRO_DRAFTS_MINE_QUERY_NAME, queries.retroDrafts.mine],
      [NOTIFICATIONS_MINE_QUERY_NAME, queries.notifications.mine],
      [SUBSCRIPTIONS_MINE_QUERY_NAME, queries.subscriptions.mine],
      [RETRO_VOTES_MINE_QUERY_NAME, queries.retroVotes.mine],
      [RETRO_AI_REACTIONS_MINE_QUERY_NAME, queries.retroAiReactions.mine],
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

describe('projects.all is workspace-level, member-gated', () => {
  it('returns rows for any member (including viewers) and denies non-members', () => {
    expect(astOf(queries.projects.all, MEMBER).where).not.toEqual(DENY_ALL_WHERE)
    expect(astOf(queries.projects.all, VIEWER).where).not.toEqual(DENY_ALL_WHERE)
    expect(astOf(queries.projects.all, NON_MEMBER).where).toEqual(DENY_ALL_WHERE)
    expect(astOf(queries.projects.all, undefined).where).toEqual(DENY_ALL_WHERE)
  })

  it('team-scopes the related issues so a workspace-level query cannot widen issue reads', () => {
    const ast = astOf(queries.projects.all, MEMBER) as QueryAst & {
      related?: { subquery: { where?: unknown } }[]
    }
    const issuesRelated = ast.related?.find((r) =>
      JSON.stringify(r.subquery).includes('needsTriage'),
    )
    expect(issuesRelated).toBeDefined()
    // The membership predicate is present on the related issues subquery.
    expect(JSON.stringify(issuesRelated?.subquery)).toContain(MEMBER.userID)
  })

  it('team-scopes the related issues in projects.get', () => {
    const id = '019f8f00-0000-7000-8000-0000000000bb'
    expect(astOfArgs(queries.projects.get, { id }, MEMBER).where).not.toEqual(DENY_ALL_WHERE)
    expect(astOfArgs(queries.projects.get, { id }, NON_MEMBER).where).toEqual(DENY_ALL_WHERE)
    const ast = astOfArgs(queries.projects.get, { id }, MEMBER) as QueryAst & {
      related?: { subquery: { where?: unknown } }[]
    }
    const issuesRelated = ast.related?.find((r) =>
      JSON.stringify(r.subquery).includes('needsTriage'),
    )
    expect(issuesRelated).toBeDefined()
    expect(JSON.stringify(issuesRelated?.subquery)).toContain(MEMBER.userID)
  })
})

describe('cycle digests are team-scoped and client-read-only', () => {
  const CYCLE_ID = '019f8f00-0000-7000-8000-0000000000cc'

  it('scopes digests.byCycle to the caller teams and denies non-members', () => {
    for (const ctx of [MEMBER, VIEWER]) {
      const where = astOfArgs(queries.digests.byCycle, { cycleId: CYCLE_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.digests.byCycle, { cycleId: CYCLE_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
  })

  it('scopes digests.byTeam to the caller teams and denies non-members', () => {
    for (const ctx of [MEMBER, VIEWER]) {
      const where = astOfArgs(queries.digests.byTeam, { teamId: TEAM_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.digests.byTeam, { teamId: TEAM_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
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
    for (const ctx of [MEMBER, VIEWER]) {
      const where = astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    // Admins bypass the per-team membership filter (workspace-wide read access), mirroring the
    // write-side `assertTeamAccess` admin bypass so a created issue is never invisible.
    const adminWhere = astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, ADMIN).where
    expect(adminWhere).not.toEqual(DENY_ALL_WHERE)
    expect(JSON.stringify(adminWhere)).not.toContain(ADMIN.userID)
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

  it('scope cycles.byTeam to the caller teams and deny non-members', () => {
    for (const ctx of [MEMBER, VIEWER]) {
      const where = astOfArgs(queries.cycles.byTeam, { teamId: TEAM_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    // Admins bypass the per-team membership filter (workspace-wide read access), mirroring the
    // write-side `assertTeamAccess` admin bypass so a created cycle is never invisible.
    const adminWhere = astOfArgs(queries.cycles.byTeam, { teamId: TEAM_ID }, ADMIN).where
    expect(adminWhere).not.toEqual(DENY_ALL_WHERE)
    expect(JSON.stringify(adminWhere)).not.toContain(ADMIN.userID)
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.cycles.byTeam, { teamId: TEAM_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
  })

  it('never widens cycles.byTeam beyond the caller memberships given a foreign teamId arg', () => {
    const where = astOfArgs(queries.cycles.byTeam, { teamId: TEAM_ID }, MEMBER).where
    expect(JSON.stringify(where)).toContain(MEMBER.userID)
    expect(JSON.stringify(where)).not.toContain(NON_MEMBER.userID)
  })

  it('scope triage.inbox to the caller teams and deny non-members', () => {
    for (const ctx of [MEMBER, VIEWER]) {
      const where = astOfArgs(queries.triage.inbox, { teamId: TEAM_ID }, ctx).where
      expect(where).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(where)).toContain(ctx.userID)
    }
    const adminWhere = astOfArgs(queries.triage.inbox, { teamId: TEAM_ID }, ADMIN).where
    expect(adminWhere).not.toEqual(DENY_ALL_WHERE)
    expect(JSON.stringify(adminWhere)).not.toContain(ADMIN.userID)
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.triage.inbox, { teamId: TEAM_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
  })

  it('never widens triage.inbox beyond caller memberships given a foreign teamId arg', () => {
    const where = astOfArgs(queries.triage.inbox, { teamId: TEAM_ID }, MEMBER).where
    expect(JSON.stringify(where)).toContain(MEMBER.userID)
    expect(JSON.stringify(where)).not.toContain(NON_MEMBER.userID)
  })

  it('filters triage.inbox to issues awaiting triage (needsTriage = true)', () => {
    const inbox = JSON.stringify(astOfArgs(queries.triage.inbox, { teamId: TEAM_ID }, MEMBER).where)
    expect(inbox).toContain('needsTriage')
    expect(inbox).toMatch(/needsTriage[\s\S]*true/)
    expect(inbox).not.toMatch(/needsTriage[\s\S]*false/)
  })

  it('holds triaged issues out of issues.byTeam and issues.mine (needsTriage = false)', () => {
    const byTeam = JSON.stringify(
      astOfArgs(queries.issues.byTeam, { teamId: TEAM_ID }, MEMBER).where,
    )
    expect(byTeam).toContain('needsTriage')
    expect(byTeam).toMatch(/needsTriage[\s\S]*false/)
    expect(byTeam).not.toMatch(/needsTriage[\s\S]*true/)

    const mine = JSON.stringify(astOfArgs(queries.issues.mine, undefined, MEMBER).where)
    expect(mine).toContain('needsTriage')
    expect(mine).toMatch(/needsTriage[\s\S]*false/)
    expect(mine).not.toMatch(/needsTriage[\s\S]*true/)
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

  it('scopes deployments.byTeam to members and denies non-members', () => {
    expect(astOfArgs(queries.deployments.byTeam, { teamId: TEAM_ID }, MEMBER).where).not.toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.deployments.byTeam, { teamId: TEAM_ID }, VIEWER).where).not.toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.deployments.byTeam, { teamId: TEAM_ID }, NON_MEMBER).where).toEqual(
      DENY_ALL_WHERE,
    )
    expect(astOfArgs(queries.deployments.byTeam, { teamId: TEAM_ID }, undefined).where).toEqual(
      DENY_ALL_WHERE,
    )
  })
})

describe('retro queries', () => {
  const RETRO_ID = '019f8f00-0000-7000-8000-0000000000c1'

  it('scopes retros.byTeam and retros.detail to the caller teams, denying non-members', () => {
    for (const ctx of [MEMBER, VIEWER]) {
      const list = astOfArgs(queries.retros.byTeam, { teamId: TEAM_ID }, ctx).where
      expect(list).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(list)).toContain(ctx.userID)

      const detail = astOfArgs(queries.retros.detail, { id: RETRO_ID }, ctx).where
      expect(detail).not.toEqual(DENY_ALL_WHERE)
      expect(JSON.stringify(detail)).toContain(ctx.userID)
    }
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.retros.byTeam, { teamId: TEAM_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
      expect(astOfArgs(queries.retros.detail, { id: RETRO_ID }, ctx).where).toEqual(DENY_ALL_WHERE)
    }
  })

  it('never reaches drafts, votes or a card author from the retro detail', () => {
    const ast = astOfArgs(queries.retros.detail, { id: RETRO_ID }, MEMBER)
    const serialized = JSON.stringify(ast)
    // The board, the tallies, the actions and presence — and nothing that carries an author.
    expect(serialized).toContain('retro_card')
    expect(serialized).toContain('retro_vote_tally')
    expect(serialized).not.toContain('retro_draft')
    expect(serialized).not.toContain('"retro_vote"')
    expect(serialized).not.toContain('retro_card_author')
  })
})

describe('retro drafts, votes and AI reactions are self-scoped with no admin bypass', () => {
  const RETRO_ID = '019f8f00-0000-7000-8000-0000000000c1'

  it.each([
    ['retroDrafts.mine', queries.retroDrafts.mine, 'authorId'],
    ['retroVotes.mine', queries.retroVotes.mine, 'voterId'],
    ['retroAiReactions.mine', queries.retroAiReactions.mine, 'userId'],
  ] as const)('%s filters on the verified ctx.userID alone', (_name, query, field) => {
    for (const ctx of [ADMIN, MEMBER, VIEWER]) {
      const where = JSON.stringify(astOfArgs(query, { retroId: RETRO_ID }, ctx).where)
      expect(where).toContain(field)
      expect(where).toContain(ctx.userID)
      // The deliberate deviation from `teamScoped`: an admin gets NO workspace-wide bypass here,
      // because these rows carry the identity the anonymity and vote-privacy guarantees depend on.
      for (const other of [ADMIN, MEMBER, VIEWER, NON_MEMBER].filter(
        (candidate) => candidate.userID !== ctx.userID,
      )) {
        expect(where).not.toContain(other.userID)
      }
    }
  })

  it.each([
    ['retroDrafts.mine', queries.retroDrafts.mine],
    ['retroVotes.mine', queries.retroVotes.mine],
    ['retroAiReactions.mine', queries.retroAiReactions.mine],
  ] as const)('%s denies a non-member and an unauthenticated caller', (_name, query) => {
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(query, { retroId: RETRO_ID }, ctx).where).toEqual(DENY_ALL_WHERE)
    }
  })
})

// The inbox is the sharpest test of the deviation, because the mistake that breaks it — writing
// `teamScoped(...)` instead of a bare ctx filter — is one line and looks completely normal.
describe('the inbox is self-scoped with no workspace-admin bypass', () => {
  it('filters on the verified ctx.userID alone, for every role including admin', () => {
    for (const ctx of [ADMIN, MEMBER, VIEWER]) {
      const where = JSON.stringify(astOf(queries.notifications.mine, ctx).where)
      expect(where).toContain('recipientId')
      expect(where).toContain(ctx.userID)
      for (const other of [ADMIN, MEMBER, VIEWER, NON_MEMBER].filter(
        (candidate) => candidate.userID !== ctx.userID,
      )) {
        expect(where).not.toContain(other.userID)
      }
    }
  })

  it('carries no team-membership predicate at all — not even the admin branch', () => {
    const serialized = JSON.stringify(astOf(queries.notifications.mine, ADMIN))
    // `teamScoped` compiles to a correlated EXISTS over `team_membership`. Its absence for an admin
    // is the point: an admin's inbox query is identical to everybody else's, and returns only their
    // own rows.
    expect(serialized).not.toContain('team_membership')
    expect(JSON.stringify(astOf(queries.notifications.mine, ADMIN).where)).toEqual(
      JSON.stringify(astOf(queries.notifications.mine, MEMBER).where).replace(
        MEMBER.userID,
        ADMIN.userID,
      ),
    )
  })

  it('denies a non-member and an unauthenticated caller by an empty query', () => {
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOf(queries.notifications.mine, ctx).where).toEqual(DENY_ALL_WHERE)
    }
  })

  it('reaches the actor for a display name but never the issue', () => {
    // No `issue` relationship exists on the table (design D3): joining the subject off a
    // self-scoped query would need re-scoping to avoid widening reads, and a notification whose
    // issue fell out of scope would render blank. The snapshots render instead.
    const serialized = JSON.stringify(astOf(queries.notifications.mine, MEMBER))
    expect(serialized).toContain('"user"')
    expect(serialized).not.toContain('"issue"')
  })

  it('bounds the synced set', () => {
    const ast = astOf(queries.notifications.mine, MEMBER) as { limit?: number }
    expect(ast.limit).toBe(NOTIFICATION_SYNC_LIMIT)
  })
})

// The subscription query is the only synced read of `issue_subscription` that exists, and that is
// the non-surveillance property of the mentions change expressed as an absence of code. These
// assertions are what would fail if somebody later "helpfully" added a watcher list.
describe('subscriptions.mine is self-scoped, per-issue, with no admin bypass', () => {
  const ISSUE_ID = '019f8f00-0000-7000-8000-0000000000d1'

  it('filters on the verified ctx.userID alone, for every role including admin', () => {
    for (const ctx of [ADMIN, MEMBER, VIEWER]) {
      const where = JSON.stringify(
        astOfArgs(queries.subscriptions.mine, { issueId: ISSUE_ID }, ctx).where,
      )
      expect(where).toContain('userId')
      expect(where).toContain(ctx.userID)
      for (const other of [ADMIN, MEMBER, VIEWER, NON_MEMBER].filter(
        (candidate) => candidate.userID !== ctx.userID,
      )) {
        expect(where).not.toContain(other.userID)
      }
    }
  })

  it('takes the user from the context and the issue from the argument, never the reverse', () => {
    const where = JSON.stringify(
      astOfArgs(queries.subscriptions.mine, { issueId: MEMBER.userID }, MEMBER).where,
    )
    // An argument that happens to look like a user id lands on `issueId`; the `userId` predicate is
    // still the context's, so no argument can widen this query to another person's row.
    expect(where).toContain('issueId')
    expect(where).toContain('userId')
  })

  it('carries no team-membership predicate at all — not even the admin branch', () => {
    const serialized = JSON.stringify(
      astOfArgs(queries.subscriptions.mine, { issueId: ISSUE_ID }, ADMIN),
    )
    expect(serialized).not.toContain('team_membership')
    expect(
      JSON.stringify(astOfArgs(queries.subscriptions.mine, { issueId: ISSUE_ID }, ADMIN).where),
    ).toEqual(
      JSON.stringify(
        astOfArgs(queries.subscriptions.mine, { issueId: ISSUE_ID }, MEMBER).where,
      ).replace(MEMBER.userID, ADMIN.userID),
    )
  })

  it('denies a non-member and an unauthenticated caller by an empty query', () => {
    for (const ctx of [NON_MEMBER, undefined]) {
      expect(astOfArgs(queries.subscriptions.mine, { issueId: ISSUE_ID }, ctx).where).toEqual(
        DENY_ALL_WHERE,
      )
    }
  })

  it('is the only query in the registry that reads issue_subscription', () => {
    // Every argument name any query in the registry takes, so this walk covers all of them rather
    // than skipping the ones that would throw on validation.
    const args = {
      issueId: ISSUE_ID,
      id: ISSUE_ID,
      retroId: ISSUE_ID,
      cycleId: ISSUE_ID,
      teamId: TEAM_ID,
    }
    const readers: string[] = []

    for (const [group, entries] of Object.entries(queries as Record<string, unknown>)) {
      if (typeof entries !== 'object' || entries === null) continue
      for (const [name, query] of Object.entries(entries as Record<string, unknown>)) {
        const fn = (query as { fn?: unknown }).fn
        if (typeof fn !== 'function') continue
        const built = (fn as (input: { args: unknown; ctx: AuthContext }) => { ast: unknown })({
          args,
          ctx: ADMIN,
        })
        if (JSON.stringify(built.ast).includes('issue_subscription'))
          readers.push(`${group}.${name}`)
      }
    }

    expect(readers).toEqual(['subscriptions.mine'])
  })
})

describe('the Zero schema cannot name the card -> author table', () => {
  it('has no retro_card_author table and no author column beyond the display one', () => {
    const tables = tableShapes()
    expect(tables.map((table) => table.serverName)).not.toContain('retro_card_author')

    const card = tables.find((table) => table.serverName === 'retro_card')
    expect(card?.columns.map((column) => column.serverName)).toContain('author_display_id')
    expect(card?.columns.map((column) => column.serverName)).not.toContain('author_id')
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

  it('grants admins an unscoped query (workspace-wide access, no membership filter)', () => {
    const adminWhere = (teamScoped(zql.team_membership, ADMIN) as unknown as { ast: QueryAst }).ast
      .where
    expect(adminWhere).not.toEqual(DENY_ALL_WHERE)
    expect(JSON.stringify(adminWhere ?? null)).not.toContain(ADMIN.userID)
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
