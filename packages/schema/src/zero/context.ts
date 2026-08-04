export const WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const THEME_PRESETS = ['warm', 'focused', 'editorial'] as const

export type ThemePreset = (typeof THEME_PRESETS)[number]

export const ISSUE_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'canceled',
] as const

export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_PRIORITIES = ['no_priority', 'low', 'medium', 'high', 'urgent'] as const

export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

export const CYCLE_STATUSES = ['upcoming', 'active', 'completed'] as const

export type CycleStatus = (typeof CYCLE_STATUSES)[number]

export const PROJECT_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

// The retro's ordered phase machine. ORDER IS LOAD-BEARING: `retro.setPhase` accepts only an
// adjacent target (exactly one step forward or one step back), computed from this array's indices,
// and `isRetroWriteAllowed` keys its matrix off these names. Never reorder or insert in the middle
// without revisiting `retro/phase.ts` and its exhaustive tests.
export const RETRO_PHASES = ['brainstorm', 'group', 'vote', 'discuss', 'actions', 'closed'] as const

export type RetroPhase = (typeof RETRO_PHASES)[number]

// Four starter formats, each a column-set over one board engine (columns are rows, so a custom
// format costs no schema change — only a template-editor UI, which is deferred). The template map
// itself lives in `retro/phase.ts`; this is the stored key.
export const RETRO_FORMATS = [
  'wentwell_didnt_action',
  'start_stop_continue',
  'mad_sad_glad',
  '4ls',
] as const

export type RetroFormat = (typeof RETRO_FORMATS)[number]

export const DEFAULT_RETRO_FORMAT: RetroFormat = 'wentwell_didnt_action'

// A dot targets a group once the card has been grouped, and the card itself otherwise.
export const RETRO_VOTE_TARGETS = ['card', 'group'] as const

export type RetroVoteTarget = (typeof RETRO_VOTE_TARGETS)[number]

// The team's decision signal over one AI proposal. Bidirectional and unbudgeted, which is why it is
// not a dot vote: a disagree must cost nothing and must not compete with a ranking budget.
export const RETRO_REACTION_VALUES = ['agree', 'disagree'] as const

export type RetroReactionValue = (typeof RETRO_REACTION_VALUES)[number]

// `unrated` is the honest fourth value: nobody responded, so the team decided nothing, and rendering
// silence as agreement would manufacture consent. The rule that picks between the other three is
// fixed and knob-free — see `retro/ratify.ts`.
export const RETRO_PROPOSAL_VERDICTS = ['agreed', 'contested', 'rejected', 'unrated'] as const

export type RetroProposalVerdict = (typeof RETRO_PROPOSAL_VERDICTS)[number]

// The CHECK-constraint text for both, spelled ONCE beside the union so the migration and the
// TypeScript type cannot drift. The `AI_ARTIFACT_STATUS_CHECK` precedent: migrations wrap these in
// `sql.raw`, and this module stays free of a kysely import because the client bundle imports it.
export const RETRO_REACTION_VALUE_CHECK = `value in (${RETRO_REACTION_VALUES.map((value) => `'${value}'`).join(', ')})`

export const RETRO_PROPOSAL_VERDICT_CHECK = `verdict in (${RETRO_PROPOSAL_VERDICTS.map((verdict) => `'${verdict}'`).join(', ')})`

// A column's accent is stored as a retro-SEMANTIC key, never a color literal and never a CSS
// variable name: `packages/ui` maps each key to a theme token so the accent stays correct in
// Warm/Focused/Editorial, light and dark, at AA.
export const RETRO_COLUMN_ACCENTS = [
  'positive',
  'negative',
  'caution',
  'neutral',
  'action',
] as const

export type RetroColumnAccent = (typeof RETRO_COLUMN_ACCENTS)[number]

// Default vote budget: one knob, settable only during `brainstorm`, stacking allowed.
export const DEFAULT_VOTES_PER_PARTICIPANT = 3
export const MIN_VOTES_PER_PARTICIPANT = 1
export const MAX_VOTES_PER_PARTICIPANT = 10

