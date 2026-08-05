import { Badge } from '@yapm/ui/components/badge'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { CheckIcon, CopyIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  deleteSsoProvider,
  fetchSsoConfig,
  type RedactedSsoProvider,
  registerSsoProvider,
  requestSsoDomainVerification,
  SsoRequestError,
  type SsoStatusResponse,
  ssoDomains,
  ssoRecordName,
  updateSsoProvider,
  verifySsoDomain,
} from '@/settings/sso'

const DOCS_URL = 'https://docs.yapm.dev/self-hosting/sso/'

// The workspace's SSO configuration. Registering an identity provider is admin-only — it binds an
// email domain to an authorization endpoint every holder of that domain's addresses is then sent to,
// which is authority no signed-in account should have by default. Non-admins get the same ABSENCE
// the AI and connectors pages give, never an error banner: a capability you may not configure is not
// a capability that failed.
export function SsoSettingsView() {
  const { canManage } = useMembership()

  if (!canManage) return <AdminOnly />

  return <SsoSettingsAdmin />
}

function AdminOnly() {
  return (
    <p className="text-sm text-text-3" role="status" data-testid="sso-admin-only">
      Single sign-on settings are available to workspace admins only.
    </p>
  )
}

function SsoSettingsAdmin() {
  const [data, setData] = useState<SsoStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')
  // Verification tokens the server handed back this session, keyed by provider. A token is never
  // stored on the provider row the list reads — it is minted on request and read back only here.
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [redirectUri, setRedirectUri] = useState<string | undefined>(undefined)
  // Removing a provider unmounts the button that was focused. Without somewhere to hand focus to,
  // it falls to `<body>` and the next Tab restarts at the top of the document — so the heading is a
  // stable anchor that outlives every row, exactly as `pm-digest-card.tsx` does for publish/retract.
  const headingRef = useRef<HTMLHeadingElement>(null)

  const reload = useCallback(async () => {
    try {
      setData(await fetchSsoConfig())
      setForbidden(false)
      setError(undefined)
    } catch (cause) {
      // The server decides authority, and it decides it before it looks anything up. A 403 here means
      // the same thing `canManage` means, so it renders the same absence.
      if (cause instanceof SsoRequestError && cause.status === 403) setForbidden(true)
      else setError('Could not load single sign-on settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const providers = data?.providers ?? []

  return (
    <section aria-labelledby="sso-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1
          id="sso-heading"
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold tracking-tight outline-none"
        >
          Single sign-on
        </h1>
        <p className="text-sm text-text-3">
          Register an OpenID Connect identity provider so your team signs in with your own IdP. It
          is free and unlimited on every instance — there is no seat count and no SSO tier. Only a
          workspace admin can register or change a provider, and a provider signs nobody in until
          you have proved you own its email domain with a DNS record.
        </p>
      </header>

      <p className="sr-only" role="status" aria-live="polite" data-testid="sso-announcement">
        {announcement}
      </p>

      {error !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      {forbidden ? (
        <AdminOnly />
      ) : loading ? (
        <p className="text-sm text-text-3" role="status">
          Loading single sign-on settings…
        </p>
      ) : data ? (
        <>
          {redirectUri !== undefined ? (
            <div
              className="flex flex-col gap-2 rounded-card border border-border p-4"
              data-testid="sso-redirect-uri"
            >
              <p className="text-sm text-text-2">
                Provider registered. Add this redirect URI to the application you created in your
                IdP, or sign-in will be refused there:
              </p>
              <CopyableValue
                label="Redirect URI"
                value={redirectUri}
                onCopied={setAnnouncement}
                onError={setError}
              />
            </div>
          ) : null}

          {providers.length === 0 ? (
            <p className="text-sm text-text-3" data-testid="sso-no-providers">
              No identity provider registered. Sign-in over SSO is off and the login form shows no
              SSO button until a provider's domain is verified.
            </p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="sso-providers">
              {providers.map((provider) => (
                <SsoProviderRow
                  key={provider.providerId}
                  provider={provider}
                  focusAnchor={headingRef}
                  token={tokens[provider.providerId]}
                  onToken={(providerId, token) =>
                    setTokens((current) => ({ ...current, [providerId]: token }))
                  }
                  onChanged={reload}
                  onAnnounce={setAnnouncement}
                  onError={setError}
                />
              ))}
            </ul>
          )}

          <RegisterProviderForm
            onRegistered={async (result) => {
              setTokens((current) =>
                result.domainVerificationToken === null
                  ? current
                  : { ...current, [result.providerId]: result.domainVerificationToken },
              )
              setRedirectUri(result.redirectURI)
              setAnnouncement(`Identity provider ${result.providerId} registered.`)
              await reload()
            }}
            onError={setError}
          />
        </>
      ) : null}
    </section>
  )
}

function SsoProviderRow({
  provider,
  focusAnchor,
  token,
  onToken,
  onChanged,
  onAnnounce,
  onError,
}: {
  provider: RedactedSsoProvider
  focusAnchor: RefObject<HTMLElement | null>
  token: string | undefined
  onToken: (providerId: string, token: string) => void
  onChanged: () => Promise<void>
  onAnnounce: (message: string) => void
  onError: (message: string | undefined) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [verificationError, setVerificationError] = useState<string | undefined>(undefined)
  const rowRef = useRef<HTMLLIElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(confirming)

  // Remove and its confirm/cancel pair REPLACE each other, so activating either unmounts the
  // control that was focused and focus falls to `<body>`. Focus follows the swap in both
  // directions, and only on a swap: the guard compares the PREVIOUS value rather than asking
  // whether this effect has ever run, because StrictMode invokes a layout effect twice on mount and
  // a one-shot flag is already spent by the second pass — which would then steal focus onto a row
  // nobody asked for, on every dev and e2e render.
  useLayoutEffect(() => {
    if (wasConfirming.current !== confirming) {
      if (confirming) confirmRef.current?.focus()
      else removeRef.current?.focus()
    }
    wasConfirming.current = confirming
  }, [confirming])

  // A successful removal unmounts the whole row. React runs this cleanup before the subtree's DOM
  // nodes go, which is the only moment the focused control both still exists and is known to be
  // leaving — so the handoff to the page heading happens here rather than in `remove`.
  useLayoutEffect(() => {
    const row = rowRef.current
    return () => {
      if (row?.contains(document.activeElement)) focusAnchor.current?.focus()
    }
  }, [focusAnchor])

  // Verifying the domain succeeds by REMOVING the section the admin was standing in — the happy
  // path of this feature unmounts the button that holds focus. Remove outlives the section and
  // keeps the admin in this provider's row; the page heading catches the case where the confirm has
  // replaced it. Stable identity, so the section's cleanup fires on unmount and never mid-life.
  const handoffOutOfVerification = useCallback(() => {
    if (removeRef.current !== null) removeRef.current.focus()
    else focusAnchor.current?.focus()
  }, [focusAnchor])

  // None of the three async controls below DISABLES itself while it runs, and that is deliberate:
  // disabling the element that currently holds focus blurs it to `<body>` in a real browser, which
  // both strands a keyboard admin mid-page and — for the removal — empties `document.activeElement`
  // out of the row before the unmount handoff can read it. `pm-digest-card.tsx` reaches the same
  // conclusion for the same reason. Re-entry is refused in the handler instead: React flushes the
  // `setBusy` from a discrete event before the next one is dispatched, so the second activation
  // sees `busy`.
  const showRecord = async () => {
    if (busy) return
    setBusy(true)
    setVerificationError(undefined)
    try {
      const result = await requestSsoDomainVerification(provider.providerId)
      onToken(provider.providerId, result.domainVerificationToken)
      onAnnounce(`DNS record value ready for ${provider.providerId}.`)
    } catch (cause) {
      setVerificationError(
        cause instanceof SsoRequestError && cause.status === 409
          ? 'That domain is already verified.'
          : 'Could not get a DNS record value. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (busy) return
    setBusy(true)
    setVerificationError(undefined)
    try {
      await verifySsoDomain(provider.providerId)
      onAnnounce(`Domain verified for ${provider.providerId}. SSO sign-in is now available.`)
      await onChanged()
    } catch (cause) {
      const status = cause instanceof SsoRequestError ? cause.status : 500
      setVerificationError(
        status === 502
          ? 'The DNS TXT record was not found. Publishing DNS can take a while — try again in a few minutes.'
          : status === 404
            ? 'No pending verification. Show the DNS record value again, then verify.'
            : status === 409
              ? 'That domain is already verified.'
              : 'Could not verify the domain. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const cancelOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setConfirming(false)
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    onError(undefined)
    try {
      await deleteSsoProvider(provider.providerId)
      onAnnounce(`Identity provider ${provider.providerId} removed.`)
      await onChanged()
    } catch {
      onError('Could not remove the provider.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <li
      ref={rowRef}
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      data-testid="sso-provider"
      data-provider-id={provider.providerId}
      data-verified={provider.domainVerified ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-control bg-bg-hover">
          <ShieldCheckIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-text-1">{provider.providerId}</span>
          <span className="truncate text-xs text-text-3">{provider.issuer}</span>
        </div>
        {/* Verified state is carried by WORDS inside a neutral badge — no new colour pair, and
            nothing that depends on a reader distinguishing two hues. */}
        <Badge variant="outline" data-testid="sso-verified-badge">
          {provider.domainVerified ? 'Domain verified' : 'Domain not verified'}
        </Badge>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-text-2">Remove this provider?</span>
            {/* Escape cancels, the way every other dismissible surface in the app does. The confirm
                is inline rather than a dialog, so the key is bound on the two controls that can
                hold focus while it is open. */}
            <Button
              ref={confirmRef}
              size="sm"
              onClick={remove}
              onKeyDown={cancelOnEscape}
              data-testid="sso-remove-confirm"
            >
              Remove
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(false)}
              onKeyDown={cancelOnEscape}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            ref={removeRef}
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
            data-testid="sso-remove"
          >
            Remove
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-text-3">Email domain</dt>
        <dd className="font-mono text-text-2">{provider.domain}</dd>
        {provider.discoveryEndpoint !== null ? (
          <>
            <dt className="text-text-3">Discovery</dt>
            <dd className="truncate font-mono text-text-2">{provider.discoveryEndpoint}</dd>
          </>
        ) : null}
        <dt className="text-text-3">Client ID</dt>
        <dd className="font-mono text-text-2" data-testid="sso-client-id">
          {provider.clientIdLastFour === null
            ? 'Not recorded'
            : `ends ${provider.clientIdLastFour}`}
        </dd>
      </dl>

      <SecretRotation
        providerId={provider.providerId}
        onChanged={onChanged}
        onAnnounce={onAnnounce}
      />

      {provider.domainVerified ? null : (
        <DomainVerification
          provider={provider}
          token={token}
          error={verificationError}
          onShowRecord={showRecord}
          onVerify={verify}
          onAnnounce={onAnnounce}
          onError={onError}
          onLeaving={handoffOutOfVerification}
        />
      )}
    </li>
  )
}

// Rotation, never reveal. The stored secret is not returned by any response, so this field starts
// empty on every render and the only thing it can do is REPLACE — which is what the page promises an
// admin, and what makes an IdP credential leak recoverable without a database client.
function SecretRotation({
  providerId,
  onChanged,
  onAnnounce,
}: {
  providerId: string
  onChanged: () => Promise<void>
  onAnnounce: (message: string) => void
}) {
  const fieldId = useId()
  const fieldRef = useRef<HTMLInputElement>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const value = secret.trim()

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || value.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      await updateSsoProvider(providerId, { oidcConfig: { clientSecret: value } })
      setSecret('')
      // Emptying the field is what disables the submit button, and disabling the element that holds
      // focus blurs it to `<body>`. So focus goes back to the field it came from, before the commit
      // that disables the button — an admin who rotated one secret is one Tab from the next control
      // rather than back at the top of the document.
      fieldRef.current?.focus()
      onAnnounce(`Client secret replaced for ${providerId}.`)
      await onChanged()
    } catch {
      setError('Could not replace the client secret. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={save}
      data-testid="sso-rotate-secret-form"
    >
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <Label htmlFor={fieldId} className="text-[11px] text-text-3">
          {`New client secret for ${providerId}`}
        </Label>
        <Input
          id={fieldId}
          ref={fieldRef}
          type="password"
          value={secret}
          autoComplete="off"
          placeholder="Rotate the secret…"
          aria-describedby={`${fieldId}-hint`}
          onChange={(event) => setSecret(event.target.value)}
          className="h-8 text-sm"
        />
        <span id={`${fieldId}-hint`} className="text-[11px] text-text-3">
          Paste the new secret from your IdP. yapm never reads the old one back.
        </span>
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={value.length === 0}
        data-testid="sso-rotate-secret"
      >
        Replace secret
      </Button>
      {error === undefined ? null : (
        <p className="text-[12.5px] text-status-urgent" role="alert" data-testid="sso-rotate-error">
          {error}
        </p>
      )}
    </form>
  )
}

function DomainVerification({
  provider,
  token,
  error,
  onShowRecord,
  onVerify,
  onAnnounce,
  onError,
  onLeaving,
}: {
  provider: RedactedSsoProvider
  token: string | undefined
  error: string | undefined
  onShowRecord: () => Promise<void>
  onVerify: () => Promise<void>
  onAnnounce: (message: string) => void
  onError: (message: string | undefined) => void
  onLeaving: () => void
}) {
  const headingId = useId()
  const domains = ssoDomains(provider.domain)
  const sectionRef = useRef<HTMLElement>(null)
  const recordValueRef = useRef<HTMLButtonElement>(null)
  const hadToken = useRef(token !== undefined)

  // Showing the record value REPLACES the button that asked for it, so focus follows into the copy
  // control that took its place — the next thing an admin does with a value they just revealed. The
  // guard compares the previous value rather than asking whether this effect has run, because
  // StrictMode invokes it twice on mount and a row that arrives with its token already in hand must
  // not steal focus from wherever the admin actually is.
  useLayoutEffect(() => {
    const has = token !== undefined
    if (has && !hadToken.current) recordValueRef.current?.focus()
    hadToken.current = has
  }, [token])

  // Verification succeeding unmounts this whole section. Same moment, same reason as the row's own
  // handoff: this cleanup is the last point at which the focused control still exists and is known
  // to be leaving.
  useLayoutEffect(() => {
    const section = sectionRef.current
    return () => {
      if (section?.contains(document.activeElement)) onLeaving()
    }
  }, [onLeaving])

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-control bg-bg-hover/60 p-3"
      data-testid="sso-verification"
    >
      <h2 id={headingId} className="text-sm font-semibold text-text-1">
        Prove you own this domain
      </h2>
      <p className="text-[12.5px] text-text-2">
        Publish the DNS TXT record below on{' '}
        {domains.length === 1 ? 'this domain' : 'every domain listed'}, then verify. Until you do,
        this provider signs nobody in and the login form shows no SSO button — an unproven domain is
        exactly how someone else's employees would be sent to the wrong identity provider.
      </p>

      {domains.map((domain) => (
        <CopyableValue
          key={domain}
          label={`TXT record name for ${domain}`}
          value={ssoRecordName(provider.providerId, domain)}
          onCopied={onAnnounce}
          onError={onError}
        />
      ))}

      {token === undefined ? (
        <Button size="sm" variant="outline" onClick={onShowRecord} data-testid="sso-show-record">
          Show record value
        </Button>
      ) : (
        <CopyableValue
          label="TXT record value"
          value={token}
          copyRef={recordValueRef}
          onCopied={onAnnounce}
          onError={onError}
        />
      )}

      {error !== undefined ? (
        <p className="text-[12.5px] text-status-urgent" role="alert" data-testid="sso-verify-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onVerify} data-testid="sso-verify">
          Verify domain
        </Button>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 rounded-control text-[12.5px] text-accent-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
        >
          How domain verification works
        </a>
      </div>
    </section>
  )
}

// A real button, not a click handler on the text: copying is an action and must be reachable by tab
// and activated by Enter or Space like every other control on the page.
function CopyableValue({
  label,
  value,
  copyRef,
  onCopied,
  onError,
}: {
  label: string
  value: string
  copyRef?: RefObject<HTMLButtonElement | null>
  onCopied: (message: string) => void
  onError: (message: string | undefined) => void
}) {
  const valueId = useId()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
      onCopied(`${label} copied.`)
    } catch {
      // A browser that refuses clipboard access leaves the value on screen, selectable by hand.
      onError('Could not copy to the clipboard. Select the value and copy it by hand.')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-text-3">{label}</span>
      <code
        id={valueId}
        className="min-w-0 flex-1 truncate rounded-control bg-bg px-2 py-0.5 font-mono text-[11.5px] text-text-2"
      >
        {value}
      </code>
      <Button
        ref={copyRef}
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        aria-describedby={valueId}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

interface RegistrationResult {
  providerId: string
  redirectURI: string
  domainVerificationToken: string | null
}

function RegisterProviderForm({
  onRegistered,
  onError,
}: {
  onRegistered: (result: RegistrationResult) => Promise<void>
  onError: (message: string | undefined) => void
}) {
  const headingId = useId()
  const providerFieldId = useId()
  const issuerId = useId()
  const discoveryId = useId()
  const clientIdField = useId()
  const clientSecretId = useId()
  const domainId = useId()

  const [providerId, setProviderId] = useState('')
  const [issuer, setIssuer] = useState('')
  const [discoveryEndpoint, setDiscoveryEndpoint] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)

  const complete =
    providerId.trim().length > 0 &&
    issuer.trim().length > 0 &&
    clientId.trim().length > 0 &&
    clientSecret.trim().length > 0 &&
    domain.trim().length > 0

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !complete) return
    setBusy(true)
    setFormError(undefined)
    onError(undefined)
    try {
      const result = await registerSsoProvider({
        providerId: providerId.trim(),
        issuer: issuer.trim(),
        domain: domain.trim(),
        oidcConfig: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          ...(discoveryEndpoint.trim() === ''
            ? {}
            : { discoveryEndpoint: discoveryEndpoint.trim() }),
        },
      })
      // Cleared on success, secret first: it was write-only on the way in and nothing reads it back,
      // so leaving it in a field would be the only place it still existed in the browser.
      setClientSecret('')
      setClientId('')
      setProviderId('')
      setIssuer('')
      setDiscoveryEndpoint('')
      setDomain('')
      await onRegistered(result)
    } catch (cause) {
      const failure = cause instanceof SsoRequestError ? cause : undefined
      // The code, not the status, decides between the two 409s: an id already taken and the
      // per-account provider cap have different remedies and must not share a message.
      setFormError(
        failure?.code === 'provider_limit_reached'
          ? 'This account has registered as many identity providers as it may. Remove one you no longer use, or ask another workspace admin to register this one.'
          : failure?.status === 409
            ? 'A provider with that id already exists. Choose another id, or remove the existing one.'
            : failure?.status === 403
              ? 'Only a workspace admin can register an identity provider.'
              : failure?.status === 502
                ? 'yapm could not reach that issuer to read its OpenID Connect discovery document. Check the issuer URL is correct and reachable from this server, then try again.'
                : failure?.status === 400
                  ? 'yapm could not register that provider. The id must be lowercase letters, digits and hyphens; the issuer and discovery URL must be absolute https URLs reachable from this server.'
                  : 'Could not register the provider. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      onSubmit={submit}
      data-testid="sso-register-form"
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-heading text-base font-semibold text-text-1">
          Register an identity provider
        </h2>
        <p className="text-sm text-text-2">
          yapm reads the provider's OpenID Connect discovery document to find its endpoints, so the
          issuer URL is usually all it needs. The client secret is stored on your instance and never
          returned to this page — rotating it later means pasting the new one into{' '}
          <strong className="font-semibold">New client secret</strong> on the provider above.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Field
          id={providerFieldId}
          label="Provider id"
          value={providerId}
          onChange={setProviderId}
          placeholder="acme-okta"
          hint="Lowercase letters, digits and hyphens. It appears in the DNS record and the redirect URI."
        />
        <Field
          id={domainId}
          label="Email domain"
          value={domain}
          onChange={setDomain}
          placeholder="acme.com"
          hint="Whose sign-ins go to this provider. Separate several domains with commas."
        />
        <Field
          id={issuerId}
          label="Issuer URL"
          value={issuer}
          onChange={setIssuer}
          placeholder="https://acme.okta.com"
          type="url"
        />
        <Field
          id={discoveryId}
          label="Discovery URL (optional)"
          value={discoveryEndpoint}
          onChange={setDiscoveryEndpoint}
          placeholder="https://acme.okta.com/.well-known/openid-configuration"
          type="url"
        />
        <Field
          id={clientIdField}
          label="Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="0oa1b2c3d4"
        />
        <Field
          id={clientSecretId}
          label="Client secret"
          value={clientSecret}
          onChange={setClientSecret}
          type="password"
          placeholder="Paste the secret…"
          hint="Write-only. Entered here, stored on your server, never shown again."
        />
      </div>

      {formError !== undefined ? (
        <p className="text-sm text-status-urgent" role="alert" data-testid="sso-register-error">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {/* Disabled only by an incomplete form, never by the request being in flight: registration
            performs OIDC discovery against the admin's issuer, and disabling the element that holds
            focus blurs it to `<body>` for as long as that round-trip takes. `submit` refuses
            re-entry itself; the status line beside it is the in-flight signal. */}
        <Button type="submit" size="sm" disabled={!complete} data-testid="sso-register">
          <PlusIcon />
          Register provider
        </Button>
        {busy ? (
          <span className="text-[11px] text-text-3" role="status">
            Contacting the identity provider…
          </span>
        ) : null}
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  type?: string
}) {
  const hintId = `${id}-hint`

  return (
    <div className="flex min-w-56 flex-1 flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] text-text-3">
        {label}
      </Label>
      <Input
        id={id}
        type={type ?? 'text'}
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-sm"
      />
      {hint === undefined ? null : (
        <span id={hintId} className="text-[11px] text-text-3">
          {hint}
        </span>
      )}
    </div>
  )
}
