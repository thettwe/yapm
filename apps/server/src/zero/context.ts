import type { AuthContext, WorkspaceRole } from '@yapm/schema'
import type { VerifiedToken } from '../auth.js'

export type ResolveAuthContext = (
  request: Request,
) => Promise<AuthContext | undefined> | AuthContext | undefined

export interface SessionContextResolverOptions {
  verifyToken: (token: string) => Promise<VerifiedToken | undefined>
  lookupRole: (userID: string) => Promise<WorkspaceRole | null>
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (header === null) return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

// zero-cache forwards the client's JWT as `Authorization: Bearer <token>`. We verify it
// locally against better-auth's JWKS, take the verified `sub` as the userID (the client
// cannot forge it), then resolve the workspace role. No token / an invalid token yields
// no context, so every query denies and every mutator rejects. An authenticated caller
// with no membership resolves to `role: null`.
export function createSessionContextResolver(
  options: SessionContextResolverOptions,
): ResolveAuthContext {
  return async (request) => {
    const token = bearerToken(request)
    if (token === undefined) return undefined

    const verified = await options.verifyToken(token)
    if (verified === undefined) return undefined

    const role = await options.lookupRole(verified.sub)
    return { userID: verified.sub, role }
  }
}
