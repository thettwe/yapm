import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RedactedSsoProvider } from '@/settings/sso'

// The admin surface for the one configuration path better-auth would otherwise leave open to any
// signed-in account. What this file holds true: an unverified provider shows the exact DNS record an
// admin has to publish; a caller the server refuses gets the ADMIN-ONLY ABSENCE rather than an error
// banner; and no client secret ever reaches the DOM — it is write-only in both directions.

const CLIENT_SECRET = 'super-secret-do-not-render-me'

const membership = vi.hoisted(() => ({ canManage: true }))
vi.mock('@/auth/use-membership', () => ({ useMembership: () => membership }))

import { SsoSettingsView } from './sso-view'

interface Recorded {
  url: string
  method: string
  body: Record<string, unknown> | undefined
}

const requests: Recorded[] = []

const api = vi.hoisted(() => ({
  status: 200,
  providers: [] as unknown[],
  token: 'tok-abc123',
  verifyStatus: 200,
  registerStatus: 200,
  registerError: undefined as string | undefined,
}))

const UNVERIFIED: RedactedSsoProvider = {
  providerId: 'acme-okta',
  issuer: 'https://acme.okta.example',
  domain: 'acme.example',
  domainVerified: false,
  discoveryEndpoint: 'https://acme.okta.example/.well-known/openid-configuration',
  clientIdLastFour: 'd4e5',
}

const clipboard = vi.hoisted(() => ({ writeText: vi.fn(() => Promise.resolve()) }))

beforeEach(() => {
  requests.length = 0
  membership.canManage = true
  api.status = 200
  api.providers = []
  api.verifyStatus = 200
  api.registerStatus = 200
  api.registerError = undefined
  clipboard.writeText.mockClear()
  vi.stubGlobal('navigator', { clipboard })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({
        url,
        method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      if (api.status !== 200) {
        return Promise.resolve({ ok: false, status: api.status } as Response)
      }
      // A removal really removes, and a verification really verifies: the reload that follows each
      // has to be able to unmount what was on screen — the row, and the verification section — which
      // is what the focus handoffs hang off.
      if (method === 'DELETE') api.providers = []
      if (url.endsWith('/verify') && api.verifyStatus === 200) {
        api.providers = api.providers.map((provider) => ({
          ...(provider as RedactedSsoProvider),
          domainVerified: true,
        }))
      }
      if (url.endsWith('/domain-verification')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({ providerId: 'acme-okta', domainVerificationToken: api.token }),
        } as Response)
      }
      if (url.endsWith('/verify') && api.verifyStatus !== 200) {
        return Promise.resolve({ ok: false, status: api.verifyStatus } as Response)
      }
      if (url.endsWith('/providers') && method === 'POST' && api.registerStatus !== 200) {
        return Promise.resolve({
          ok: false,
          status: api.registerStatus,
          json: () => Promise.resolve({ error: api.registerError }),
        } as Response)
      }
      if (url.endsWith('/providers') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              providerId: 'acme-okta',
              domain: 'acme.example',
              domainVerified: false,
              domainVerificationToken: api.token,
              redirectURI: 'https://yapm.example/api/auth/sso/callback/acme-okta',
              configured: false,
              providers: api.providers,
            }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ configured: api.providers.length > 0, providers: api.providers }),
      } as Response)
    }),
  )
})

