import { describe, expect, it } from 'vitest'
import { redactSsoProvider, type SsoProviderRow } from './sso.js'

const CLIENT_SECRET = 'idp-client-secret-do-not-leak'
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----leak-----END PRIVATE KEY-----'

const row: SsoProviderRow = {
  providerId: 'acme',
  issuer: 'https://idp.acme.test',
  domain: 'acme.test',
  domainVerified: null,
  oidcConfig: JSON.stringify({
    issuer: 'https://idp.acme.test',
    clientId: 'yapm-client-9876',
    clientSecret: CLIENT_SECRET,
    privateKey: PRIVATE_KEY,
    decryptionPvk: PRIVATE_KEY,
    discoveryEndpoint: 'https://idp.acme.test/.well-known/openid-configuration',
    pkce: true,
  }),
}

describe('redactSsoProvider', () => {
  // Asserted on the SERIALIZED object rather than the type: a `RedactedSsoProvider` return type
  // would still be satisfied by an object carrying extra keys at run time, and the whole point of
  // this helper is that the run-time value is safe to put in an HTTP response.
  it('carries no secret material out of the row', () => {
    const serialized = JSON.stringify(redactSsoProvider(row))
    expect(serialized).not.toContain(CLIENT_SECRET)
    expect(serialized).not.toContain(PRIVATE_KEY)
    expect(serialized).not.toContain('clientSecret')
    expect(serialized).not.toContain('privateKey')
    expect(serialized).not.toContain('decryptionPvk')
  })

  it('returns exactly the six fields the admin surface may show', () => {
    expect(Object.keys(redactSsoProvider(row)).sort()).toEqual([
      'clientIdLastFour',
      'discoveryEndpoint',
      'domain',
      'domainVerified',
      'issuer',
      'providerId',
    ])
  })

  it('masks the client id down to its last four characters', () => {
    expect(redactSsoProvider(row).clientIdLastFour).toBe('9876')
  })

  // Null is the state a freshly registered provider is in — `domainVerified` is nullable with no
  // default — and it must read as unverified, not as "unknown".
  it('reads a null domainVerified as false', () => {
    expect(redactSsoProvider(row).domainVerified).toBe(false)
    expect(redactSsoProvider({ ...row, domainVerified: true }).domainVerified).toBe(true)
  })

  // A SAML-only provider has no `oidcConfig` at all; a corrupted one is not a reason to 500.
  it('survives an absent or unparseable oidcConfig', () => {
    for (const oidcConfig of [null, 'not json', '"a string"']) {
      const redacted = redactSsoProvider({ ...row, oidcConfig })
      expect(redacted.clientIdLastFour).toBeNull()
      expect(redacted.discoveryEndpoint).toBeNull()
    }
  })
})
