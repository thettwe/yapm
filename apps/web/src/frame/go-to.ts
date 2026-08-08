import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { ownsKeyboard } from '@/lib/keyboard'

// The `g`-prefix go-to grammar the deck advertises in `more▾`: `g h` Home, `g i` Issues, `g t`
// Triage, `g c` Cycles, `g d` Delivery, `g r` Retros, `g p` Projects, `g m` Roadmap.
//
// Decisions is folded away, so `g d` is Delivery's, as `ia.html`'s bar order implies. The prefix
// expires so a stray `g` cannot silently arm a jump minutes later, and the whole grammar is
// suppressed while a text input, a contenteditable or an open dialog holds the keyboard — the same
// guard every existing surface shortcut applies.
const PREFIX_WINDOW_MS = 1200

export function useGoTo(teamId: string | null): void {
  const navigate = useNavigate()
  const armedAt = useRef<number | null>(null)

  useEffect(() => {
    if (teamId === null) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (ownsKeyboard(event.target)) return
      if (teamId === null) return

      const key = event.key.toLowerCase()
      const armed = armedAt.current !== null && Date.now() - armedAt.current < PREFIX_WINDOW_MS
      armedAt.current = null

      if (!armed) {
        if (key === 'g') armedAt.current = Date.now()
        return
      }

      switch (key) {
        case 'h':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId', params: { teamId } })
          return
        case 'i':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: {} })
          return
        case 't':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/triage', params: { teamId } })
          return
        case 'c':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/cycles', params: { teamId } })
          return
        case 'd':
          event.preventDefault()
          void navigate({
            to: '/teams/$teamId/delivery',
            params: { teamId },
            search: { window: 6 },
          })
          return
        case 'r':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/retros', params: { teamId } })
          return
        case 'p':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/projects', params: { teamId }, search: {} })
          return
        case 'm':
          event.preventDefault()
          void navigate({ to: '/teams/$teamId/roadmap', params: { teamId } })
          return
        default:
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [teamId, navigate])
}
