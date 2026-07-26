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
  CiConclusion,
  ConnectorLinkSource,
  CycleDigestStatus,
  CycleStatus,
  DeploymentState,
  EmailNotificationMode,
  IssueGrouping,
  IssuePriority,
  IssueStatus,
  NotificationKind,
  NotificationSubjectType,
  ProjectStatus,
  PullRequestState,
  RetroColumnAccent,
  RetroFormat,
  RetroPhase,
  RetroVoteTarget,
  ReviewState,
  SubscriptionState,
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
    emailNotifications: enumeration<EmailNotificationMode>().from('email_notifications'),
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
    cycleId: string().from('cycle_id').optional(),
    rolledOverFromCycleId: string().from('rolled_over_from_cycle_id').optional(),
    projectId: string().from('project_id').optional(),
    needsTriage: boolean().from('needs_triage'),
    // Cycle-history facts the retro's Delivered panel reports as facts rather than guesses.
    carryoverCount: number().from('carryover_count'),
    cycleAssignedAt: number().from('cycle_assigned_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const cycle = table('cycle')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    number: number().optional(),
    name: string(),
    status: enumeration<CycleStatus>(),
    startDate: number().from('start_date'),
    endDate: number().from('end_date'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const project = table('project')
  .columns({
    id: string(),
    workspaceId: string().from('workspace_id'),
    name: string(),
    leadId: string().from('lead_id').optional(),
    status: enumeration<ProjectStatus>(),
    targetDate: number().from('target_date').optional(),
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

// Team-scoped work-graph entities (change 8). `installationId` is a synced column that
// references the server-only `connector_installation` at the DB level but has no Zero
// relationship to it — the row itself stays inside the team-scoped sync boundary.
const pullRequest = table('pull_request')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    installationId: string().from('installation_id'),
    provider: string(),
    repo: string(),
    number: number(),
    externalId: string().from('external_id'),
    title: string().optional(),
    state: enumeration<PullRequestState>(),
    url: string().optional(),
    headSha: string().from('head_sha').optional(),
    openedAt: number().from('opened_at'),
    mergedAt: number().from('merged_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const ciCheck = table('ci_check')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    pullRequestId: string().from('pull_request_id'),
    provider: string(),
    externalId: string().from('external_id'),
    name: string().optional(),
    conclusion: enumeration<CiConclusion>(),
    headSha: string().from('head_sha').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const review = table('review')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    pullRequestId: string().from('pull_request_id'),
    provider: string(),
    externalId: string().from('external_id'),
    author: string().optional(),
    state: enumeration<ReviewState>(),
    submittedAt: number().from('submitted_at'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const deployment = table('deployment')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    installationId: string().from('installation_id'),
    provider: string(),
    repo: string(),
    externalId: string().from('external_id'),
    ref: string().optional(),
    environment: string().optional(),
    state: enumeration<DeploymentState>(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const issueLink = table('issue_link')
  .columns({
    issueId: string().from('issue_id'),
    pullRequestId: string().from('pull_request_id'),
    teamId: string().from('team_id'),
    source: enumeration<ConnectorLinkSource>(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('issueId', 'pullRequestId')

// The team-scoped, Zero-synced cycle-digest artifact (change 9). Written server-side ONLY (never a
// client mutator), read team-scoped like the other work-data entities. `content` is the typed
// digest blob (null until ready / when AI is off). No identity dimension.
const cycleDigest = table('cycle_digest')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    cycleId: string().from('cycle_id'),
    status: enumeration<CycleDigestStatus>(),
    content: json().optional(),
    provider: string().optional(),
    model: string().optional(),
    generatedAt: number().from('generated_at').optional(),
    inputToken: number().from('input_token').optional(),
    outputToken: number().from('output_token').optional(),
    estimatedCostUsd: number().from('estimated_cost_usd').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

// The retrospective's NINE synced tables. `retro_card_author` — the card -> author binding — is
// DELIBERATELY ABSENT from this schema: Zero syncs whole rows and has no column-level read
// permission, so the author of an anonymous card lives in a server-only table a client cannot name
// in any query. The drift test asserts that absence. Do not add it here.
const retro = table('retro')
  .columns({
    id: string(),
    teamId: string().from('team_id'),
    cycleId: string().from('cycle_id').optional(),
    nextCycleId: string().from('next_cycle_id').optional(),
    title: string(),
    format: enumeration<RetroFormat>(),
    phase: enumeration<RetroPhase>(),
    facilitatorId: string().from('facilitator_id').optional(),
    isAnonymous: boolean().from('is_anonymous'),
    votesPerParticipant: number().from('votes_per_participant'),
    timerEndsAt: number().from('timer_ends_at').optional(),
    timerDurationS: number().from('timer_duration_s').optional(),
    createdBy: string().from('created_by'),
    closedAt: number().from('closed_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const retroColumn = table('retro_column')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    key: string(),
    title: string(),
    accentToken: enumeration<RetroColumnAccent>().from('accent_token'),
    rank: string(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

// Synced ONLY to its author (`retroDrafts.mine`), so private brainstorming needs no author column on
// the card. Published cards reuse this row's id.
const retroDraft = table('retro_draft')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    columnId: string().from('column_id'),
    authorId: string().from('author_id'),
    body: string(),
    rank: string(),
    seedRef: json().from('seed_ref').optional(),
    publishedAt: number().from('published_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const retroCard = table('retro_card')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    columnId: string().from('column_id'),
    groupId: string().from('group_id').optional(),
    body: string(),
    rank: string(),
    isAnonymous: boolean().from('is_anonymous'),
    // Null for an anonymous retro's cards — there is no hidden author column to strip.
    authorDisplayId: string().from('author_display_id').optional(),
    seedRef: json().from('seed_ref').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const retroGroup = table('retro_group')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    columnId: string().from('column_id'),
    label: string().optional(),
    rank: string(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

// Synced ONLY to its voter (`retroVotes.mine`); everyone else reads the tally.
const retroVote = table('retro_vote')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    targetType: enumeration<RetroVoteTarget>().from('target_type'),
    targetId: string().from('target_id'),
    voterId: string().from('voter_id'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id')

// Keyed by the vote target's own id, because Zero has no aggregates and a client cannot count rows
// it cannot see.
const retroVoteTally = table('retro_vote_tally')
  .columns({
    targetId: string().from('target_id'),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    targetType: enumeration<RetroVoteTarget>().from('target_type'),
    count: number(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('targetId')

const retroAction = table('retro_action')
  .columns({
    id: string(),
    retroId: string().from('retro_id'),
    teamId: string().from('team_id'),
    groupId: string().from('group_id').optional(),
    cardId: string().from('card_id').optional(),
    body: string(),
    assigneeId: string().from('assignee_id').optional(),
    targetCycleId: string().from('target_cycle_id').optional(),
    issueId: string().from('issue_id').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id')

const retroPresence = table('retro_presence')
  .columns({
    retroId: string().from('retro_id'),
    userId: string().from('user_id'),
    teamId: string().from('team_id'),
    focusTarget: string().from('focus_target').optional(),
    lastSeenAt: number().from('last_seen_at'),
  })
  .primaryKey('retroId', 'userId')

// The natural key IS the primary key, so nothing is minted anywhere in the notification path and a
// rebased mutator cannot duplicate a row. `markRead` addresses a row by these four columns, and the
// recipient component always comes from the verified `ctx.userID` — which makes the mutator
// STRUCTURALLY unable to name somebody else's row rather than relying on a `where` clause.
const notification = table('notification')
  .columns({
    recipientId: string().from('recipient_id'),
    actorId: string().from('actor_id'),
    kind: enumeration<NotificationKind>(),
    teamId: string().from('team_id'),
    subjectType: enumeration<NotificationSubjectType>().from('subject_type'),
    subjectId: string().from('subject_id'),
    subjectKey: string().from('subject_key').optional(),
    subjectTitle: string().from('subject_title'),
    eventKey: string().from('event_key'),
    readAt: number().from('read_at').optional(),
    emailSentAt: number().from('email_sent_at').optional(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('recipientId', 'kind', 'subjectId', 'eventKey')

// The natural key IS the primary key here too, so the follow/unfollow mutators mint nothing and
// address a row by `(issueId, ctx.userID)` — the user half always coming from the verified context,
// never from args. `state` rather than row existence is what makes an unfollow survive the next
// mention; see `0014_mentions`.
const issueSubscription = table('issue_subscription')
  .columns({
    issueId: string().from('issue_id'),
    userId: string().from('user_id'),
    teamId: string().from('team_id'),
    state: enumeration<SubscriptionState>(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('issueId', 'userId')

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
  projects: many({
    sourceField: ['id'],
    destField: ['workspaceId'],
    destSchema: project,
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
  cycles: many({
    sourceField: ['id'],
    destField: ['teamId'],
    destSchema: cycle,
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
  cycle: one({
    sourceField: ['cycleId'],
    destField: ['id'],
    destSchema: cycle,
  }),
  project: one({
    sourceField: ['projectId'],
    destField: ['id'],
    destSchema: project,
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
  issueLinks: many({
    sourceField: ['id'],
    destField: ['issueId'],
    destSchema: issueLink,
  }),
}))

const pullRequestRelationships = relationships(pullRequest, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  ciChecks: many({
    sourceField: ['id'],
    destField: ['pullRequestId'],
    destSchema: ciCheck,
  }),
  reviews: many({
    sourceField: ['id'],
    destField: ['pullRequestId'],
    destSchema: review,
  }),
  issueLinks: many({
    sourceField: ['id'],
    destField: ['pullRequestId'],
    destSchema: issueLink,
  }),
}))

const ciCheckRelationships = relationships(ciCheck, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  pullRequest: one({
    sourceField: ['pullRequestId'],
    destField: ['id'],
    destSchema: pullRequest,
  }),
}))

const reviewRelationships = relationships(review, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  pullRequest: one({
    sourceField: ['pullRequestId'],
    destField: ['id'],
    destSchema: pullRequest,
  }),
}))

const deploymentRelationships = relationships(deployment, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
}))

const issueLinkRelationships = relationships(issueLink, ({ one }) => ({
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
  pullRequest: one({
    sourceField: ['pullRequestId'],
    destField: ['id'],
    destSchema: pullRequest,
  }),
}))

const cycleRelationships = relationships(cycle, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  issues: many({
    sourceField: ['id'],
    destField: ['cycleId'],
    destSchema: issue,
  }),
}))

const cycleDigestRelationships = relationships(cycleDigest, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  cycle: one({
    sourceField: ['cycleId'],
    destField: ['id'],
    destSchema: cycle,
  }),
}))

const projectRelationships = relationships(project, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceId'],
    destField: ['id'],
    destSchema: workspace,
  }),
  lead: one({
    sourceField: ['leadId'],
    destField: ['id'],
    destSchema: user,
  }),
  issues: many({
    sourceField: ['id'],
    destField: ['projectId'],
    destSchema: issue,
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

// Every retro table carries a `team` relationship, because the `teamScoped` read predicate is a
// two-hop `whereExists('team', team => team.whereExists('members', ...))` over the verified ctx.
const retroRelationships = relationships(retro, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  cycle: one({
    sourceField: ['cycleId'],
    destField: ['id'],
    destSchema: cycle,
  }),
  nextCycle: one({
    sourceField: ['nextCycleId'],
    destField: ['id'],
    destSchema: cycle,
  }),
  columns: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroColumn,
  }),
  cards: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroCard,
  }),
  groups: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroGroup,
  }),
  voteTallies: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroVoteTally,
  }),
  actions: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroAction,
  }),
  presence: many({
    sourceField: ['id'],
    destField: ['retroId'],
    destSchema: retroPresence,
  }),
}))

const retroColumnRelationships = relationships(retroColumn, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  cards: many({
    sourceField: ['id'],
    destField: ['columnId'],
    destSchema: retroCard,
  }),
  groups: many({
    sourceField: ['id'],
    destField: ['columnId'],
    destSchema: retroGroup,
  }),
}))

// No `author` relationship, deliberately: a draft's author is the caller (the query filters on the
// verified ctx), and joining `user` here would put an identity on a row other clients must not read.
const retroDraftRelationships = relationships(retroDraft, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  column: one({
    sourceField: ['columnId'],
    destField: ['id'],
    destSchema: retroColumn,
  }),
}))

const retroCardRelationships = relationships(retroCard, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  column: one({
    sourceField: ['columnId'],
    destField: ['id'],
    destSchema: retroColumn,
  }),
  group: one({
    sourceField: ['groupId'],
    destField: ['id'],
    destSchema: retroGroup,
  }),
}))

const retroGroupRelationships = relationships(retroGroup, ({ one, many }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  column: one({
    sourceField: ['columnId'],
    destField: ['id'],
    destSchema: retroColumn,
  }),
  cards: many({
    sourceField: ['id'],
    destField: ['groupId'],
    destSchema: retroCard,
  }),
}))

const retroVoteRelationships = relationships(retroVote, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
}))

