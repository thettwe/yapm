import { describe, expect, it } from 'vitest'
import { SSO_DISABLED_PATHS } from './auth.js'

// The seven provider-management paths of design §D1, read out of `@better-auth/sso@1.6.24`'s
// `createAuthEndpoint(...)` declarations.
const MANAGEMENT_PATHS = [
  '/sso/register',
  '/sso/update-provider',
  '/sso/delete-provider',
  '/sso/providers',
  '/sso/get-provider',
  '/sso/request-domain-verification',
  '/sso/verify-domain',
]

// Every SSO path an ANONYMOUS caller must still reach: the sign-in entry point and every callback.
// `/sign-in/sso` is deliberately in this list even though it is not under `/sso/` — the reason a
// prefix gate was rejected is that the prefix contains both kinds of path and misses this one.
const SIGN_IN_PATHS = [
  '/sign-in/sso',
  '/sso/callback',
  '/sso/callback/:providerId',
  '/sso/saml2/callback/:providerId',
  '/sso/saml2/sp/acs/:providerId',
  '/sso/saml2/sp/slo/:providerId',
  '/sso/saml2/logout/:providerId',
  '/sso/saml2/sp/metadata',
]

describe('SSO_DISABLED_PATHS', () => {
  it('removes every provider-management path from better-auth’s router', () => {
    expect([...SSO_DISABLED_PATHS].sort()).toEqual([...MANAGEMENT_PATHS].sort())
  })

  // The regression this file exists for: adding a callback here would not lock anything down, it
  // would break sign-in for everyone with a 404 mid-flow and no session to explain it.
  it('never disables a sign-in or callback path', () => {
    for (const path of SIGN_IN_PATHS) {
      expect(SSO_DISABLED_PATHS as readonly string[]).not.toContain(path)
    }
  })

  // `disabledPaths` is matched by exact string equality against a normalized pathname, not by
  // prefix. A trailing slash or an embedded query string here would silently match nothing.
  it('spells every entry as an exact, unparameterised path', () => {
    for (const path of SSO_DISABLED_PATHS) {
      expect(path.startsWith('/')).toBe(true)
      expect(path.endsWith('/')).toBe(false)
      expect(path).not.toContain(':')
      expect(path).not.toContain('?')
      expect(path).not.toContain('*')
    }
  })
})
