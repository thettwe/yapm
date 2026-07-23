export const WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export interface AuthContext {
  readonly userID: string
  readonly role: WorkspaceRole | null
}

export function canRead(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined
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
