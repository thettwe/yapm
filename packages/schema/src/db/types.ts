import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type {
  AiArtifactStatus,
  AiDisclosureEvent,
  CiConclusion,
  ConnectorConfigData,
  ConnectorLinkSource,
  ConnectorStatus,
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
  RetroProposalVerdict,
  RetroReactionValue,
  RetroVoteTarget,
  ReviewState,
  RichTextDoc,
  SubscriptionState,
  ThemePreset,
  WorkspaceRole,
} from '../zero/context.js'
import type { DigestConfidence, DigestContent } from '../zero/digest.js'
import type { IssueFilter, IssueSort } from '../zero/filter.js'
import type { StoredPmDigestContent } from '../zero/pm-digest.js'
import type { RetroProposalCategory } from '../zero/retro/ai-draft.js'
import type { RetroSeedRef } from '../zero/retro/seed.js'

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
  // Opt-in status automation, off by default. Null is off; a timestamp is both "on" and the epoch
  // every transition's event instant is compared against, so enabling never rewrites history.
  auto_status_since: TimestampOrNull
  // Opt-in AI retro drafting, off by default. Null is off; a timestamp is "on, and this is when the
  // team consented" — unlike `auto_status_since` the epoch is NOT an event filter, because the draft
  // is triggered by a live phase advance and has no historical backlog to guard against.
  ai_retro_draft_since: TimestampOrNull
  // AI spend that happened on this team's work and whose artifact row is gone — today only a retro
  // draft discarded when a facilitator steps back to `brainstorm`. Monotonic, never decremented, and
  // absent from the Zero schema: `getWorkspaceAiSpendUsd` counts it so the cap keeps seeing money
  // that was really spent.
  ai_retired_spend_usd: Generated<number>
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
  // Governs EMAIL only, never the in-app inbox row. CHECK-constrained in Postgres, unlike
  // `notification.kind` — a closed value set this change owns entirely.
  email_notifications: Generated<EmailNotificationMode>
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
  rolled_over_from_cycle_id: Nullable<string>
  project_id: Nullable<string>
  needs_triage: Generated<boolean>
  // Two cycle-history facts an issue's current state cannot reconstruct, feeding the retro's
  // team-level Delivered panel: how many times the rollover carried this issue ("carried twice or
  // more") and when it was placed in its cycle ("added mid-cycle"). Written only by the mutators
  // that already write the row; no identity dimension.
  carryover_count: Generated<number>
  cycle_assigned_at: TimestampOrNull
  // When a PERSON last set this issue's status. `updated_at` cannot answer that — it moves for a
  // title edit and for automation's own write — and the guard ladder needs it to refuse a
  // transition whose event predates a human's deliberate decision.
  last_human_status_at: TimestampOrNull
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