// The heartbeat window the maintenance pass prunes against, and the client's heartbeat interval.
export const RETRO_PRESENCE_STALE_MS = 5 * 60 * 1000
export const RETRO_PRESENCE_HEARTBEAT_MS = 10 * 1000

// Provider-neutral connector surface. `github` is the only v1 provider; the AI change
// reuses this table set for BYO-key AI providers, so the accessors treat `provider` as an
// open string rather than binding it to this list.
export const CONNECTOR_PROVIDERS = ['github'] as const

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number]

// The BYO-key AI providers the gateway can construct. Stored as the `key` of a
// `connector_secret` under the single `provider = "ai"` connector_config row (the AI change
// reuses the connector surface — no new table). Model IDs are runtime config, never enumerated
// here (they are volatile — see reference/ai-providers.md).
export const AI_PROVIDERS = ['anthropic', 'google', 'openai'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

// The lifecycle of EVERY pre-computed AI artifact — the cycle digest and the retro draft alike.
// `pending` = enqueued/not-yet-run; `ready` = generated + validated; `ai_off` = AI disabled /
// keyless / spend-capped (the consumer falls back to raw linked evidence); `failed` = the run
// errored (same fallback). One union so a second artifact table cannot invent a fifth state.
export const AI_ARTIFACT_STATUSES = ['pending', 'ready', 'failed', 'ai_off'] as const

export type AiArtifactStatus = (typeof AI_ARTIFACT_STATUSES)[number]

// The CHECK-constraint text every AI artifact table's `status` column carries, spelled ONCE so a
// later migration cannot drift from `0010_ai`'s. Migrations wrap it in `sql.raw`; this module stays
// free of a kysely import because the client bundle imports it.
export const AI_ARTIFACT_STATUS_CHECK = `status in (${AI_ARTIFACT_STATUSES.map((status) => `'${status}'`).join(', ')})`

export const CYCLE_DIGEST_STATUSES = AI_ARTIFACT_STATUSES

export type CycleDigestStatus = AiArtifactStatus

export const CONNECTOR_STATUSES = ['disabled', 'pending', 'connected', 'error'] as const

export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number]

// The non-secret settings blob of a connector config (repo filters etc.). Opaque here —
// each connector validates its own shape with a Zod `configSchema`.
export type ConnectorConfigData = Record<string, unknown>

// Provider-neutral work-graph enums. The stored `pull_request.state` is the raw lifecycle
// (draft/open/merged/closed) faithful to any provider's PR/MR object; the reality strip's
// `approved` state is REVIEW-derived (see `delivery.ts`), never stored on the PR row.
export const PULL_REQUEST_STATES = ['draft', 'open', 'merged', 'closed'] as const

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number]

// A rolled-up CI conclusion, provider-neutral (GitHub check-run conclusions and a GitLab
// pipeline status both normalize here). `pending` covers not-yet-terminal runs.
export const CI_CONCLUSIONS = [
  'success',
  'failure',
  'pending',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
] as const

export type CiConclusion = (typeof CI_CONCLUSIONS)[number]

export const REVIEW_STATES = ['approved', 'changes_requested', 'commented', 'dismissed'] as const

export type ReviewState = (typeof REVIEW_STATES)[number]

export const DEPLOYMENT_STATES = [
  'queued',
  'in_progress',
  'success',
  'failure',
  'error',
  'inactive',
  'pending',
] as const

export type DeploymentState = (typeof DEPLOYMENT_STATES)[number]

// Which rule linked an issue to a PR: a branch name (`head.ref`) or the PR body magic word.
export const CONNECTOR_LINK_SOURCES = ['branch', 'body'] as const

export type ConnectorLinkSource = (typeof CONNECTOR_LINK_SOURCES)[number]

// What a person can be told about. Deliberately NOT constrained in Postgres (see
// `0013_notifications`): adding `'mention'` must cost a union member and a copy string, not a
// migration in a different change. This union and the Zod arg schemas are the validation.
export const NOTIFICATION_KINDS = ['issue_assigned', 'issue_commented', 'mention'] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

// The thing a notification points at. Polymorphic by design — `subject_id` carries no FK — so a
// later subject type costs no schema change.
export const NOTIFICATION_SUBJECT_TYPES = ['issue'] as const

