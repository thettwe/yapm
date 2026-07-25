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

// Provider-neutral connector surface. `github` is the only v1 provider; the AI change
// reuses this table set for BYO-key AI providers, so the accessors treat `provider` as an
// open string rather than binding it to this list.
export const CONNECTOR_PROVIDERS = ['github'] as const

export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number]

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
