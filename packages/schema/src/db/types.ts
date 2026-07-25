import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type {
  CiConclusion,
  ConnectorConfigData,
  ConnectorLinkSource,
  ConnectorStatus,
  CycleStatus,
  DeploymentState,
  IssueGrouping,
  IssuePriority,
  IssueStatus,
  ProjectStatus,
  PullRequestState,
  ReviewState,
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
// A jsonb column with a database default: reads back the parsed value, omittable on insert.
// (Wrapping `Json<T>` in `Generated<>` does not unwrap under kysely 0.28, so express it here.)
type JsonWithDefault<T> = ColumnType<T, T | string | undefined, T | string>

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
  rank: Nullable<string>
  cycle_id: Nullable<string>
  project_id: Nullable<string>
  needs_triage: Generated<boolean>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// A time-boxed iteration owned by a team. `number` is the per-team human sequence, claimed
// server-authoritatively (like the issue number) so it is nullable in the interface and
// absent from the Zero-optimistic insert. `status` transitions upcoming -> active ->
// completed; the completion transition auto-rolls unfinished issues to the next cycle.
export interface CycleTable {
  id: string
  team_id: string
  number: Nullable<number>
  name: string
  status: CycleStatus
  start_date: Timestamp
  end_date: Timestamp
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// Server-only per-team cycle counter, mirroring issue_sequence: present in the Kysely DB
// interface and migrations, deliberately absent from the Zero schema so its churn never syncs.
export interface CycleSequenceTable {
  team_id: string
  next_number: Generated<number>
}

// A workspace-level, lightweight project: a stakeholder-facing grouping of issues that can
// span teams. `lead_id` is a plain text column with no hard FK to better-auth's `user`,
// mirroring `issue.assignee_id`. `target_date` and `lead_id` are optional; `status` transitions
// planned -> active -> completed/cancelled. Progress (share of its issues Done) is COMPUTED, not
// stored. Issues reference it via the nullable `issue.project_id` (ON DELETE SET NULL).
export interface ProjectTable {
  id: string
  workspace_id: string
  name: string
  lead_id: Nullable<string>
  status: ProjectStatus
  target_date: TimestampOrNull
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

// Provider-neutral connector surface — three SERVER-ONLY tables (Kysely-managed, absent
// from the Zero schema so their rows, and especially the encrypted secret blobs, never
// replicate to a client's IndexedDB). Reused by the AI change for BYO-key providers.
//
// Per-workspace, per-provider config: the `enabled` toggle, an opaque non-secret `config`
// blob, connection `status`, and last-sync / last-error telemetry for the admin settings UI.
export interface ConnectorConfigTable {
  id: string
  workspace_id: string
  provider: string
  enabled: Generated<boolean>
  config: JsonWithDefault<ConnectorConfigData>
  status: Generated<ConnectorStatus>
  last_synced_at: TimestampOrNull
  last_error: Nullable<string>
  // `Timestamp` (not `Generated<Timestamp>`) so these DB-defaulted columns stay omittable on
  // insert yet settable on update — the server-only accessors bump `updated_at` on change.
  created_at: Timestamp
  updated_at: Timestamp
}

// Encrypted-at-rest secret material (AES-256-GCM blob from `secrets/codec.ts`), one row per
// named secret (e.g. `app_private_key`, `webhook_secret`) of a config. `ciphertext` is never
// decrypted outside the server and never leaves this table toward a client.
export interface ConnectorSecretTable {
  id: string
  connector_config_id: string
  key: string
  ciphertext: string
  created_at: Timestamp
  updated_at: Timestamp
}

// Per-installation record: the provider's external installation id, the account it targets,
// the admin-managed repo -> team mapping (repo full name -> team id), and per-resource ETags
// for conditional-request reconciliation. Installation access tokens are NEVER persisted.
export interface ConnectorInstallationTable {
  id: string
  connector_config_id: string
  external_installation_id: string
  account_login: Nullable<string>
  repo_mapping: JsonWithDefault<Record<string, string>>
  etags: JsonWithDefault<Record<string, string>>
  created_at: Timestamp
  updated_at: Timestamp
}

// Team-scoped, Zero-synced work-graph entities (change 8, part B). Each carries `team_id`
// so it syncs under the same two-hop `teamScoped` predicate as its issue, and hangs off
// `connector_installation` so an uninstall cascades it away. Provider-neutral: `provider`
// records the source ('github'), never a provider-specific shape. `opened_at`/`merged_at`/
// `submitted_at` are event timestamps, so plain `Timestamp` (settable on ingest), while
// `created_at`/`updated_at` are DB-defaulted bookkeeping (`Generated<Timestamp>`).
//
// A pull request mirrored from a connector. `state` is the raw lifecycle (draft/open/merged/
// closed); the reality strip's `approved` is derived from linked reviews, never stored here.
export interface PullRequestTable {
  id: string
  team_id: string
  installation_id: string
  provider: string
  repo: string
  number: number
  external_id: string
  title: Nullable<string>
  state: PullRequestState
  url: Nullable<string>
  head_sha: Nullable<string>
  opened_at: Timestamp
  merged_at: TimestampOrNull
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// A rolled-up CI conclusion for a PR's head (check_run/check_suite/legacy status).
export interface CiCheckTable {
  id: string
  team_id: string
  pull_request_id: string
  provider: string
  external_id: string
  name: Nullable<string>
  conclusion: CiConclusion
  head_sha: Nullable<string>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// A PR review (approve / changes-requested / comment / dismiss) with its submission time,
// which feeds the reality strip's review-age and the derived `approved` PR state.
export interface ReviewTable {
  id: string
  team_id: string
  pull_request_id: string
  provider: string
  external_id: string
  author: Nullable<string>
  state: ReviewState
  submitted_at: Timestamp
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// A deployment's latest state for a repo/ref/environment. Repo-anchored (not PR-anchored);
// stored for the issue-detail deploy view. Not part of the fixed `DeliverySignal` shape.
export interface DeploymentTable {
  id: string
  team_id: string
  installation_id: string
  provider: string
  repo: string
  external_id: string
  ref: Nullable<string>
  environment: Nullable<string>
  state: DeploymentState
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// The issue <-> pull_request edge, established by the magic-word rule (branch name or PR
// body). `team_id` is copied off the issue/PR (which share it) so the edge inherits the same
// two-hop sync scope, mirroring `issue_label`. `source` records which rule fired.
export interface IssueLinkTable {
  issue_id: string
  pull_request_id: string
  team_id: string
  source: ConnectorLinkSource
  created_at: Generated<Timestamp>
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
  cycle: CycleTable
  project: ProjectTable
  label: LabelTable
  issue_label: IssueLabelTable
  comment: CommentTable
  saved_view: SavedViewTable
  issue_sequence: IssueSequenceTable
  cycle_sequence: CycleSequenceTable
  connector_config: ConnectorConfigTable
  connector_secret: ConnectorSecretTable
  connector_installation: ConnectorInstallationTable
  pull_request: PullRequestTable
  ci_check: CiCheckTable
  review: ReviewTable
  deployment: DeploymentTable
  issue_link: IssueLinkTable
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

export type Cycle = Selectable<CycleTable>
export type NewCycle = Insertable<CycleTable>
export type CycleUpdate = Updateable<CycleTable>

export type Project = Selectable<ProjectTable>
export type NewProject = Insertable<ProjectTable>
export type ProjectUpdate = Updateable<ProjectTable>

export type CycleSequence = Selectable<CycleSequenceTable>

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

export type ConnectorConfig = Selectable<ConnectorConfigTable>
export type NewConnectorConfig = Insertable<ConnectorConfigTable>
export type ConnectorConfigUpdate = Updateable<ConnectorConfigTable>

export type ConnectorSecret = Selectable<ConnectorSecretTable>
export type NewConnectorSecret = Insertable<ConnectorSecretTable>
export type ConnectorSecretUpdate = Updateable<ConnectorSecretTable>

export type ConnectorInstallation = Selectable<ConnectorInstallationTable>
export type NewConnectorInstallation = Insertable<ConnectorInstallationTable>
export type ConnectorInstallationUpdate = Updateable<ConnectorInstallationTable>

export type PullRequest = Selectable<PullRequestTable>
export type NewPullRequest = Insertable<PullRequestTable>
export type PullRequestUpdate = Updateable<PullRequestTable>

export type CiCheck = Selectable<CiCheckTable>
export type NewCiCheck = Insertable<CiCheckTable>
export type CiCheckUpdate = Updateable<CiCheckTable>

export type Review = Selectable<ReviewTable>
export type NewReview = Insertable<ReviewTable>
export type ReviewUpdate = Updateable<ReviewTable>

export type Deployment = Selectable<DeploymentTable>
export type NewDeployment = Insertable<DeploymentTable>
export type DeploymentUpdate = Updateable<DeploymentTable>

export type IssueLink = Selectable<IssueLinkTable>
export type NewIssueLink = Insertable<IssueLinkTable>

export type User = Selectable<UserTable>
