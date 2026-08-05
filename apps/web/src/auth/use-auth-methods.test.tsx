import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { type AuthMethods, useAuthMethods } from './use-auth-methods'

// On main this hook defaulted `sso` to true and read it as `record.sso !== false`, so every
// instance claimed a sign-in method it had no way to configure. A provider is absent until the
// instance says it is present — the same reading `github` already got.

function Probe() {
  const methods: AuthMethods = useAuthMethods()
  return <span data-testid="methods">{JSON.stringify(methods)}</span>
}

function read(): AuthMethods {
  return JSON.parse(screen.getByTestId('methods').textContent ?? '{}') as AuthMethods
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubResponse(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)),
  )
}

test('nothing but email/password is assumed before the instance answers', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
  render(<Probe />)

  expect(read()).toEqual({ emailPassword: true, github: false, sso: false })
})

test('SSO is reported available only when the instance says so explicitly', async () => {
  stubResponse({ emailPassword: true, github: false, sso: true })
  render(<Probe />)

  await waitFor(() => expect(read().sso).toBe(true))
})

test('a response missing the flag, or a failing probe, leaves SSO absent', async () => {
  stubResponse({ emailPassword: true, github: false })
  const { unmount } = render(<Probe />)
  await waitFor(() => expect(read().emailPassword).toBe(true))
  expect(read().sso).toBe(false)
  unmount()

  stubResponse(null, false)
  render(<Probe />)
  await waitFor(() => expect(read().sso).toBe(false))
})
