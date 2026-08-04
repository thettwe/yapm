import { useQuery, useZero } from '@rocicorp/zero/react'
import {
  AI_PROVIDERS,
  type AiProvider,
  type AreaRule,
  mutators,
  queries,
  RESERVED_AREA_MESSAGE,
  UNMAPPED_AREA,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { runMutation } from '@/lib/mutation'
import {
  type AiStatusResponse,
  fetchAiConfig,
  fetchAiVerdictLog,
  type RetroVerdictLog,
  removeAiProviderKey,
  setAiProviderKey,
  updateAiConfig,
} from '@/settings/ai'
import { PmDisclosureSection } from '@/settings/pm-disclosure'

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

      {data?.status ? (
        <PmDisclosureSection policy={data.status.pmDisclosure} onChanged={reload} />
      ) : null}

      <RetroDraftSection />

      <VerdictLogSection />
    </section>
  )
}

// What teams did with what the model drafted. The ONLY feedback signal the AI layer has about its own
// output quality — and deliberately a signal about the OUTPUT, not about the team, which is why it
// carries no target, no threshold and no trend line that would invite it to be managed.
//
// It is a read: no regenerate, no per-team quality knob, no prompt editor. And it is team-level by
// construction rather than by omission — the server read never queries the reaction table, so there
// is no user column for this component to decline to render.
function VerdictLogSection() {
  const headingId = useId()
  const [log, setLog] = useState<RetroVerdictLog | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    fetchAiVerdictLog()
      .then((next) => {
        if (live) setLog(next)
      })
      .catch(() => {
        if (live) setError('Could not load the retro AI verdict log.')
      })
    return () => {
      live = false
    }
  }, [])

  // Read through a fallback rather than off the response directly: this section sits below the two
  // that matter and an instance whose response shape surprises it must not take the AI settings page
  // down with it.
  const totals = log?.totals ?? []
  const recent = log?.recent ?? []
  const empty = log !== null && totals.length === 0

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      data-testid="ai-verdict-log"
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-heading text-base font-semibold text-text-1">
          What teams decided about the AI draft
        </h2>
        <p className="text-sm text-text-2">
          A signal about the model's output, not about the team. When a team finishes voting on a
          retro's AI draft, yapm records how many members agreed and disagreed with each proposal
          and stamps a verdict. Consistent rejections mean the drafts are not worth the team's
          attention — change the model, or turn the feature off. No individual's reaction is
          recorded here, or readable by anyone; and none of this is ever sent back to the model.
        </p>
      </header>

      {error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      {empty ? (
        <p className="text-[12.5px] text-text-2" data-testid="ai-verdict-log-empty">
          Nothing yet. A verdict is stamped when a team advances a retro out of voting.
        </p>
      ) : null}

      {totals.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="ai-verdict-totals">
          {totals.map((team) => (
            <li
              key={team.teamId}
              className="flex flex-wrap items-center gap-3 rounded-control border border-border p-3"
              data-team-key={team.teamKey}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">
                {team.teamName}
              </span>
              <span className="text-xs text-text-2">
                {team.agreed} agreed · {team.contested} contested · {team.rejected} rejected ·{' '}
                {team.unrated} nobody responded · {team.undecided} not yet decided
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {recent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-1">Most recently thrown out</h3>
          <ul className="flex flex-col gap-2" data-testid="ai-verdict-recent">
            {recent.map((proposal) => (
              <li
                key={proposal.id}
                className="flex flex-col gap-1 rounded-control border border-border p-3"
                data-verdict={proposal.verdict}
              >
                <span className="text-[13px] leading-relaxed text-text-1">{proposal.summary}</span>
                <span className="text-xs text-text-2">
                  {proposal.teamName}
                  {proposal.cycleName === null ? '' : ` · ${proposal.cycleName}`} ·{' '}
                  {proposal.category} · {proposal.verdict} · {proposal.agreeCount} agreed,{' '}
                  {proposal.disagreeCount} disagreed
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

// Which teams let a model draft into their retrospective. Unlike the card above — REST because the
// provider config is server-only — this is a synced Zero column, so the toggle is an optimistic
// shared-mutator write with no round trip, and it renders whether or not the REST call succeeded.
// Deliberately the same shape as the connectors page's status-automation section: same authority
// gate, same call-site instant, same live-region announcement.
function RetroDraftSection() {
  const [teams] = useQuery(queries.teams.all())
  const headingId = useId()
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      data-testid="retro-ai-draft-settings"
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-heading text-base font-semibold text-text-1">
          Retro AI draft
        </h2>
        <p className="text-sm text-text-2">
          Off for every team until you turn it on here. For a team with this on, advancing a retro
          out of brainstorm asks the model to draft up to three wins, three losses and three
          improvements from that cycle's work graph. It reads no cards, no comments and nobody's
          name; every figure it points at is yapm's own; and nothing it drafts is agreed by the
          team. Turning it on drafts nothing into a retro that has already moved on.
        </p>
      </header>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="retro-ai-draft-announcement"
      >
        {announcement}
      </p>

      {error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      {teams.length === 0 ? (
        <p className="text-[12.5px] text-text-2" data-testid="retro-ai-draft-empty">
          No teams yet. Create a team to choose whether a model drafts into its retrospectives.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {teams.map((team) => (
            <RetroDraftRow
              key={team.id}
              id={team.id}
              name={team.name}
              teamKey={team.key}
              since={team.aiRetroDraftSince ?? null}
              onAnnounce={setAnnouncement}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function RetroDraftRow({
  id,
  name,
  teamKey,
  since,
  onAnnounce,
  onError,
}: {
  id: string
  name: string
  teamKey: string
  since: number | null
  onAnnounce: (message: string) => void
  onError: (message: string | undefined) => void
}) {
  const zero = useZero()
  const enabled = since !== null

  async function toggle() {
    onError(undefined)
    // Minted here, at the call site: a `Date.now()` inside the mutator body would differ between the
    // optimistic pass and every rebase.
    const now = Date.now()
    const write = zero.mutate(
      mutators.team.setAiRetroDraft({ id, since: enabled ? null : now, updatedAt: now }),
    )
    onAnnounce(`Retro AI draft ${enabled ? 'disabled' : 'enabled'} for ${name}.`)
    const failure = await runMutation(write)
    if (failure !== undefined) {
      onAnnounce('')
      onError(failure)
    }
  }

  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-control border border-border p-3"
      data-testid="retro-ai-draft-row"
      data-team-key={teamKey}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-1">{name}</span>
        <span className="text-xs text-text-2">{enabled ? 'On' : 'Off'}</span>
      </div>
      <Button
        size="sm"
        variant={enabled ? 'outline' : 'default'}
        onClick={toggle}
        aria-label={`${enabled ? 'Disable' : 'Enable'} the retro AI draft for ${name}, currently ${
          enabled ? 'on' : 'off'
        }`}
        data-testid="retro-ai-draft-toggle"
        data-enabled={enabled ? 'true' : 'false'}
      >
        {enabled ? 'Disable' : 'Enable'}
      </Button>
    </li>
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

      {status ? (
        <AreaMapEditor status={status} onChanged={onChanged} setError={setActionError} />
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

// The product-area map. Rule ORDER is semantic — the first matching prefix wins — so reordering is a
// first-class edit and must be fully operable from the keyboard: move up / move down are buttons, not
// a drag gesture.
function AreaMapEditor({
  status,
  onChanged,
  setError,
}: {
  status: NonNullable<AiStatusResponse['status']>
  onChanged: () => Promise<void>
  setError: (message: string | undefined) => void
}) {
  const fieldId = useId()
  const [rules, setRules] = useState<AreaRule[]>(status.areas)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [focusTarget, setFocusTarget] = useState<string | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (focusTarget === undefined) return
    document.getElementById(focusTarget)?.focus()
    setFocusTarget(undefined)
  }, [focusTarget])

  const rowId = (index: number, part: string) => `${fieldId}-${index}-${part}`

  const update = (index: number, patch: Partial<AreaRule>) => {
    setRules((current) =>
      current.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)),
    )
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rules.length) return
    const moving = rules[index]
    setRules((current) => {
      const next = [...current]
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(target, 0, moved)
      return next
    })
    // At either end the button that made the move is the one the move DISABLES, so focusing it is a
    // no-op that leaves focus on an index-keyed node now belonging to a different rule — and the next
    // press silently moves the wrong row back. Focus the opposite arrow, which is always enabled.
    setFocusTarget(
      target === 0
        ? rowId(0, 'down')
        : target === rules.length - 1
          ? rowId(target, 'up')
          : rowId(target, delta < 0 ? 'up' : 'down'),
    )
    setAnnouncement(
      `${moving?.area.trim() || 'Rule'} moved to position ${target + 1} of ${rules.length}.`,
    )
  }

  const remove = (index: number) => {
    setRules((current) => current.filter((_, position) => position !== index))
    setFocusTarget(`${fieldId}-add`)
  }

  const add = () => {
    setRules((current) => [...current, { prefix: '', area: '' }])
    setFocusTarget(rowId(rules.length, 'prefix'))
  }

  const incomplete = rules.some(
    (rule) => rule.prefix.trim().length === 0 || rule.area.trim().length === 0,
  )
  // The same rule the schema enforces, said where the admin is typing rather than only in the docs.
  const usesReservedLabel = rules.some((rule) => rule.area.trim().toLowerCase() === UNMAPPED_AREA)
  const blockedReason = incomplete
    ? 'Every rule needs a path prefix and an area label.'
    : usesReservedLabel
      ? RESERVED_AREA_MESSAGE
      : undefined

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await updateAiConfig({
        areas: rules.map((rule) => ({
          prefix: rule.prefix.trim(),
          area: rule.area.trim(),
          ...(rule.sensitive ? { sensitive: true } : {}),
          ...(rule.internal ? { internal: true } : {}),
        })),
      })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
      await onChanged()
    } catch {
      setError('Could not save the product-area map.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      className="flex flex-col gap-3 border-t border-border pt-4"
      data-testid="area-map-editor"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`${fieldId}-heading`} className="text-sm font-semibold text-text-1">
          Product areas
        </h2>
        <p className="text-xs text-text-3">
          Map repository path prefixes to product-area labels. The digest describes work by these
          labels; the file paths themselves are never sent to the model. Rules are matched in order
          and the first matching prefix wins, so put the most specific prefix first. A path that
          matches no rule becomes the reserved label{' '}
          <span className="font-medium">{UNMAPPED_AREA}</span>. With no rules at all, yapm requests
          no file metadata from GitHub and the digest is exactly what it was before.
        </p>
      </header>

      {rules.length === 0 ? (
        <p className="text-xs text-text-3" data-testid="area-map-empty">
          No areas configured.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules.map((rule, index) => (
            <li
              // Order IS a rule's identity here — a content-derived key would remount the row on
              // every keystroke and lose focus mid-edit.
              key={index}
              className="flex flex-wrap items-end gap-2 rounded-control border border-border p-2"
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={rowId(index, 'prefix')} className="text-[11px] text-text-3">
                  Path prefix
                </Label>
                <Input
                  id={rowId(index, 'prefix')}
                  value={rule.prefix}
                  onChange={(event) => update(index, { prefix: event.target.value })}
                  placeholder="apps/server/src/billing/"
                  className="h-7 w-64 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={rowId(index, 'area')} className="text-[11px] text-text-3">
                  Area label
                </Label>
                <Input
                  id={rowId(index, 'area')}
                  value={rule.area}
                  onChange={(event) => update(index, { area: event.target.value })}
                  placeholder="Billing"
                  className="h-7 w-44 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant={rule.sensitive ? 'default' : 'outline'}
                aria-pressed={rule.sensitive === true}
                onClick={() => update(index, { sensitive: !rule.sensitive })}
                data-testid={`area-sensitive-${index}`}
              >
                Sensitive
              </Button>
              <Button
                size="sm"
                variant={rule.internal ? 'default' : 'outline'}
                aria-pressed={rule.internal === true}
                onClick={() => update(index, { internal: !rule.internal })}
                data-testid={`area-internal-${index}`}
              >
                Internal
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  id={rowId(index, 'up')}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${rule.area || 'rule'} earlier`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  id={rowId(index, 'down')}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${rule.area || 'rule'} later`}
                  disabled={index === rules.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${rule.area || 'rule'}`}
                  onClick={() => remove(index)}
                >
                  <TrashIcon />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          id={`${fieldId}-add`}
          size="sm"
          variant="outline"
          onClick={add}
          data-testid="area-add"
        >
          <PlusIcon />
          Add area
        </Button>
        <Button
          size="sm"
          disabled={busy || blockedReason !== undefined}
          onClick={save}
          data-testid="area-map-save"
        >
          {saved ? <CheckIcon /> : null}
          Save areas
        </Button>
        {blockedReason !== undefined ? (
          <span className="text-[11px] text-text-3" role="status" data-testid="area-map-blocked">
            {blockedReason}
          </span>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite" data-testid="area-map-announcement">
        {announcement}
      </p>
    </section>
  )
}
