// Mirrors the server's `/api/v1/sso` surface (server-only, never synced through Zero): the workspace
// SSO configuration an admin reads and writes. NO SHAPE HERE HAS A SECRET FIELD — the client secret
// is write-only, sent once at registration or rotation and never returned, the same contract
// `/settings/ai` uses for provider API keys. What comes back about a client id is its last four
// characters, which tells two registrations apart and is not a credential.

export interface RedactedSsoProvider {
  providerId: string
  issuer: string
  // The plugin's own multi-domain form: one domain, or several separated by commas.
  domain: string
  domainVerified: boolean
  discoveryEndpoint: string | null
  clientIdLastFour: string | null
}

export interface SsoStatusResponse {
  // At least one registered provider whose domain is verified — the same fact `/api/auth-methods`
  // reports, which is what decides whether the login form shows an SSO button.
  configured: boolean
  providers: RedactedSsoProvider[]
}

export interface SsoRegistrationResponse extends SsoStatusResponse {
  providerId: string
  domain: string
  domainVerified: boolean
  // The value to publish in DNS. Null when the instance runs without domain verification.
  domainVerificationToken: string | null
  // The URI to register with the IdP.
  redirectURI: string
}

export interface SsoDomainVerificationResponse {
  providerId: string
  domainVerificationToken: string
}

export interface SsoOidcConfigInput {
  clientId: string
  clientSecret: string
  discoveryEndpoint?: string
}

export interface SsoProviderRegistration {
  providerId: string
  issuer: string
  domain: string
  oidcConfig: SsoOidcConfigInput
}

export interface SsoProviderUpdate {
  issuer?: string
  domain?: string
  oidcConfig?: Partial<SsoOidcConfigInput>
}

const BASE = '/api/v1/sso'

// better-auth's default `domainVerification.tokenPrefix`, which yapm does not override. The DNS
// label the plugin resolves is `_<prefix>-<providerId>`, so the record an admin publishes is
// derivable here rather than round-tripped — the server returns the token, never the record name.
const TOKEN_PREFIX = 'better-auth-token'

export function ssoRecordName(providerId: string, domain: string): string {
  return `_${TOKEN_PREFIX}-${providerId}.${domain}`
}

// A provider may be bound to several comma-separated domains, and verification resolves the record
// under EVERY one of them, so the UI lists a record per domain rather than only the first.
export function ssoDomains(domain: string): string[] {
  return domain
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export class SsoRequestError extends Error {
  readonly status: number
  // The server's own error code, when it sent one. The status alone is ambiguous: registration
  // answers 409 both for a provider id already taken (`provider_exists`) and for the per-account
  // provider cap (`provider_limit_reached`), and those have different remedies.
  readonly code: string | undefined

  constructor(status: number, code?: string) {
    super(code === undefined ? `request failed with ${status}` : `${code} (${status})`)
    this.name = 'SsoRequestError'
    this.status = status
    this.code = code
  }
}

// A refusal body is `{ error: '<code>' }`, but a proxy or a network fault can produce a non-JSON
// body on any status, so an unreadable one degrades to "no code" rather than to a thrown parse error
// that would hide the status the caller actually needs.
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return undefined
    const code = (body as Record<string, unknown>).error
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!response.ok) {
    throw new SsoRequestError(response.status, await errorCode(response))
  }
  return (await response.json()) as T
}

export function fetchSsoConfig(): Promise<SsoStatusResponse> {
  return request<SsoStatusResponse>(BASE)
}

export function registerSsoProvider(
  body: SsoProviderRegistration,
): Promise<SsoRegistrationResponse> {
  return request<SsoRegistrationResponse>(`${BASE}/providers`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Every field optional; an omission leaves the stored value alone. Sending `oidcConfig.clientSecret`
// is how a secret is rotated — there is no read-back and no reveal control anywhere.
export function updateSsoProvider(
  providerId: string,
  patch: SsoProviderUpdate,
): Promise<SsoStatusResponse> {
  return request<SsoStatusResponse>(`${BASE}/providers/${encodeURIComponent(providerId)}`, {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

export function deleteSsoProvider(providerId: string): Promise<SsoStatusResponse> {
  return request<SsoStatusResponse>(`${BASE}/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
  })
}

export function requestSsoDomainVerification(
  providerId: string,
): Promise<SsoDomainVerificationResponse> {
  return request<SsoDomainVerificationResponse>(
    `${BASE}/providers/${encodeURIComponent(providerId)}/domain-verification`,
    { method: 'POST' },
  )
}

export function verifySsoDomain(providerId: string): Promise<SsoStatusResponse> {
  return request<SsoStatusResponse>(`${BASE}/providers/${encodeURIComponent(providerId)}/verify`, {
    method: 'POST',
  })
}