const retroVoteTallyRelationships = relationships(retroVoteTally, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
}))

const retroActionRelationships = relationships(retroAction, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  // The action -> issue edge is what closes yapm's own loop: a converted action renders its issue's
  // live status with the tracker's own status tokens.
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issue,
  }),
  assignee: one({
    sourceField: ['assigneeId'],
    destField: ['id'],
    destSchema: user,
  }),
  targetCycle: one({
    sourceField: ['targetCycleId'],
    destField: ['id'],
    destSchema: cycle,
  }),
}))

const retroPresenceRelationships = relationships(retroPresence, ({ one }) => ({
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
  retro: one({
    sourceField: ['retroId'],
    destField: ['id'],
    destSchema: retro,
  }),
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
}))

// NO `issue` RELATIONSHIP, deliberately (design D3). Joining the subject off a self-scoped query
// would need the `teamScoped` predicate on the related issue to avoid widening reads past the team
// boundary, and a notification whose issue fell out of scope would then render blank. The
// denormalised `subjectKey`/`subjectTitle` snapshots render with no permission subtlety at all.
const notificationRelationships = relationships(notification, ({ one }) => ({
  actor: one({
    sourceField: ['actorId'],
    destField: ['id'],
    destSchema: user,
  }),
  team: one({
    sourceField: ['teamId'],
    destField: ['id'],
    destSchema: team,
  }),
}))

const issueSubscriptionRelationships = relationships(issueSubscription, ({ one }) => ({
  issue: one({
    sourceField: ['issueId'],
    destField: ['id'],
    destSchema: issue,
  }),
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
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
    cycle,
    project,
    label,
    issueLabel,
    comment,
    savedView,
    pullRequest,
    ciCheck,
    review,
    deployment,
    issueLink,
    cycleDigest,
    retro,
    retroColumn,
    retroDraft,
    retroCard,
    retroGroup,
    retroVote,
    retroVoteTally,
    retroAction,
    retroPresence,
    notification,
    issueSubscription,
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
    cycleRelationships,
    projectRelationships,
    labelRelationships,
    issueLabelRelationships,
    commentRelationships,
    savedViewRelationships,
    pullRequestRelationships,
    ciCheckRelationships,
    reviewRelationships,
    deploymentRelationships,
    issueLinkRelationships,
    cycleDigestRelationships,
    retroRelationships,
    retroColumnRelationships,
    retroDraftRelationships,
    retroCardRelationships,
    retroGroupRelationships,
    retroVoteRelationships,
    retroVoteTallyRelationships,
    retroActionRelationships,
    retroPresenceRelationships,
    notificationRelationships,
    issueSubscriptionRelationships,
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
