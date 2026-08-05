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
