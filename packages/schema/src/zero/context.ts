export const WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const THEME_PRESETS = ['warm', 'focused', 'editorial'] as const

export type ThemePreset = (typeof THEME_PRESETS)[number]

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
