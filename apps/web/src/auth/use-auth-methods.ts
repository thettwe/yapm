import { useEffect, useState } from 'react'

export interface AuthMethods {
  emailPassword: boolean
  github: boolean
  sso: boolean
}

// Email/password is always available; providers appear only when configured. Optimistic
// default keeps the form usable if the probe is slow or fails.
const DEFAULT_METHODS: AuthMethods = { emailPassword: true, github: false, sso: true }

function asMethods(value: unknown): AuthMethods {
  if (typeof value !== 'object' || value === null) return DEFAULT_METHODS
  const record = value as Record<string, unknown>
  return {
    emailPassword: record.emailPassword !== false,
    github: record.github === true,
    sso: record.sso !== false,
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
