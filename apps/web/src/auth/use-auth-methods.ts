import { useEffect, useState } from 'react'

export interface AuthMethods {
  emailPassword: boolean
  github: boolean
  sso: boolean
}

// Email/password is always available; a PROVIDER is absent until the instance says it is present.
// Both `github` and `sso` therefore default to false and are read as an explicit `true`: a probe
// that is slow, fails, or answers a shape this build does not understand renders no provider button
// rather than one that leads nowhere. `/api/auth-methods` reports `sso` from the database — at
// least one registered provider whose domain is verified — so a button here means a working flow.
const DEFAULT_METHODS: AuthMethods = { emailPassword: true, github: false, sso: false }

function asMethods(value: unknown): AuthMethods {
  if (typeof value !== 'object' || value === null) return DEFAULT_METHODS
  const record = value as Record<string, unknown>
  return {
    emailPassword: record.emailPassword !== false,
    github: record.github === true,
    sso: record.sso === true,
  }
}

export function useAuthMethods(): AuthMethods {
  const [methods, setMethods] = useState<AuthMethods>(DEFAULT_METHODS)

  useEffect(() => {
    let active = true
    void fetch('/api/auth-methods', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data !== null) setMethods(asMethods(data))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return methods
}
