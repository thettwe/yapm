import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { KeyRoundIcon } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { signIn, signUp } from '@/auth/client'
import { useAuthMethods } from '@/auth/use-auth-methods'

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-4">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

type Mode = 'signin' | 'signup'

const CALLBACK_URL = '/'

interface AuthResult {
  error?: { message?: string } | null
}

function messageFor(result: AuthResult, fallback: string): string | undefined {
  if (!result.error) return undefined
  return result.error.message ?? fallback
}

export function LoginForm() {
  const methods = useAuthMethods()
  const emailId = useId()
  const passwordId = useId()
  const nameId = useId()
  const errorId = useId()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<null | 'email' | 'github' | 'sso'>(null)

  const submitting = busy !== null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(undefined)
    setBusy('email')
    try {
      const result =
        mode === 'signin'
          ? await signIn.email({ email, password, callbackURL: CALLBACK_URL })
          : await signUp.email({
              email,
              password,
              name: name.trim() || email,
              callbackURL: CALLBACK_URL,
            })
      const failure = messageFor(result, 'Could not sign in. Check your credentials and try again.')
      if (failure !== undefined) {
        setError(failure)
        return
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleGithub() {
    if (submitting) return
    setError(undefined)
    setBusy('github')
    try {
      await signIn.social({ provider: 'github', callbackURL: CALLBACK_URL })
    } catch {
      setError('Could not start the GitHub sign-in flow.')
      setBusy(null)
    }
  }

  async function handleSso() {
    if (submitting) return
    if (email.trim() === '') {
      setError('Enter your work email to continue with SSO.')
      return
    }
    setError(undefined)
    setBusy('sso')
    try {
      const result = await signIn.sso({ email: email.trim(), callbackURL: CALLBACK_URL })
      const failure = messageFor(result, 'No SSO provider is configured for that email domain.')
      if (failure !== undefined) {
        setError(failure)
        setBusy(null)
      }
    } catch {
      setError('Could not start the SSO sign-in flow.')
      setBusy(null)
    }
  }

  const hasProviders = methods.github || methods.sso

  return (
    <section
      className="bg-card flex w-full max-w-sm flex-col gap-6 rounded-xl border p-6 shadow-sm"
      aria-labelledby={`${emailId}-heading`}
    >
      <header className="flex flex-col gap-1">
        <h1 id={`${emailId}-heading`} className="font-heading text-xl font-semibold tracking-tight">
          {mode === 'signin' ? 'Sign in to yapm' : 'Create your yapm account'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {mode === 'signin'
            ? 'Use your email and password, or a configured provider.'
            : 'Sign up with email and password to get started.'}
        </p>
      </header>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {mode === 'signup' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>Password</Label>
          <Input
            id={passwordId}
            name="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            value={password}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? errorId : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error !== undefined ? (
          <p id={errorId} className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting} size="lg" data-testid="login-submit">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      {hasProviders ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs">or</span>
            <span className="bg-border h-px flex-1" />
          </div>
          {methods.github ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={handleGithub}
              disabled={submitting}
              data-testid="login-github"
            >
              <GithubMark />
              Continue with GitHub
            </Button>
          ) : null}
          {methods.sso ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={handleSso}
              disabled={submitting}
              data-testid="login-sso"
            >
              <KeyRoundIcon />
              Continue with SSO
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-muted-foreground text-center text-sm">
        {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button
          type="button"
          className="text-foreground font-medium underline-offset-4 hover:underline focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          onClick={() => {
            setMode((current) => (current === 'signin' ? 'signup' : 'signin'))
            setError(undefined)
          }}
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </section>
  )
}
