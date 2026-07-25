import type { AuthContext, WorkspaceRole } from '@yapm/schema'
import type { VerifiedToken } from '../auth.js'

// "No credential" and "a credential I refuse" are different facts, and Zero's protocol
// treats them differently: an absent one is a legitimately signed-out socket, a rejected one
// must produce 401 so the client re-mints. Collapsing them into `undefined` is what let an
// expired token be reported to zero-cache as the authoritative identity `null`.
export type AuthResolution =
  | { kind: 'authenticated'; ctx: AuthContext }
  | { kind: 'absent' }
  | { kind: 'rejected' }

export const CREDENTIAL_ABSENT: AuthResolution = { kind: 'absent' }
export const CREDENTIAL_REJECTED: AuthResolution = { kind: 'rejected' }

export type ResolveAuthContext = (request: Request) => Promise<AuthResolution> | AuthResolution

// The `AuthContext` handed to queries and mutators is unchanged: absent and rejected both
// deny, so no query predicate or mutator guard has to learn the difference.
export function resolvedContext(resolution: AuthResolution): AuthContext | undefined {
  return resolution.kind === 'authenticated' ? resolution.ctx : undefined
}

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
    if (token === undefined) return CREDENTIAL_ABSENT

    const verified = await options.verifyToken(token)
    if (verified === undefined) return CREDENTIAL_REJECTED

    const role = await options.lookupRole(verified.sub)
    return { kind: 'authenticated', ctx: { userID: verified.sub, role } }
  }
}
