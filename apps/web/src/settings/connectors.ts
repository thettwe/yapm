import type { ConnectorStatus } from '@yapm/schema'

// Mirrors the server's `RedactedConnectorStatus` (server-only surface, never synced through
// Zero): the redacted connection status the settings UI renders. No secret material — only the
// NAMES of stored secrets.
export interface RedactedInstallation {
  externalInstallationId: string
  accountLogin: string | null
  repoMapping: Record<string, string>
}

export interface RedactedConnectorStatus {
  provider: string
  enabled: boolean
  status: ConnectorStatus
  lastSyncedAt: string | null
  lastError: string | null
  secretKeys: string[]
  installations: RedactedInstallation[]
}

export interface ConnectorStatusResponse {
  provider: string
  // The GitHub App env is present in the server process (a real ingestion path exists).
  configured: boolean
  // The env vars still to set before the connector can ingest; empty when configured.
  missingEnv: string[]
  status: RedactedConnectorStatus | null
}

const BASE = '/api/v1/connectors/github'

export class ConnectorRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ConnectorRequestError'
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
    throw new ConnectorRequestError(response.status, `request failed with ${response.status}`)
  }
  return (await response.json()) as T
}

export function fetchGithubConnector(): Promise<ConnectorStatusResponse> {
  return request<ConnectorStatusResponse>(BASE)
}

export function setGithubConnectorEnabled(enabled: boolean): Promise<ConnectorStatusResponse> {
  return request<ConnectorStatusResponse>(BASE, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}

export function mapRepoToTeam(
  externalInstallationId: string,
  repo: string,
  teamId: string,
): Promise<{ ok: boolean }> {
  return request(`${BASE}/installations/${encodeURIComponent(externalInstallationId)}/repos`, {
    method: 'PUT',
    body: JSON.stringify({ repo, teamId }),
  })
}

export function unmapRepo(externalInstallationId: string, repo: string): Promise<{ ok: boolean }> {
  const url = `${BASE}/installations/${encodeURIComponent(externalInstallationId)}/repos?repo=${encodeURIComponent(repo)}`
  return request(url, { method: 'DELETE' })
}
