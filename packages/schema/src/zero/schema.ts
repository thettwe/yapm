import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  json,
  number,
  relationships,
  string,
  table,
} from '@rocicorp/zero'
import type {
  IssueGrouping,
  IssuePriority,
  IssueStatus,
  ThemePreset,
  WorkspaceRole,
} from './context.js'

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

const userPreference = table('user_preference')
  .columns({
    id: string(),
    userId: string().from('user_id'),
    theme: enumeration<ThemePreset>(),
    accent: string().optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const issue = table('issue')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    number: number().optional(),
    title: string(),
    description: json().optional(),
    status: enumeration<IssueStatus>(),
    priority: enumeration<IssuePriority>(),
    assigneeId: string().from('assignee_id').optional(),
    creatorId: string().from('creator_id'),
    rank: string().optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const label = table('label')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    name: string(),
    color: string(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const issueLabel = table('issue_label')
  .columns({
    issueId: string().from('issue_id'),
    labelId: string().from('label_id'),
    teamId: string().from('team_id'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('issueId', 'labelId')

const comment = table('comment')
  .columns({
    id: string(),
    issueId: string().from('issue_id'),
    teamId: string().from('team_id'),
    authorId: string().from('author_id'),
    body: json(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const savedView = table('saved_view')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    name: string(),
    filter: json(),
    grouping: enumeration<IssueGrouping>(),
    sort: json(),
    createdBy: string().from('created_by'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
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
  issues: many({
    sourceField: ['id'],
    destField: ['teamId'],
    destSchema: issue,
  }),
  labels: many({
    sourceField: ['id'],
    destField: ['teamId'],
    destSchema: label,
  }),
  savedViews: many({
    sourceField: ['id'],
    destField: ['teamId'],
    destSchema: savedView,
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

const userPreferenceRelationships = relationships(userPreference, ({ one }) => ({
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
}))

const issueRelationships = relationships(issue, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  creator: one({
    sourceField: ['creatorId'],
    destField: ['id'],
    destSchema: user,
  }),
  assignee: one({
    sourceField: ['assigneeId'],
    destField: ['id'],
    destSchema: user,
  }),
  issueLabels: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: issueLabel,
  }),
  labels: many(
    {
      sourceField: ['id'],
      destField: ['issueId'],
      destSchema: issueLabel,
    },
    {
      sourceField: ['labelId'],
      destField: ['id'],
      destSchema: label,
    },
  ),
  comments: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: comment,
  }),
}))

const labelRelationships = relationships(label, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
}))

const issueLabelRelationships = relationships(issueLabel, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issue,
  }),
  label: one({
    sourceField: ['labelId'],
    destField: ['id'],
    destSchema: label,
  }),
}))

const commentRelationships = relationships(comment, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issue,
  }),
  author: one({
    sourceField: ['authorId'],
    destField: ['id'],
    destSchema: user,
  }),
}))

const savedViewRelationships = relationships(savedView, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
}))

export const schema = createSchema({
  tables: [
    workspace,
    workspaceMember,
    team,
    teamMembership,
    invite,
    userPreference,
    issue,
    label,
    issueLabel,
    comment,
    savedView,
    user,
  ],
  relationships: [
    workspaceRelationships,
    workspaceMemberRelationships,
    teamRelationships,
    teamMembershipRelationships,
    inviteRelationships,
    userPreferenceRelationships,
    issueRelationships,
    labelRelationships,
    issueLabelRelationships,
    commentRelationships,
    savedViewRelationships,
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