export type NotificationSubjectType = (typeof NOTIFICATION_SUBJECT_TYPES)[number]

// The per-user EMAIL preference. It never governs the in-app row: turning email off costs you
// nothing in the inbox.
export const EMAIL_NOTIFICATION_MODES = ['all', 'assigned_only', 'none'] as const

export type EmailNotificationMode = (typeof EMAIL_NOTIFICATION_MODES)[number]

export const DEFAULT_EMAIL_NOTIFICATION_MODE: EmailNotificationMode = 'assigned_only'

// ACTIONABLE = addressed at a person; everything else is ambient. `assigned_only` (the default)
// emails exactly this set, `all` emails every kind, `none` emails nothing.
//
// `'mention'` IS IN AND `'issue_commented'` IS OUT, and that pair of memberships is the whole
// "being mentioned emails you once, the thread it subscribed you to never does" rule — derived from
// the existing classification rather than asserted by a special case anywhere in the delivery sweep.
export const ACTIONABLE_NOTIFICATION_KINDS: ReadonlySet<NotificationKind> =
  new Set<NotificationKind>(['issue_assigned', 'mention'])

export function isActionableNotification(kind: NotificationKind): boolean {
  return ACTIONABLE_NOTIFICATION_KINDS.has(kind)
}

// The inbox's synced ceiling, and the bound `notification.markAllRead` loops within, so client and
// server agree on how many rows one deliberate action touches. Load-bearing rather than hygiene: a
// per-user table that grows forever is a hydration cost on every client, and the retention sweep is
// the other half of that bound.
export const NOTIFICATION_SYNC_LIMIT = 100

// A standing intent to be told about one issue, and the reason it is a state rather than a row that
// exists or does not: unfollow must be STICKY. Deleting the row would let the next `@` re-subscribe
// somebody who deliberately left, which is a worse failure than never having offered an unfollow.
// The set is closed and owned entirely by this change, so `0014_mentions` puts a CHECK on it too.
export const SUBSCRIPTION_STATES = ['subscribed', 'unsubscribed'] as const

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number]

export const ISSUE_GROUPINGS = ['status', 'assignee', 'priority', 'label', 'none'] as const

export type IssueGrouping = (typeof ISSUE_GROUPINGS)[number]

export const ISSUE_SORT_KEYS = [
  'status',
  'priority',
  'assignee',
  'updated',
  'created',
  'number',
] as const

export type IssueSortKey = (typeof ISSUE_SORT_KEYS)[number]

export type SortDirection = 'asc' | 'desc'

// A TipTap-v3 document, stored verbatim as jsonb. The schema layer treats it as opaque
// structured JSON; the editor/renderer in packages/ui owns the node shape.
export interface RichTextDoc {
  readonly type: 'doc'
  readonly content?: readonly unknown[]
}

export interface AuthContext {
  readonly userID: string
  readonly role: WorkspaceRole | null
}

// The instance acting as itself: cycle rollover, and the connector union's status automation.
// Two rules bound this principal, and neither is expressible in the type:
//   1. It is reachable only from server-side call sites driven by instance-produced data — a
//      scheduler tick, or a mutation the ingest path derived from a verified provider delivery.
//   2. It is never derived from a request. No header, token, cookie or payload field may select
//      it, and no client mutator may be invoked under it.
// It carries `admin` so the team-scoped write gates pass for every team; no user is impersonated,
// and `userID` is a reserved literal rather than a row in `user`.
export const SYSTEM_ACTOR_ID = 'system'

export const SYSTEM_AUTH_CONTEXT: AuthContext = { userID: SYSTEM_ACTOR_ID, role: 'admin' }

// User-scoped entities gate on identity alone: authenticated is enough, membership is not
// required (a signed-in non-member still reads and writes their own preference).
export function isAuthenticated(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined
}

export function isMember(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined && ctx.role !== null
}

export function canRead(ctx: AuthContext | undefined): ctx is AuthContext {
  return isMember(ctx)
}

export function canWrite(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined && ctx.role !== null && ctx.role !== 'viewer'
}

export function canManage(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined && ctx.role === 'admin'
}

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: AuthContext | undefined
  }
}
