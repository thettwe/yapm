import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type { ThemePreset, WorkspaceRole } from '../zero/context.js'

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
export type TimestampOrNull = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

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

export type User = Selectable<UserTable>
