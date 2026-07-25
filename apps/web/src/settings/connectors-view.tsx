import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { CheckIcon, ExternalLinkIcon, PlusIcon, XIcon } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  type ConnectorStatusResponse,
  fetchGithubConnector,
  mapRepoToTeam,
  type RedactedInstallation,
  setGithubConnectorEnabled,
  unmapRepo,
} from '@/settings/connectors'

const DOCS_URL = 'https://docs.yapm.dev/self-hosting/github-connector/'

const WEBHOOK_PATH = '/api/github/webhooks'

const STATUS_TEXT: Record<string, string> = {
  disabled: 'Disabled',
  pending: 'Awaiting first sync',
  connected: 'Connected',
  error: 'Error',
}

export function ConnectorsView() {
  const { canManage } = useMembership()

  if (!canManage) {
    return (
      <p className="text-sm text-text-3" role="status">
        Connector settings are available to workspace admins only.
      </p>
    )
  }

  return <ConnectorsAdmin />
}

function ConnectorsAdmin() {
  const [data, setData] = useState<ConnectorStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    try {
      setData(await fetchGithubConnector())
      setError(undefined)
    } catch {
      setError('Could not load connector status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <section aria-labelledby="connectors-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 id="connectors-heading" className="font-heading text-2xl font-semibold tracking-tight">
          Connectors
        </h1>
        <p className="text-sm text-text-3">
          Link GitHub so pull-request, CI, and deploy state flow into your work graph and light up
          the reality strip on every issue.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-text-3" role="status">
          Loading connector status…
        </p>
      ) : data ? (
        <GithubConnectorCard data={data} onChanged={reload} />
      ) : error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function GithubConnectorCard({
  data,
  onChanged,
}: {
  data: ConnectorStatusResponse
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const enabled = data.status?.enabled ?? false

  const toggle = async () => {
    setBusy(true)
    setActionError(undefined)
    try {
      await setGithubConnectorEnabled(!enabled)
      await onChanged()
    } catch {
      setActionError('Could not update the connector.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border p-4">
      {actionError !== undefined ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-control border border-status-urgent/40 bg-status-urgent/10 px-3 py-2 text-sm text-status-urgent"
        >
          <span className="min-w-0 flex-1">{actionError}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss error"
            onClick={() => setActionError(undefined)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-control bg-bg-hover font-mono text-sm">
          GH
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-text-1">GitHub</span>
          <span className="text-xs text-text-3">
            {data.status ? (STATUS_TEXT[data.status.status] ?? data.status.status) : 'Not enabled'}
          </span>
        </div>
        {data.configured ? (
          <Button
            size="sm"
            variant={enabled ? 'outline' : 'default'}
            onClick={toggle}
            disabled={busy}
            data-testid="connector-toggle"
          >
            {enabled ? 'Disable' : 'Enable'}
          </Button>
        ) : null}
      </div>

      {data.configured ? null : <NotConfigured missingEnv={data.missingEnv} />}

      {data.configured && data.status ? (
        <ConnectedDetail status={data.status} onChanged={onChanged} setError={setActionError} />
      ) : null}
    </div>
  )
}

function NotConfigured({ missingEnv }: { missingEnv: string[] }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-control bg-bg-hover/60 p-3"
      data-testid="not-configured"
    >
      <p className="text-sm text-text-2">
        The GitHub App is not configured on this server. An operator sets these environment
        variables, then restarts yapm:
      </p>
      {missingEnv.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {missingEnv.map((name) => (
            <li
              key={name}
              className="rounded-control bg-bg px-2 py-0.5 font-mono text-[11.5px] text-text-2"
            >
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-text-3">
        Point the App's webhook URL at{' '}
        <code className="font-mono text-text-2">
          {window.location.origin}
          {WEBHOOK_PATH}
        </code>
        .
      </p>
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 rounded-control text-sm text-accent-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
      >
        Set up the GitHub connector
        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
      </a>
    </div>
  )
}

function ConnectedDetail({
  status,
  onChanged,
  setError,
}: {
  status: NonNullable<ConnectorStatusResponse['status']>
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-y-1 text-[12.5px]">
        <dt className="text-text-3">Last synced</dt>
        <dd className="text-text-2">
          {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Never'}
        </dd>
        {status.lastError ? (
          <>
            <dt className="text-text-3">Last error</dt>
            <dd className="text-status-urgent">{status.lastError}</dd>
          </>
        ) : null}
      </dl>

      {status.installations.length === 0 ? (
        <p className="text-sm text-text-3" data-testid="no-installations">
          No installations yet. Install the GitHub App on your account or organization; it appears
          here once GitHub sends the installation webhook.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {status.installations.map((installation) => (
            <InstallationRow
              key={installation.externalInstallationId}
              installation={installation}
              onChanged={onChanged}
              setError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function InstallationRow({
  installation,
  onChanged,
  setError,
}: {
  installation: RedactedInstallation
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  const [teams] = useQuery(queries.teams.all())
  const [busy, setBusy] = useState(false)
  const entries = Object.entries(installation.repoMapping)

  const remove = async (repo: string) => {
    setBusy(true)
    setError(undefined)
    try {
      await unmapRepo(installation.externalInstallationId, repo)
      await onChanged()
    } catch {
      setError('Could not remove the mapping.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-1">
          {installation.accountLogin ?? 'Installation'}
        </span>
        <span className="font-mono text-[11px] text-text-3">
          #{installation.externalInstallationId}
        </span>
      </div>

      {entries.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="repo-mappings">
          {entries.map(([repo, teamId]) => {
            const team = teams.find((candidate) => candidate.id === teamId)
            return (
              <li key={repo} className="flex items-center gap-2 text-[12.5px]">
                <span className="font-mono text-text-2">{repo}</span>
                <span className="text-text-3">→</span>
                <span className="text-text-1">{team?.name ?? teamId}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label={`Remove mapping for ${repo}`}
                  disabled={busy}
                  onClick={() => remove(repo)}
                >
                  <XIcon />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[12.5px] text-text-3">No repositories mapped to a team yet.</p>
      )}

      <MapRepoForm
        externalInstallationId={installation.externalInstallationId}
        teams={teams.map((team) => ({ id: team.id, name: team.name }))}
        onChanged={onChanged}
        setError={setError}
      />
    </li>
  )
}

function MapRepoForm({
  externalInstallationId,
  teams,
  onChanged,
  setError,
}: {
  externalInstallationId: string
  teams: readonly { id: string; name: string }[]
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  const repoId = useId()
  const teamSelectId = useId()
  const [repo, setRepo] = useState('')
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const trimmed = repo.trim()
    if (trimmed.length === 0 || teamId === '') return
    setBusy(true)
    setError(undefined)
    try {
      await mapRepoToTeam(externalInstallationId, trimmed, teamId)
      setRepo('')
      setTeamId('')
      setDone(true)
      window.setTimeout(() => setDone(false), 1500)
      await onChanged()
    } catch {
      setError('Could not save the mapping.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <div className="flex flex-col gap-1">
        <Label htmlFor={repoId} className="text-[11px] text-text-3">
          Repository
        </Label>
        <Input
          id={repoId}
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="owner/repo"
          className="h-7 w-40 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={teamSelectId} className="text-[11px] text-text-3">
          Team
        </Label>
        <Select
          id={teamSelectId}
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className="h-7 w-40"
        >
          <option value="">Select a team…</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={busy || repo.trim().length === 0 || teamId === ''}
        data-testid="map-repo"
      >
        {done ? <CheckIcon /> : <PlusIcon />}
        Map
      </Button>
    </form>
  )
}
