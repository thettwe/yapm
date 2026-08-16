import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signInSso: vi.fn(),
  signUpEmail: vi.fn(),
  methods: { emailPassword: true, github: true, sso: true },
}))

vi.mock('@/auth/client', () => ({
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial, sso: mocks.signInSso },
  signUp: { email: mocks.signUpEmail },
}))

vi.mock('@/auth/use-auth-methods', () => ({ useAuthMethods: () => mocks.methods }))

import { LoginForm } from './login-form'

beforeEach(() => {
  mocks.signInEmail.mockReset().mockResolvedValue({})
  mocks.signInSocial.mockReset().mockResolvedValue({})
  mocks.signInSso.mockReset().mockResolvedValue({})
  mocks.signUpEmail.mockReset().mockResolvedValue({})
  mocks.methods = { emailPassword: true, github: true, sso: true }
})

function typeInto(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

test('renders the email/password form with configured providers', () => {
  render(<LoginForm />)

  expect(screen.getByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/email/i)).toHaveAttribute('type', 'email')
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password')
  expect(screen.getByTestId('login-github')).toBeInTheDocument()
  expect(screen.getByTestId('login-sso')).toBeInTheDocument()
})

test('an unconfigured provider is absent, not shown as an upsell', () => {
  mocks.methods = { emailPassword: true, github: false, sso: true }
  render(<LoginForm />)

  expect(screen.queryByTestId('login-github')).not.toBeInTheDocument()
  expect(screen.queryByText(/upgrade|license|seat/i)).not.toBeInTheDocument()
})

// The honesty half of admin-gating SSO. `/api/auth-methods` reports `sso` from the database — a
// registered provider whose domain is verified — so the button exists exactly when the flow behind
// it works. An instance with no provider showed a button that led nowhere; it now shows nothing,
// which is the same absence an unconfigured GitHub gets.
test('with SSO unavailable the button is absent and the provider divider collapses', () => {
  mocks.methods = { emailPassword: true, github: false, sso: false }
  render(<LoginForm />)

  expect(screen.queryByTestId('login-sso')).not.toBeInTheDocument()
  expect(screen.queryByTestId('login-github')).not.toBeInTheDocument()
  expect(screen.queryByText('or')).not.toBeInTheDocument()
  expect(screen.getByTestId('login-submit')).toBeInTheDocument()
})

test('with SSO available the button renders and starts the provider flow', async () => {
  mocks.methods = { emailPassword: true, github: false, sso: true }
  render(<LoginForm />)

  expect(screen.getByText('or')).toBeInTheDocument()
  typeInto(/email/i, 'staff@acme.example')
  fireEvent.click(screen.getByTestId('login-sso'))

  await waitFor(() => expect(mocks.signInSso).toHaveBeenCalledTimes(1))
  expect(mocks.signInSso).toHaveBeenCalledWith({
    email: 'staff@acme.example',
    callbackURL: '/login',
  })
})

// The email paths carry NO callback at all (design §D1). better-auth returns `redirect` as
// `!!ctx.body.callbackURL`, and its default-enabled redirect plugin turns a truthy one into
// `window.location.href = …` — a second answer to where signing in lands, racing the route's.
test('submitting the form signs in with the entered credentials and no callback', async () => {
  render(<LoginForm />)

  typeInto(/email/i, 'ada@example.com')
  typeInto(/password/i, 'correct horse')
  fireEvent.submit(screen.getByTestId('login-submit').closest('form') as HTMLFormElement)

  await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledTimes(1))
  expect(mocks.signInEmail).toHaveBeenCalledWith({
    email: 'ada@example.com',
    password: 'correct horse',
  })
  expect(mocks.signInEmail.mock.calls[0]?.[0]).not.toHaveProperty('callbackURL')
})

test('SSO requires an email and then starts the provider flow', async () => {
  render(<LoginForm />)

  fireEvent.click(screen.getByTestId('login-sso'))
  expect(await screen.findByRole('alert')).toHaveTextContent(/email/i)
  expect(mocks.signInSso).not.toHaveBeenCalled()

  typeInto(/email/i, 'staff@corp.example')
  fireEvent.click(screen.getByTestId('login-sso'))
  await waitFor(() => expect(mocks.signInSso).toHaveBeenCalledTimes(1))
  expect(mocks.signInSso).toHaveBeenCalledWith({
    email: 'staff@corp.example',
    callbackURL: '/login',
  })
})

test('toggling to sign-up creates an account, and carries no callback either', async () => {
  render(<LoginForm />)

  fireEvent.click(screen.getByRole('button', { name: /create one/i }))
  typeInto(/email/i, 'grace@example.com')
  typeInto(/password/i, 'new password')
  fireEvent.submit(screen.getByTestId('login-submit').closest('form') as HTMLFormElement)

  await waitFor(() => expect(mocks.signUpEmail).toHaveBeenCalledTimes(1))
  // The absence is the assertion: a callback here would be the second landing mechanism the
  // requirement forbids, and `/login` — still mounted, holding a fresh session — is the first.
  expect(mocks.signUpEmail.mock.calls[0]?.[0]).not.toHaveProperty('callbackURL')
})

// The provider paths keep a callback because a third-party redirect structurally needs a URL, and
// it points at the ONE place the decision is taken rather than at a destination of its own.
test('the provider paths return the browser to the decision point, not to a destination', async () => {
  render(<LoginForm />)

  fireEvent.click(screen.getByTestId('login-github'))
  await waitFor(() => expect(mocks.signInSocial).toHaveBeenCalledTimes(1))
  expect(mocks.signInSocial).toHaveBeenCalledWith({ provider: 'github', callbackURL: '/login' })
})
