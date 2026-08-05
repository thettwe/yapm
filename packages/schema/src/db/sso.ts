import type { Kysely } from 'kysely'
import type { DB } from './types.js'

// The ONLY place in yapm that reads a better-auth-owned configuration table, and the only field it
// ever WRITES is `userId` — the ownership pointer, and only to a user id better-auth itself minted.
// Every configuration field belongs to the plugin: registration, update, deletion and domain
// verification all go through `auth.api.*` so the plugin's OIDC discovery, issuer validation and
// config parsing stay in one place.
//
// `oidcConfig` is `text` holding JSON that carries `clientSecret` in cleartext (and `samlConfig`
// carries `privateKey`/`decryptionPvk`). Nothing below returns either blob; the redacted shape is
// the export, so a caller cannot accidentally spread a row into a response.

export interface RedactedSsoProvider {
  providerId: string
  issuer: string
  domain: string
  domainVerified: boolean
  discoveryEndpoint: string | null
  // The last four characters of the client id — enough for an admin to tell two IdP registrations
  // apart, not enough to be a credential. Mirrors the plugin's own `sanitizeProvider`.
  clientIdLastFour: string | null
}

// Whether this instance can actually sign anyone in over SSO. VERIFIED, not merely registered: the
// plugin refuses sign-in against an unverified provider, so a registered-but-unverified provider
// would put a button on the login form that cannot work. `domainVerified` is nullable with no
// default, so `= true` is the test — `is not false` would count a freshly registered row.
export async function hasUsableSsoProvider(db: Kysely<DB>): Promise<boolean> {
  const row = await db
    .selectFrom('ssoProvider')
    .select('providerId')
    .where('domainVerified', '=', true)
    .limit(1)
    .executeTakeFirst()
  return row !== undefined
}

function lastFour(clientId: unknown): string | null {
  return typeof clientId === 'string' && clientId.length > 0 ? clientId.slice(-4) : null
}

function readOidc(raw: string | null): { discoveryEndpoint: string | null; clientId: unknown } {
  if (raw === null) return { discoveryEndpoint: null, clientId: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { discoveryEndpoint: null, clientId: null }
    }
    const config = parsed as Record<string, unknown>
    return {
      discoveryEndpoint:
        typeof config.discoveryEndpoint === 'string' ? config.discoveryEndpoint : null,
      clientId: config.clientId,
    }
  } catch {
    return { discoveryEndpoint: null, clientId: null }
  }
}

export interface SsoProviderRow {
  providerId: string
  issuer: string
  domain: string
  domainVerified: boolean | null
  oidcConfig: string | null
}

// Constructed field by field, never spread from the row: a spread would put the whole `oidcConfig`
// blob — `clientSecret` included — into the result the moment somebody added a column.
export function redactSsoProvider(row: SsoProviderRow): RedactedSsoProvider {
  const oidc = readOidc(row.oidcConfig)
  return {
    providerId: row.providerId,
    issuer: row.issuer,
    domain: row.domain,
    domainVerified: row.domainVerified === true,
    discoveryEndpoint: oidc.discoveryEndpoint,
    clientIdLastFour: lastFour(oidc.clientId),
  }
}

// The WORKSPACE's providers, not "the providers I registered" — which is what the plugin's own
// `/sso/providers` would answer (design §D4). Callers are admin-gated before this runs.
export async function listSsoProvidersRedacted(db: Kysely<DB>): Promise<RedactedSsoProvider[]> {
  const rows = await db
    .selectFrom('ssoProvider')
    .select(['providerId', 'issuer', 'domain', 'domainVerified', 'oidcConfig'])
    .orderBy('providerId')
    .execute()

  return rows.map(redactSsoProvider)
}

// The ownership transfer of design §D4. The plugin authorizes update/delete/verify by
// `provider.userId === session.user.id`; yapm models a provider as workspace configuration, so a
// workspace admin takes the pointer before delegating. Without this, the admin who set SSO up
// leaving the workspace would make the provider unrotatable and undeletable through any supported
// path, forever.
//
// Returns false when no such provider exists, so a caller can answer 404 without a second read —
// the authorization decision has already been made by the route middleware above it.
export async function claimSsoProvider(
  db: Kysely<DB>,
  providerId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .updateTable('ssoProvider')
    .set({ userId })
    .where('providerId', '=', providerId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}
