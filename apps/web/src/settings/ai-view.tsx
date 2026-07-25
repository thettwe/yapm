import { AI_PROVIDERS, type AiProvider } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { CheckIcon, KeyIcon, TrashIcon, XIcon } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  type AiStatusResponse,
  fetchAiConfig,
  removeAiProviderKey,
  setAiProviderKey,
  updateAiConfig,
} from '@/settings/ai'

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  openai: 'OpenAI',
}

export function AiSettingsView() {
  const { canManage } = useMembership()

  if (!canManage) {
    return (
      <p className="text-sm text-text-3" role="status">
        AI settings are available to workspace admins only.
      </p>
    )
  }

  return <AiSettingsAdmin />
}

function AiSettingsAdmin() {
  const [data, setData] = useState<AiStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    try {
      setData(await fetchAiConfig())
      setError(undefined)
    } catch {
      setError('Could not load AI settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <section aria-labelledby="ai-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 id="ai-heading" className="font-heading text-2xl font-semibold tracking-tight">
          AI
        </h1>
        <p className="text-sm text-text-3">
          Bring your own key. Choose a provider, enter its API key, pick a model, and toggle AI on.
          Keys are encrypted at rest, used only on the server, and never leave your instance. AI is
          off until you enable it here.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-text-3" role="status">
          Loading AI settings…
        </p>
      ) : data ? (
        <AiCard data={data} onChanged={reload} />
      ) : error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function AiCard({ data, onChanged }: { data: AiStatusResponse; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const status = data.status
  const enabled = status?.enabled ?? false

  const toggle = async () => {
    setBusy(true)
    setActionError(undefined)
    try {
      await updateAiConfig({ enabled: !enabled })
      await onChanged()
    } catch {
      setActionError('Could not update AI.')
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
        <span className="flex size-8 items-center justify-center rounded-control bg-bg-hover">
          <KeyIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-text-1">AI features</span>
          <span className="text-xs text-text-3">{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <Button
          size="sm"
          variant={enabled ? 'outline' : 'default'}
          onClick={toggle}
          disabled={busy}
          data-testid="ai-toggle"
        >
          {enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>

      {data.canStoreKeys ? null : <EncryptionNotice missingEnv={data.missingEnv} />}

      <div className="flex flex-col gap-3">
        {AI_PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            data={data}
            onChanged={onChanged}
            setError={setActionError}
          />
        ))}
      </div>

      {status ? (
        <WorkspaceDefaults status={status} onChanged={onChanged} setError={setActionError} />
      ) : null}
    </div>
  )
}

function EncryptionNotice({ missingEnv }: { missingEnv: string[] }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-control bg-bg-hover/60 p-3"
      data-testid="encryption-notice"
    >
      <p className="text-sm text-text-2">
        Set an encryption key to store provider keys through this UI. An operator sets this
        environment variable, then restarts yapm:
      </p>
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
    </div>
  )
}

function ProviderRow({
  provider,
  data,
  onChanged,
  setError,
}: {
  provider: AiProvider
  data: AiStatusResponse
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  const keyId = useId()
  const modelId = useId()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const status = data.status
  const hasKey = status?.configuredProviders.includes(provider) ?? false
  const fromEnv = data.envProviders.includes(provider)
  const [model, setModel] = useState(status?.models[provider] ?? '')

  const saveKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || key.trim().length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      await setAiProviderKey(provider, key.trim())
      setKey('')
      setDone(true)
      window.setTimeout(() => setDone(false), 1500)
      await onChanged()
    } catch {
      setError('Could not save the key.')
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await removeAiProviderKey(provider)
      await onChanged()
    } catch {
      setError('Could not remove the key.')
    } finally {
      setBusy(false)
    }
  }

  const saveModel = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await updateAiConfig({ models: { [provider]: model.trim() } })
      await onChanged()
    } catch {
      setError('Could not save the model.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-1">{PROVIDER_LABELS[provider]}</span>
        {hasKey ? (
          <span className="rounded-control bg-status-done/15 px-1.5 py-0.5 text-[11px] text-text-1">
            Key stored
          </span>
        ) : fromEnv ? (
          <span className="rounded-control bg-bg-hover px-1.5 py-0.5 text-[11px] text-text-3">
            Env default
          </span>
        ) : (
          <span className="text-[11px] text-text-3">No key</span>
        )}
        {hasKey ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={`Remove ${PROVIDER_LABELS[provider]} key`}
            disabled={busy}
            onClick={removeKey}
          >
            <TrashIcon />
          </Button>
        ) : null}
      </div>

      {data.canStoreKeys ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={saveKey}>
          <div className="flex flex-col gap-1">
            <Label htmlFor={keyId} className="text-[11px] text-text-3">
              API key
            </Label>
            <Input
              id={keyId}
              type="password"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
              placeholder={hasKey ? 'Replace stored key…' : 'Paste API key…'}
              className="h-7 w-56 text-sm"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={busy || key.trim().length === 0}
            data-testid={`save-key-${provider}`}
          >
            {done ? <CheckIcon /> : <KeyIcon />}
            Save key
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={modelId} className="text-[11px] text-text-3">
            Model
          </Label>
          <Input
            id={modelId}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="e.g. a current model id"
            className="h-7 w-56 text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || model.trim().length === 0}
          onClick={saveModel}
          data-testid={`save-model-${provider}`}
        >
          Save model
        </Button>
      </div>
    </div>
  )
}

function WorkspaceDefaults({
  status,
  onChanged,
  setError,
}: {
  status: NonNullable<AiStatusResponse['status']>
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  const defaultId = useId()
  const capId = useId()
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState(status.spendCapUsd == null ? '' : String(status.spendCapUsd))

  const saveDefault = async (value: string) => {
    setBusy(true)
    setError(undefined)
    try {
      await updateAiConfig({ defaultProvider: value === '' ? null : (value as AiProvider) })
      await onChanged()
    } catch {
      setError('Could not save the default provider.')
    } finally {
      setBusy(false)
    }
  }

  const saveCap = async () => {
    const trimmed = cap.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError('Spend cap must be a positive number.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await updateAiConfig({ spendCapUsd: parsed })
      await onChanged()
    } catch {
      setError('Could not save the spend cap.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={defaultId} className="text-[11px] text-text-3">
          Default provider
        </Label>
        <Select
          id={defaultId}
          value={status.defaultProvider ?? ''}
          disabled={busy}
          onChange={(event) => saveDefault(event.target.value)}
          className="h-7 w-56"
        >
          <option value="">None</option>
          {AI_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={capId} className="text-[11px] text-text-3">
          Spend cap (USD, estimated)
        </Label>
        <div className="flex items-end gap-2">
          <Input
            id={capId}
            value={cap}
            inputMode="decimal"
            onChange={(event) => setCap(event.target.value)}
            placeholder="No cap"
            className="h-7 w-32 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={saveCap}
            data-testid="save-cap"
          >
            Save
          </Button>
        </div>
        <p className="text-[11px] text-text-3" data-testid="spend-so-far">
          Spent ~${status.spendSoFarUsd.toFixed(2)} estimated
          {status.spendCapUsd != null ? ` of $${status.spendCapUsd}` : ''}
        </p>
      </div>
    </div>
  )
}
