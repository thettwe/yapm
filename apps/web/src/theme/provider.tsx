import { useQuery, useZero } from '@rocicorp/zero/react'
import { mutators, newId, queries } from '@yapm/schema'
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
  setTheme: (theme: Preset) => void
  setAccent: (accent: string | null) => void
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

  // Keep the document root and the localStorage bootstrap cache in lockstep with state, so a
  // reload paints the same theme before the bundle runs (no first-paint flash).
  useEffect(() => {
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
    (next: ThemeState) => {
      if (!rowIdRef.current) rowIdRef.current = newId()
      const id = rowIdRef.current
      void runMutation(
        zero.mutate(
          mutators.preference.set({
            id,
            theme: next.theme,
            accent: next.accent,
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

  const setMode = useCallback((mode: Mode) => {
    setState((prev) => (prev.mode === mode ? prev : { ...prev, mode }))
  }, [])

  const toggleMode = useCallback(() => {
    setState((prev) => ({ ...prev, mode: prev.mode === 'dark' ? 'light' : 'dark' }))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: state.theme,
      mode: state.mode,
      accent: state.accent,
      setTheme,
      setAccent,
      setMode,
      toggleMode,
    }),
    [state, setTheme, setAccent, setMode, toggleMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
