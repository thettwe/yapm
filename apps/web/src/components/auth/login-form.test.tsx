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

test('submitting the form signs in with the entered credentials', async () => {
  render(<LoginForm />)

  typeInto(/email/i, 'ada@example.com')
  typeInto(/password/i, 'correct horse')
  fireEvent.submit(screen.getByTestId('login-submit').closest('form') as HTMLFormElement)

  await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledTimes(1))
  expect(mocks.signInEmail).toHaveBeenCalledWith({
    email: 'ada@example.com',
    password: 'correct horse',
    callbackURL: '/',
  })
})

test('SSO requires an email and then starts the provider flow', async () => {
  render(<LoginForm />)

  fireEvent.click(screen.getByTestId('login-sso'))
  expect(await screen.findByRole('alert')).toHaveTextContent(/email/i)
  expect(mocks.signInSso).not.toHaveBeenCalled()

  typeInto(/email/i, 'staff@corp.example')
  fireEvent.click(screen.getByTestId('login-sso'))
  await waitFor(() => expect(mocks.signInSso).toHaveBeenCalledTimes(1))
  expect(mocks.signInSso).toHaveBeenCalledWith({ email: 'staff@corp.example', callbackURL: '/' })
})

test('toggling to sign-up creates an account', async () => {
  render(<LoginForm />)

  fireEvent.click(screen.getByRole('button', { name: /create one/i }))
  typeInto(/email/i, 'grace@example.com')
  typeInto(/password/i, 'new password')
  fireEvent.submit(screen.getByTestId('login-submit').closest('form') as HTMLFormElement)

  await waitFor(() => expect(mocks.signUpEmail).toHaveBeenCalledTimes(1))
})
