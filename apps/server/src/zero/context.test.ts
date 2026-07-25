import type { WorkspaceRole } from '@yapm/schema'
import { describe, expect, it, vi } from 'vitest'
import type { VerifiedToken } from '../auth.js'
import { createSessionContextResolver, resolvedContext } from './context.js'

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/zero/query', { method: 'POST', headers })
}

function resolver(overrides: {
  verifyToken?: (token: string) => Promise<VerifiedToken | undefined>
  lookupRole?: (userID: string) => Promise<WorkspaceRole | null>
}) {
  return createSessionContextResolver({
    verifyToken: overrides.verifyToken ?? (async () => undefined),
    lookupRole: overrides.lookupRole ?? (async () => null),
  })
}

describe('createSessionContextResolver', () => {
  it('reports an absent credential when there is no Authorization header', async () => {
    const verifyToken = vi.fn(async () => ({ sub: 'u1', expiresAt: null }))
    const resolve = resolver({ verifyToken })

    const resolution = await resolve(request())

    expect(resolution.kind).toBe('absent')
    expect(resolvedContext(resolution)).toBeUndefined()
    expect(verifyToken).not.toHaveBeenCalled()
  })

  it('reports an absent credential for a non-Bearer scheme', async () => {
    const verifyToken = vi.fn(async () => ({ sub: 'u1', expiresAt: null }))
    const resolve = resolver({ verifyToken })

    expect((await resolve(request({ authorization: 'Basic abc' }))).kind).toBe('absent')
    expect(verifyToken).not.toHaveBeenCalled()
  })

  it('reports a rejected credential when the token fails verification', async () => {
    const resolve = resolver({
      verifyToken: async () => undefined,
      lookupRole: async () => 'admin',
    })

    const resolution = await resolve(request({ authorization: 'Bearer forged' }))

    expect(resolution.kind).toBe('rejected')
    expect(resolvedContext(resolution)).toBeUndefined()
  })

  it('resolves the verified subject and workspace role', async () => {
    const resolve = resolver({
      verifyToken: async (token) =>
        token === 'good' ? { sub: 'user-1', expiresAt: null } : undefined,
      lookupRole: async (userID) => (userID === 'user-1' ? 'member' : null),
    })

    expect(resolvedContext(await resolve(request({ authorization: 'Bearer good' })))).toEqual({
      userID: 'user-1',
      role: 'member',
    })
  })

  it('resolves role null for an authenticated non-member', async () => {
    const resolve = resolver({
      verifyToken: async () => ({ sub: 'user-2', expiresAt: null }),
      lookupRole: async () => null,
    })

    expect(resolvedContext(await resolve(request({ authorization: 'Bearer good' })))).toEqual({
      userID: 'user-2',
      role: null,
    })
  })

  it('takes the userID from the verified token, never from a client-supplied claim', async () => {
    const resolve = resolver({
      verifyToken: async () => ({ sub: 'server-verified', expiresAt: null }),
      lookupRole: async () => 'admin',
    })

    const ctx = resolvedContext(await resolve(request({ authorization: 'Bearer good' })))
    expect(ctx?.userID).toBe('server-verified')
  })
})