// The team-scoped, Zero-synced cycle-digest artifact (change 9). Written ONLY by the server-side
// pre-compute job over the Zero write path (never a client mutator). `content` holds the typed
// digest blob (null until ready / when AI is off); `estimated_cost_usd` is float8 (labeled
// "estimated"). No `assignee`/`author`/`user_id` dimension — the blameless guarantee is schema-level.
export interface CycleDigestTable {
  id: string
  team_id: string
  cycle_id: string
  status: Generated<CycleDigestStatus>
  content: JsonOrNull<DigestContent>
  provider: Nullable<string>
  model: Nullable<string>
  generated_at: TimestampOrNull
  input_token: Nullable<number>
  output_token: Nullable<number>
  estimated_cost_usd: Nullable<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// The PM-facing disclosure artifact (change 20). One row per cycle, written server-side only, and
// UNPUBLISHED until a human releases it — `published_at` is the permission boundary, not a display
// flag. Four columns here are deliberately ABSENT from the Zero schema: the token counts and
// `estimated_cost_usd` are run internals the spend cap reads in SQL, and `published_by` is the one
// identity column on the row, which a reader outside the team has no business receiving. The drift
// test asserts all four asymmetries from both sides.
export interface PmDigestTable {
  id: string
  cycle_id: string
  team_id: string
  status: Generated<AiArtifactStatus>
  content: JsonOrNull<StoredPmDigestContent>
  provider: Nullable<string>
  model: Nullable<string>
  input_token: Nullable<number>
  output_token: Nullable<number>
  estimated_cost_usd: Nullable<number>
  generated_at: TimestampOrNull
  published_at: TimestampOrNull
  published_by: Nullable<string>
  audience_size_at_publish: Nullable<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// SERVER-ONLY, in the strongest sense this codebase has: present here and in the migrations, absent
// from the Zero schema entirely (asserted alongside `retro_card_author`), so no client can name it
// in any query. `detail` carries yapm-computed metadata ONLY — an audit record that quoted the
// disclosure would be a second copy of it, sitting outside the kill switch.
export interface AiDisclosureAuditTable {
  id: string
  workspace_id: string
  team_id: Nullable<string>
  actor_id: Nullable<string>
  event: AiDisclosureEvent
  pm_digest_id: Nullable<string>
  detail: JsonWithDefault<Record<string, unknown>>
  created_at: Generated<Timestamp>
}

// The retrospective. Nine Zero-synced tables plus ONE server-only table (`retro_card_author`),
// which is in this interface and in the migrations but deliberately ABSENT from the Zero schema —
// the drift test asserts that absence, exactly as it does for the sequence counters.
//
// The meeting object: a phase machine anchored to a cycle. `cycle_id` is unique when set (at most
// one retro per cycle), `next_cycle_id` is where converted actions land, `timer_ends_at` is durable
// state each client counts down against locally, and anonymity/budget are fixed during `brainstorm`.
export interface RetroTable {
  id: string
  team_id: string
  cycle_id: Nullable<string>
  next_cycle_id: Nullable<string>
  title: string
  format: RetroFormat
  phase: Generated<RetroPhase>
  facilitator_id: Nullable<string>
  is_anonymous: Generated<boolean>
  votes_per_participant: Generated<number>
  timer_ends_at: TimestampOrNull
  timer_duration_s: Nullable<number>
  created_by: string
  closed_at: TimestampOrNull
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// Columns are ROWS, so a custom format costs no schema change. `accent_token` is a retro-semantic
// accent key that `packages/ui` maps to a theme token — never a color literal.
export interface RetroColumnTable {
  id: string
  retro_id: string
  team_id: string
  key: string
  title: string
  accent_token: RetroColumnAccent
  rank: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// The private brainstorm row: syncs ONLY to `author_id`, with no workspace-admin bypass. Publishing
// reuses this row's id for the card, so nothing is minted inside a mutator and publish is
// idempotent; `rank` is minted at the draft's call site and copied onto the card.
export interface RetroDraftTable {
  id: string
  retro_id: string
  team_id: string
  column_id: string
  author_id: string
  body: string
  rank: string
  seed_ref: JsonOrNull<RetroSeedRef>
  published_at: TimestampOrNull
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// The published card. `author_display_id` is written ONLY when the retro is not anonymous, so an
// anonymous card's synced row carries no author value and there is nothing to strip.
export interface RetroCardTable {
  id: string
  retro_id: string
  team_id: string
  column_id: string
  group_id: Nullable<string>
  body: string
  rank: string
  is_anonymous: Generated<boolean>
  author_display_id: Nullable<string>
  seed_ref: JsonOrNull<RetroSeedRef>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// SERVER-ONLY — the crux of the anonymity guarantee. Zero syncs whole rows and has no column-level
// read permission, so the card -> author binding lives here, in a table absent from the Zero schema:
// a client cannot name it in any query, which makes the leak structurally impossible rather than
// merely unwritten. Read only by the server mutator pass, for authorization, moderation and audit.
export interface RetroCardAuthorTable {
  card_id: string
  retro_id: string
  author_id: string
  created_at: Generated<Timestamp>
}

export interface RetroGroupTable {
  id: string
  retro_id: string
  team_id: string
  column_id: string
  label: Nullable<string>
  rank: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// One row per dot, synced ONLY to its voter (bare ctx filter, no admin bypass). `target_id` is
// polymorphic (card or group) so it carries no FK; the mutator validates the target instead.
export interface RetroVoteTable {
  id: string
  retro_id: string
  team_id: string
  target_type: RetroVoteTarget
  target_id: string
  voter_id: string
  created_at: Generated<Timestamp>
}

// Zero has no aggregates and a client cannot count rows it cannot see, so the per-target count is a
// real synced row keyed by the target's own client-minted id — upserted without minting anything.
export interface RetroVoteTallyTable {
  target_id: string
  retro_id: string
  team_id: string
  target_type: RetroVoteTarget
  count: Generated<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// The retro's outcome. `issue_id` is set once the action becomes a real issue through the shared
// issue-create path, after which the action renders that issue's live status.
export interface RetroActionTable {
  id: string
  retro_id: string
  team_id: string
  group_id: Nullable<string>
  card_id: Nullable<string>
  body: string
  assignee_id: Nullable<string>
  target_cycle_id: Nullable<string>
  issue_id: Nullable<string>
  // Provenance only, `on delete set null`: discarding the AI draft must not delete a human's action.
  ai_proposal_id: Nullable<string>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// Coarse throttled presence, pruned by the existing cycle-maintenance pass — no sidecar service and
// no Redis, so the 3-container promise holds. `focus_target` is column-level, never a pixel cursor.
export interface RetroPresenceTable {
  retro_id: string
  user_id: string
  team_id: string
  focus_target: Nullable<string>
  last_seen_at: Generated<Timestamp>
}

// The second AI artifact (change 18): one AI-drafted retro per retro, written server-side ONLY over
// the Zero write path. `claimed_at` is the tail's claim stamp — job scheduling state, present here
// and deliberately ABSENT from the Zero schema, an asymmetry the drift test asserts rather than
// tolerates. No `assignee`/`author`/`user_id` dimension: the blameless guarantee is schema-level
// here exactly as it is on `cycle_digest`.
export interface RetroAiDraftTable {
  id: string
  retro_id: string
  team_id: string
  status: Generated<AiArtifactStatus>
  claimed_at: TimestampOrNull
  provider: Nullable<string>
  model: Nullable<string>
  input_token: Nullable<number>
  output_token: Nullable<number>
  estimated_cost_usd: Nullable<number>
  generated_at: TimestampOrNull
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// One sanitized proposal. Rows rather than a `content` jsonb because change 19 keys reactions and
// provenance on a stable proposal id and needs a real FK target. `refs` is the cite-or-omit
// evidence, already narrowed to ids yapm computed; `rank` is the 0-based order within the category.
export interface RetroAiProposalTable {
  id: string
  draft_id: string
  retro_id: string
  team_id: string
  category: RetroProposalCategory
  summary: string
  confidence: DigestConfidence
  refs: JsonWithDefault<readonly RetroSeedRef[]>
  rank: number
  // The four written-once ratification columns (change 19). NONE of them is a counter: they are
  // computed in one pass at the `vote -> discuss` advance and set back to null by the step back, so
  // nothing on the reaction path ever writes here.
  verdict: Nullable<RetroProposalVerdict>
  agree_count: Nullable<number>
  disagree_count: Nullable<number>
  ratified_at: TimestampOrNull
  created_at: Generated<Timestamp>
}

// One member's decision on one proposal. THE COMPOUND NATURAL KEY IS THE PRIMARY KEY — nothing is
// minted anywhere on the reaction path, so a mutator re-run during rebase upserts the same row, and
// "one member, one reaction, one proposal" is enforced by the PK index rather than by validation.
// `user_id` carries no foreign key (the `retro_presence` precedent — better-auth owns `user`).
// `retro_id` and `team_id` exist for the server's one-shot count and for membership cleanup; they
// are NOT sync scopes, because exactly one person ever reads a given row: its author.
export interface RetroAiReactionTable {
  proposal_id: string
  user_id: string
  retro_id: string
  team_id: string
  value: RetroReactionValue
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// One row per person per event. The FOUR-COLUMN NATURAL KEY IS THE PRIMARY KEY — nothing is
// minted anywhere in the notification path, so a mutator re-run during rebase can neither
// duplicate a row nor change one, and `on conflict do nothing` is answered by the PK index itself.
// `subject_key`/`subject_title` are snapshots, not joins (design D3).
export interface NotificationTable {
  recipient_id: string
  actor_id: string
  kind: NotificationKind
  team_id: string
  subject_type: NotificationSubjectType
  subject_id: string
  subject_key: Nullable<string>
  subject_title: string
  event_key: string
  read_at: TimestampOrNull
  email_sent_at: TimestampOrNull
  // `Timestamp` (not `Generated<Timestamp>`) for the same reason `connector_config` uses it: the
  // column is DB-defaulted and omittable on insert, but the fan-out sets it from the triggering
  // mutation's own timestamp rather than from `now()`.
  created_at: Timestamp
}

// One row per (issue, person) standing intent. THE TWO-COLUMN NATURAL KEY IS THE PRIMARY KEY, so
// nothing is minted anywhere in the subscription path and `on conflict do nothing` is answered by
// the PK index itself. `state` rather than row existence is what makes an unfollow stick: the
// auto-subscribe insert can create a subscription but can never resurrect one somebody turned off.
export interface IssueSubscriptionTable {
  issue_id: string
  user_id: string
  team_id: string
  state: Generated<SubscriptionState>
  // `Timestamp` rather than `Generated<Timestamp>` for the same reason `notification.created_at`
  // uses it: DB-defaulted and omittable on insert, but a writer inside a mutation sets it from that
  // mutation's own timestamp rather than from `now()`, so the value is deterministic under rebase.
  // `created_at` also orders the subscriber fan-out, oldest-following first.
  created_at: Timestamp
  updated_at: Timestamp
}

// SERVER-ONLY. The searchable projection of the two allowlisted entity types — in this interface
// and in the migrations, deliberately ABSENT from the Zero schema (asserted by the drift test
// beside `retro_card_author`), so no synced query can name it.
//
// NEVER AN AI DATA SOURCE. `body` holds the plaintext of every indexed description and comment,
// including colleagues' names resolved from mention nodes. The AI substrate's guarantee is that a
// model is fed only team-level aggregates that structurally cannot name a person; a searchable
// projection of every document is exactly the shape that would break it. `richTextToPlainText`'s
// `'strip'` mode stays mandatory on model-facing paths — search is not one, which is precisely why
// it must not become one.
//
// `title`/`body` are plain text and DB-defaulted to `''`; the weighted `tsvector` exists only
// inside the GIN index expression, so nothing exotic enters the replication path. `team_id` is
// denormalised off the owning issue and is sound only because an issue can never change team.
export interface SearchDocumentTable {
  entity_type: 'issue' | 'comment'
  entity_id: string
  team_id: string
  issue_id: string
  comment_id: Nullable<string>
  title: Generated<string>
  body: Generated<string>
  // The source row's own `updated_at`, copied verbatim — never `now()`. Both the incremental
  // watermark and the reconcile's staleness diff compare against it.
  source_updated_at: Timestamp
  indexed_at: Generated<Timestamp>
}

// An uploaded file's row. Bytes live in the storage provider under `<team_id>/<id>`; there is no
// `storage_key` column, because a stored key is one refactor away from being rendered.
//
// `byte_size` is `bigint`, and node-postgres hands `int8` back as a STRING (no type parser is
// registered, and registering a global one would change how every other int8 in the process reads).
// The one file that owns every statement over this table — `db/attachment.ts` — converts at its
// boundary, so nothing outside it ever sees the string. `Timestamp`/`boolean` rather than
// `Generated<…>` on the DB-defaulted columns: kysely 0.28.17's `Generated` WRAPS rather than
// unwraps, which mis-types both select and update (the connectors decision).
export interface AttachmentTable {
  id: string
  team_id: string
  issue_id: Nullable<string>
  comment_id: Nullable<string>
  uploader_id: string
  filename: string
  // The SNIFFED media type, never the client's claim.
  content_type: string
  byte_size: ColumnType<string, number | string, number | string>
  has_thumbnail: boolean
  created_at: Timestamp
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

// Owned by better-auth's SSO plugin, like `user` above and read here for exactly three reasons: the
// anonymous availability probe, the redacted admin list, and the workspace-ownership transfer. The
// column list is the DDL `compileMigrations()` actually emitted (reference/kysely-stack.md §5.4) —
// this table has NO `createdAt`/`updatedAt`, unlike every other better-auth table.
//
// `oidcConfig`/`samlConfig` are `text` holding JSON with `clientSecret`, `privateKey` and
// `decryptionPvk` in cleartext. They are typed here so `db/sso.ts` can parse one field out of them;
// no other file may select them, and nothing on this table ever reaches the Zero schema.
export interface SsoProviderTable {
  id: string
  issuer: string
  oidcConfig: Nullable<string>
  samlConfig: Nullable<string>
  userId: string
  providerId: string
  organizationId: Nullable<string>
  domain: string
  // Nullable with no default: null is "not verified", so a usable-provider probe tests `= true`.
  domainVerified: Nullable<boolean>
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
  cycle_digest: CycleDigestTable
  pm_digest: PmDigestTable
  ai_disclosure_audit: AiDisclosureAuditTable
  retro: RetroTable
  retro_column: RetroColumnTable
  retro_draft: RetroDraftTable
  retro_card: RetroCardTable
  retro_card_author: RetroCardAuthorTable
  retro_group: RetroGroupTable
  retro_vote: RetroVoteTable
  retro_vote_tally: RetroVoteTallyTable
  retro_action: RetroActionTable
  retro_presence: RetroPresenceTable
  retro_ai_draft: RetroAiDraftTable
  retro_ai_proposal: RetroAiProposalTable
  retro_ai_reaction: RetroAiReactionTable
  notification: NotificationTable
  issue_subscription: IssueSubscriptionTable
  search_document: SearchDocumentTable
  attachment: AttachmentTable
  user: UserTable
  ssoProvider: SsoProviderTable
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

export type CycleDigest = Selectable<CycleDigestTable>
export type NewCycleDigest = Insertable<CycleDigestTable>
export type CycleDigestUpdate = Updateable<CycleDigestTable>

export type PmDigest = Selectable<PmDigestTable>
export type NewPmDigest = Insertable<PmDigestTable>
export type PmDigestUpdate = Updateable<PmDigestTable>

export type AiDisclosureAudit = Selectable<AiDisclosureAuditTable>
export type NewAiDisclosureAudit = Insertable<AiDisclosureAuditTable>

export type Retro = Selectable<RetroTable>
export type NewRetro = Insertable<RetroTable>
export type RetroUpdate = Updateable<RetroTable>

export type RetroColumn = Selectable<RetroColumnTable>
export type NewRetroColumn = Insertable<RetroColumnTable>

export type RetroDraft = Selectable<RetroDraftTable>
export type NewRetroDraft = Insertable<RetroDraftTable>

export type RetroCard = Selectable<RetroCardTable>
export type NewRetroCard = Insertable<RetroCardTable>

export type RetroCardAuthor = Selectable<RetroCardAuthorTable>
export type NewRetroCardAuthor = Insertable<RetroCardAuthorTable>

export type RetroGroup = Selectable<RetroGroupTable>
export type NewRetroGroup = Insertable<RetroGroupTable>

export type RetroVote = Selectable<RetroVoteTable>
export type NewRetroVote = Insertable<RetroVoteTable>

export type RetroVoteTally = Selectable<RetroVoteTallyTable>
export type NewRetroVoteTally = Insertable<RetroVoteTallyTable>

export type RetroAction = Selectable<RetroActionTable>
export type NewRetroAction = Insertable<RetroActionTable>

export type RetroPresence = Selectable<RetroPresenceTable>
export type NewRetroPresence = Insertable<RetroPresenceTable>

export type RetroAiDraft = Selectable<RetroAiDraftTable>
export type NewRetroAiDraft = Insertable<RetroAiDraftTable>
export type RetroAiDraftUpdate = Updateable<RetroAiDraftTable>

export type RetroAiProposal = Selectable<RetroAiProposalTable>
export type NewRetroAiProposal = Insertable<RetroAiProposalTable>
export type RetroAiProposalUpdate = Updateable<RetroAiProposalTable>

export type RetroAiReaction = Selectable<RetroAiReactionTable>
export type NewRetroAiReaction = Insertable<RetroAiReactionTable>

export type Notification = Selectable<NotificationTable>
export type NewNotification = Insertable<NotificationTable>
export type NotificationUpdate = Updateable<NotificationTable>

export type IssueSubscription = Selectable<IssueSubscriptionTable>
export type NewIssueSubscription = Insertable<IssueSubscriptionTable>
export type IssueSubscriptionUpdate = Updateable<IssueSubscriptionTable>

export type SearchDocument = Selectable<SearchDocumentTable>
export type NewSearchDocument = Insertable<SearchDocumentTable>
export type SearchDocumentUpdate = Updateable<SearchDocumentTable>

export type Attachment = Selectable<AttachmentTable>
export type NewAttachment = Insertable<AttachmentTable>
export type AttachmentUpdate = Updateable<AttachmentTable>

export type User = Selectable<UserTable>

export type SsoProvider = Selectable<SsoProviderTable>