test('a non-admin gets absence, not an error, and the page asks the server for nothing', () => {
  membership.canManage = false
  render(<SsoSettingsView />)

  expect(screen.getByTestId('sso-admin-only')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(requests).toHaveLength(0)
})

test('a server that refuses the read renders the same absence as a non-admin', async () => {
  api.status = 403
  render(<SsoSettingsView />)

  expect(await screen.findByTestId('sso-admin-only')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('with no provider the page says SSO is off rather than showing an empty table', async () => {
  render(<SsoSettingsView />)

  expect(await screen.findByTestId('sso-no-providers')).toHaveTextContent(/no sso button/i)
  expect(screen.queryByTestId('sso-providers')).not.toBeInTheDocument()
  expect(screen.getByTestId('sso-register-form')).toBeInTheDocument()
})

test('an unverified provider shows the exact DNS record and a way to verify it', async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  const verification = await screen.findByTestId('sso-verification')
  expect(screen.getByTestId('sso-verified-badge')).toHaveTextContent('Domain not verified')
  // The record NAME is derivable from the provider id and the domain, so it renders before anything
  // is minted; the VALUE is a token the server hands back on request.
  expect(verification).toHaveTextContent('_better-auth-token-acme-okta.acme.example')
  expect(screen.getByTestId('sso-verify')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('sso-show-record'))
  await waitFor(() => expect(verification).toHaveTextContent(api.token))
  expect(requests.at(-1)).toMatchObject({
    url: '/api/v1/sso/providers/acme-okta/domain-verification',
    method: 'POST',
  })

  fireEvent.click(screen.getByRole('button', { name: /copy txt record value/i }))
  await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(api.token))
})

test('a DNS record that has not propagated is announced as such, not as a failure to verify', async () => {
  api.providers = [UNVERIFIED]
  api.verifyStatus = 502
  render(<SsoSettingsView />)

  fireEvent.click(await screen.findByTestId('sso-verify'))

  expect(await screen.findByTestId('sso-verify-error')).toHaveTextContent(/dns txt record/i)
})

test('a verified provider states so in words and offers no DNS record', async () => {
  api.providers = [{ ...UNVERIFIED, domainVerified: true }]
  render(<SsoSettingsView />)

  expect(await screen.findByTestId('sso-verified-badge')).toHaveTextContent('Domain verified')
  expect(screen.queryByTestId('sso-verification')).not.toBeInTheDocument()
  expect(screen.getByTestId('sso-client-id')).toHaveTextContent('ends d4e5')
})

test('the client secret is sent once and never reaches the DOM', async () => {
  render(<SsoSettingsView />)
  await screen.findByTestId('sso-register-form')

  const fill = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fill(/provider id/i, 'acme-okta')
  fill(/email domain/i, 'acme.example')
  fill(/issuer url/i, 'https://acme.okta.example')
  fill(/client id/i, 'client-a1b2c3d4e5')
  fill(/client secret/i, CLIENT_SECRET)

  fireEvent.submit(screen.getByTestId('sso-register').closest('form') as HTMLFormElement)

  await waitFor(() =>
    expect(
      requests.some((request) => request.method === 'POST' && request.body !== undefined),
    ).toBe(true),
  )
  const register = requests.find((request) => request.url === '/api/v1/sso/providers')
  expect(register?.body).toMatchObject({
    providerId: 'acme-okta',
    domain: 'acme.example',
    oidcConfig: { clientId: 'client-a1b2c3d4e5', clientSecret: CLIENT_SECRET },
  })

  // The secret left the field on success and no response shape can carry it back.
  await waitFor(() => expect(screen.getByLabelText(/client secret/i)).toHaveValue(''))
  expect(document.body.innerHTML).not.toContain(CLIENT_SECRET)
  expect(screen.getByTestId('sso-redirect-uri')).toHaveTextContent(
    'https://yapm.example/api/auth/sso/callback/acme-okta',
  )
})

test('removing a provider asks first', async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  fireEvent.click(await screen.findByTestId('sso-remove'))
  expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(0)

  fireEvent.click(screen.getByTestId('sso-remove-confirm'))
  await waitFor(() => expect(requests.some((request) => request.method === 'DELETE')).toBe(true))
})

// The only destructive control on the page, and activating it REPLACES the button that was
// focused. Without a handoff, focus lands on `<body>` and a keyboard-only admin restarts their Tab
// journey at the top of the document — three times over: confirm, cancel, and the removal itself.
test('focus follows the remove confirmation rather than falling to the body', async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  const remove = await screen.findByTestId('sso-remove')
  remove.focus()
  fireEvent.click(remove)
  await waitFor(() => expect(screen.getByTestId('sso-remove-confirm')).toHaveFocus())

  // Escape cancels without a pointer, and focus returns to the control that opened the confirm.
  fireEvent.keyDown(screen.getByTestId('sso-remove-confirm'), { key: 'Escape' })
  await waitFor(() => expect(screen.getByTestId('sso-remove')).toHaveFocus())

  fireEvent.click(screen.getByTestId('sso-remove'))
  fireEvent.click(await screen.findByTestId('sso-remove-confirm'))
  // The row unmounts on success; the page heading is the anchor that outlives it.
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Single sign-on' })).toHaveFocus())
})

// Domain verification is this feature's happy path, and both of its controls end by removing
// themselves: showing the record value replaces the button that asked for it, and verifying removes
// the whole section. Neither may drop a keyboard admin on `<body>`.
test('showing the DNS record value hands focus to the control that replaced the button', async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  const show = await screen.findByTestId('sso-show-record')
  show.focus()
  fireEvent.click(show)

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /copy txt record value/i })).toHaveFocus(),
  )
})

