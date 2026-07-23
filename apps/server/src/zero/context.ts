import type { AuthContext } from '@yapm/schema'

export const ANONYMOUS_CONTEXT: AuthContext = {
  userID: 'anonymous',
  role: 'member',
}

export type ResolveAuthContext = (
  request: Request,
) => Promise<AuthContext | undefined> | AuthContext | undefined

// Single-tenant instance: every caller is the same member until workspace-auth
// introduces sessions. The deny path lives in the queries and mutators already.
export const resolveAnonymousContext: ResolveAuthContext = () => ANONYMOUS_CONTEXT
