import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type {
  IssueGrouping,
  IssuePriority,
  IssueStatus,
  RichTextDoc,
  ThemePreset,
  WorkspaceRole,
} from '../zero/context.js'
import type { IssueFilter, IssueSort } from '../zero/filter.js'

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
export type TimestampOrNull = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

// jsonb column: reads back the parsed value, accepts either the value or a serialized
// string on write (node-postgres serializes a plain object to json for us).
type Json<T> = ColumnType<T, T | string, T | string>
type JsonOrNull<T> = ColumnType<T | null, T | string | null | undefined, T | string | null>

export interface WorkspaceTable {
  id: string
  name: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface WorkspaceMemberTable {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface TeamTable {
  id: string
  workspace_id: string
  name: string
  key: string
  archived_at: TimestampOrNull
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface TeamMembershipTable {
  id: string
  team_id: string
  user_id: string
  created_at: Generated<Timestamp>
}

export interface InviteTable {
  id: string
  workspace_id: string
  team_id: Nullable<string>
  email: Nullable<string>
  role: WorkspaceRole
  token: string
  created_by: string
  expires_at: Timestamp
  revoked_at: TimestampOrNull
  created_at: Generated<Timestamp>
}

// User-scoped preference leaf off `user` (identity), orthogonal to the membership graph.
// `theme` defaults to 'warm' in Postgres (so Generated); `accent = null` means the preset's
// own default accent. `user_id` is a plain text column with no hard FK to better-auth's
// `user`, matching the workspace-auth boot-order rationale.
export interface UserPreferenceTable {
  id: string
  user_id: string
  theme: Generated<ThemePreset>
  accent: Nullable<string>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface IssueTable {
  id: string
  team_id: string
  number: Nullable<number>
  title: string
  description: JsonOrNull<RichTextDoc>
  status: IssueStatus
  priority: IssuePriority
  assignee_id: Nullable<string>
  creator_id: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface LabelTable {
  id: string
  team_id: string
  name: string
  color: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// `team_id` is denormalized off the parent issue so every work-data table carries a direct
// `team` relationship and the team-scoped sync predicate stays a two-hop `whereExists`
// (issue↔label edge, mirroring zbugs' `projectID` on `issueLabel`).
export interface IssueLabelTable {
  issue_id: string
  label_id: string
  team_id: string
  created_at: Generated<Timestamp>
}

export interface CommentTable {
  id: string
  issue_id: string
  team_id: string
  author_id: string
  body: Json<RichTextDoc>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface SavedViewTable {
  id: string
  team_id: string
  name: string
  filter: Json<IssueFilter>
  grouping: IssueGrouping
  sort: Json<IssueSort>
  created_by: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// Server-only per-team counter for the human issue number. In the Kysely `DB` interface and
// migrations but NOT the Zero schema, so its churn never replicates to clients.
export interface IssueSequenceTable {
  team_id: string
  next_number: Generated<number>
}

// Owned by better-auth (created by its `getMigrations()` at boot), read-only here so
// mutators/queries can join member profiles. camelCase columns and a `text` id are
// better-auth's shape (reference/kysely-stack.md §5.4), not ours to change.
export interface UserTable {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: Nullable<string>
  createdAt: Generated<Timestamp>
  updatedAt: Generated<Timestamp>
}

export interface DB {
  workspace: WorkspaceTable
  workspace_member: WorkspaceMemberTable
  team: TeamTable
  team_membership: TeamMembershipTable
  invite: InviteTable
  user_preference: UserPreferenceTable
  issue: IssueTable
  label: LabelTable
  issue_label: IssueLabelTable
  comment: CommentTable
  saved_view: SavedViewTable
  issue_sequence: IssueSequenceTable
  user: UserTable
}

export type Workspace = Selectable<WorkspaceTable>
export type NewWorkspace = Insertable<WorkspaceTable>
export type WorkspaceUpdate = Updateable<WorkspaceTable>

export type WorkspaceMember = Selectable<WorkspaceMemberTable>
export type NewWorkspaceMember = Insertable<WorkspaceMemberTable>
export type WorkspaceMemberUpdate = Updateable<WorkspaceMemberTable>

export type Team = Selectable<TeamTable>
export type NewTeam = Insertable<TeamTable>
export type TeamUpdate = Updateable<TeamTable>

export type TeamMembership = Selectable<TeamMembershipTable>
export type NewTeamMembership = Insertable<TeamMembershipTable>

export type Invite = Selectable<InviteTable>
export type NewInvite = Insertable<InviteTable>
export type InviteUpdate = Updateable<InviteTable>

export type UserPreference = Selectable<UserPreferenceTable>
export type NewUserPreference = Insertable<UserPreferenceTable>
export type UserPreferenceUpdate = Updateable<UserPreferenceTable>

export type Issue = Selectable<IssueTable>
export type NewIssue = Insertable<IssueTable>
export type IssueUpdate = Updateable<IssueTable>

export type Label = Selectable<LabelTable>
export type NewLabel = Insertable<LabelTable>
export type LabelUpdate = Updateable<LabelTable>

export type IssueLabel = Selectable<IssueLabelTable>
export type NewIssueLabel = Insertable<IssueLabelTable>

export type Comment = Selectable<CommentTable>
export type NewComment = Insertable<CommentTable>
export type CommentUpdate = Updateable<CommentTable>

export type SavedView = Selectable<SavedViewTable>
export type NewSavedView = Insertable<SavedViewTable>
export type SavedViewUpdate = Updateable<SavedViewTable>

export type IssueSequence = Selectable<IssueSequenceTable>

export type User = Selectable<UserTable>
