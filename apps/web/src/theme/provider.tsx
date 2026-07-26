import { useQuery, useZero } from '@rocicorp/zero/react'
import {
  DEFAULT_EMAIL_NOTIFICATION_MODE,
  type EmailNotificationMode,
  mutators,
  newId,
  queries,
} from '@yapm/schema'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { runMutation } from '@/lib/mutation'
import {
  applyThemeToRoot,
  defaultState,
  isPreset,
  type Mode,
  type Preset,
  readCache,
  type ThemeState,
  writeCache,
} from './theme'

interface ThemeContextValue {
  theme: Preset
  mode: Mode
  accent: string | null
  // The one synced per-user preference row carries the email setting too, so it is written
  // through the same `preference.set` mutator rather than a second surface with a second row.
  emailNotifications: EmailNotificationMode
  setTheme: (theme: Preset) => void
  setAccent: (accent: string | null) => void
  setEmailNotifications: (mode: EmailNotificationMode) => void
  setMode: (mode: Mode) => void
  toggleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const zero = useZero()
  const [preference] = useQuery(queries.preferences.mine())
  const [state, setState] = useState<ThemeState>(() => readCache() ?? defaultState())
  const rowIdRef = useRef<string>('')
  const stateRef = useRef<ThemeState>(state)

  // Keep the document root and the localStorage bootstrap cache in lockstep with state, so a
  // reload paints the same theme before the bundle runs (no first-paint flash).
  useEffect(() => {
    stateRef.current = state
    applyThemeToRoot(document.documentElement, state)
    writeCache(state)
  }, [state])

  // The synced preference is source of truth for {theme, accent} (mode stays device-local).
  useEffect(() => {
    if (!preference) return
    rowIdRef.current = preference.id
    setState((prev) => {
      const theme = isPreset(preference.theme) ? preference.theme : prev.theme
      const accent = preference.accent ?? null
      if (prev.theme === theme && prev.accent === accent) return prev
      return { ...prev, theme, accent }
    })
  }, [preference])

  const persist = useCallback(
    (next: ThemeState, emailNotifications?: EmailNotificationMode) => {
      if (!rowIdRef.current) rowIdRef.current = newId()
      const id = rowIdRef.current
      void runMutation(
        zero.mutate(
          mutators.preference.set({
            id,
            theme: next.theme,
            accent: next.accent,
            // Omitted rather than defaulted: the mutator preserves whatever mode the row
            // already carries, so a theme change never resets the email setting.
            ...(emailNotifications === undefined ? {} : { emailNotifications }),
            updatedAt: Date.now(),
          }),
        ),
      )
    },
    [zero],
  )

  const setTheme = useCallback(
    (theme: Preset) => {
      setState((prev) => {
        const next = { ...prev, theme }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const setAccent = useCallback(
    (accent: string | null) => {
      setState((prev) => {
        const next = { ...prev, accent }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const setEmailNotifications = useCallback(
    (mode: EmailNotificationMode) => {
      persist(stateRef.current, mode)
    },
    [persist],
  )

  const setMode = useCallback((mode: Mode) => {
    setState((prev) => (prev.mode === mode ? prev : { ...prev, mode }))
  }, [])

  const toggleMode = useCallback(() => {
    setState((prev) => ({ ...prev, mode: prev.mode === 'dark' ? 'light' : 'dark' }))
  }, [])

  // Read straight off the synced row: `preference.set` applies optimistically, so the control
  // reflects a change in the same frame without a second copy of the value to keep in step.
  const emailNotifications = preference?.emailNotifications ?? DEFAULT_EMAIL_NOTIFICATION_MODE

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: state.theme,
      mode: state.mode,
      accent: state.accent,
      emailNotifications,
      setTheme,
      setAccent,
      setEmailNotifications,
      setMode,
      toggleMode,
    }),
    [state, emailNotifications, setTheme, setAccent, setEmailNotifications, setMode, toggleMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
