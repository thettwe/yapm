import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  number,
  relationships,
  string,
  table,
} from '@rocicorp/zero'
import type { WorkspaceRole } from './context.js'

const workspace = table('workspace')
  .columns({
    id: string(),
    name: string(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const workspaceMember = table('workspace_member')
  .columns({
    id: string(),
    workspaceId: string().from('workspace_id'),
    userId: string().from('user_id'),
    role: enumeration<WorkspaceRole>(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const team = table('team')
  .columns({
    id: string(),
    workspaceId: string().from('workspace_id'),
    name: string(),
    key: string(),
    archivedAt: number().from('archived_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const teamMembership = table('team_membership')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    userId: string().from('user_id'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id')

const invite = table('invite')
  .columns({
    id: string(),
    workspaceId: string().from('workspace_id'),
    teamId: string().from('team_id').optional(),
    email: string().optional(),
    role: enumeration<WorkspaceRole>(),
    token: string(),
    createdBy: string().from('created_by'),
    expiresAt: number().from('expires_at'),
    revokedAt: number().from('revoked_at').optional(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id')

const user = table('user')
  .columns({
    id: string(),
    name: string(),
    email: string(),
    emailVerified: boolean(),
    image: string().optional(),
    createdAt: number(),
    updatedAt: number(),
  })
  .primaryKey('id')

const workspaceRelationships = relationships(workspace, ({ many }) => ({
  members: many({
    sourceField: ['id'],
    destField: ['workspaceId'],
    destSchema: workspaceMember,
  }),
  teams: many({
    sourceField: ['id'],
    destField: ['workspaceId'],
    destSchema: team,
  }),
  invites: many({
    sourceField: ['id'],
    destField: ['workspaceId'],
    destSchema: invite,
  }),
}))

const workspaceMemberRelationships = relationships(workspaceMember, ({ one }) => ({
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
}))

const teamRelationships = relationships(team, ({ many }) => ({
  members: many({
    sourceField: ['id'],
    destField: ['teamId'],
    destSchema: teamMembership,
  }),
}))

const teamMembershipRelationships = relationships(teamMembership, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
}))

const inviteRelationships = relationships(invite, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
}))

export const schema = createSchema({
  tables: [workspace, workspaceMember, team, teamMembership, invite, user],
  relationships: [
    workspaceRelationships,
    workspaceMemberRelationships,
    teamRelationships,
    teamMembershipRelationships,
    inviteRelationships,
  ],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
})

export const zql = createBuilder(schema)

export type Schema = typeof schema

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema
  }
}
