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
