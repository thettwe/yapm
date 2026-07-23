export const WORKSPACE_ROLES = ['owner', 'member', 'viewer'] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export interface AuthContext {
  readonly userID: string
  readonly role: WorkspaceRole
}

export function canRead(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined
}

export function canWrite(ctx: AuthContext | undefined): ctx is AuthContext {
  return ctx !== undefined && ctx.role !== 'viewer'
}

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: AuthContext | undefined
  }
}
