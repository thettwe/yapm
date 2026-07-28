import type { AiProvider, AreaRule } from '@yapm/schema'

// Mirrors the server's `RedactedAiStatus` (the server-only AI surface, never synced through Zero):
// the toggle, chosen models, spend cap, and which providers have a key — NO key material, only the
// NAMES of configured providers.
export interface RedactedAiStatus {
  enabled: boolean
  defaultProvider: AiProvider | null
  models: Partial<Record<AiProvider, string>>
  spendCapUsd: number | null
  // Per-workspace ESTIMATED running total (sum of every ready digest's estimated cost).
  spendSoFarUsd: number
  configuredProviders: AiProvider[]
  // The ordered path→product-area map. Order is semantic: the first matching prefix wins.
  areas: AreaRule[]
}

export interface AiStatusResponse {
  // AI can operate (an env instance-default key exists, or UI keys can be stored).
  configured: boolean
  // Whether UI-entered keys can be stored at rest (SECRETS_ENCRYPTION_KEY is set).
  canStoreKeys: boolean
  // Env vars still to set before AI is usable this way; e.g. SECRETS_ENCRYPTION_KEY.
  missingEnv: string[]
  // Providers available as an instance default from env.
  envProviders: AiProvider[]
  envDefaultProvider: AiProvider | null
  status: RedactedAiStatus | null
}

export interface AiConfigPatch {
  enabled?: boolean
  defaultProvider?: AiProvider | null
  models?: Partial<Record<AiProvider, string>>
  spendCapUsd?: number | null
  // Replaced wholesale when sent; omitted leaves the stored map untouched.
  areas?: AreaRule[]
}

const BASE = '/api/v1/ai'

export class AiRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!response.ok) {
    throw new AiRequestError(response.status, `request failed with ${response.status}`)
  }
  return (await response.json()) as T
}

export function fetchAiConfig(): Promise<AiStatusResponse> {
  return request<AiStatusResponse>(BASE)
}

export function updateAiConfig(patch: AiConfigPatch): Promise<AiStatusResponse> {
  return request<AiStatusResponse>(BASE, { method: 'POST', body: JSON.stringify(patch) })
}

// Write-only: the plaintext key is sent once and never read back.
export function setAiProviderKey(provider: AiProvider, value: string): Promise<AiStatusResponse> {
  return request<AiStatusResponse>(`${BASE}/keys/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}

export function removeAiProviderKey(provider: AiProvider): Promise<AiStatusResponse> {
  return request<AiStatusResponse>(`${BASE}/keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  })
}