test('verifying the domain hands focus to a control that outlives the section', async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  const verify = await screen.findByTestId('sso-verify')
  verify.focus()
  fireEvent.click(verify)

  await waitFor(() => expect(screen.queryByTestId('sso-verification')).not.toBeInTheDocument())
  expect(screen.getByTestId('sso-remove')).toHaveFocus()
})

test("a record value already in hand steals nobody's focus on a later render", async () => {
  api.providers = [UNVERIFIED]
  render(<SsoSettingsView />)

  fireEvent.click(await screen.findByTestId('sso-show-record'))
  await screen.findByRole('button', { name: /copy txt record value/i })

  // A re-render for an unrelated reason must not re-run the handoff: the guard is the PREVIOUS
  // value, not a one-shot flag that StrictMode's second layout pass would already have spent.
  screen.getByTestId('sso-remove').focus()
  fireEvent.change(screen.getByLabelText(/new client secret for acme-okta/i), {
    target: { value: 'nudge-a-render' },
  })
  await waitFor(() => expect(screen.getByTestId('sso-remove')).toHaveFocus())
})

test('a client secret can be rotated from the provider row, write-only in both directions', async () => {
  api.providers = [{ ...UNVERIFIED, domainVerified: true }]
  render(<SsoSettingsView />)

  const field = await screen.findByLabelText(/new client secret for acme-okta/i)
  expect(field).toHaveValue('')
  fireEvent.change(field, { target: { value: CLIENT_SECRET } })
  fireEvent.submit(screen.getByTestId('sso-rotate-secret-form'))

  await waitFor(() =>
    expect(
      requests.some(
        (request) => request.url === '/api/v1/sso/providers/acme-okta' && request.method === 'POST',
      ),
    ).toBe(true),
  )
  const rotate = requests.find((request) => request.url === '/api/v1/sso/providers/acme-okta')
  expect(rotate?.body).toEqual({ oidcConfig: { clientSecret: CLIENT_SECRET } })

  await waitFor(() => expect(field).toHaveValue(''))
  expect(document.body.innerHTML).not.toContain(CLIENT_SECRET)
})

async function fillRegistration(): Promise<void> {
  await screen.findByTestId('sso-register-form')
  const fill = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fill(/^provider id/i, 'acme-okta')
  fill(/^email domain/i, 'acme.example')
  fill(/^issuer url/i, 'https://acme.okta.example')
  fill(/^client id/i, 'client-a1b2c3d4e5')
  fill(/^client secret/i, CLIENT_SECRET)
}

async function submitRegistration(): Promise<void> {
  await fillRegistration()
  fireEvent.submit(screen.getByTestId('sso-register-form'))
}

// Registering is the one thing this page exists for, and succeeding at it empties the six fields —
// which is what puts `disabled` on the Register button while it still holds focus. The redirect URI
// the registration just produced is what appeared and what an admin has to do next, so that is where
// focus goes; nothing on the happy path may leave it on `<body>`.
test('a successful registration hands focus to the redirect URI it just produced', async () => {
  render(<SsoSettingsView />)
  await fillRegistration()

  const register = screen.getByTestId('sso-register')
  register.focus()
  expect(register).toHaveFocus()
  fireEvent.submit(screen.getByTestId('sso-register-form'))

  const copy = await screen.findByRole('button', { name: /copy redirect uri/i })
  await waitFor(() => expect(copy).toHaveFocus())
  // The clears are what disable it, so the handoff has to have already happened.
  expect(register).toBeDisabled()
})

// Registration answers 409 for two unrelated refusals with unrelated remedies, and 502 for an
// issuer it could not reach — which is not a domain-verification failure and must not be described
// as one. The message is chosen by the server's error CODE where the status is ambiguous.
test.each([
  [409, 'provider_limit_reached', /as many identity providers as it may/i],
  [409, 'provider_exists', /already exists/i],
  [502, 'issuer_unreachable', /could not reach that issuer/i],
])(
  'a %i %s registration failure names what an admin can do about it',
  async (status, code, message) => {
    api.registerStatus = status
    api.registerError = code
    render(<SsoSettingsView />)
    await submitRegistration()

    expect(await screen.findByTestId('sso-register-error')).toHaveTextContent(message)
  },
)
