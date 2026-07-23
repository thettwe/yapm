import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { signOut } from '@/auth/client'

export function useSignOut(): { signOut: () => Promise<void>; busy: boolean } {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    setBusy(true)
    try {
      await signOut()
    } finally {
      setBusy(false)
      await navigate({ to: '/login' })
    }
  }, [navigate])

  return { signOut: run, busy }
}
