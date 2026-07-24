import { THEME_PRESETS, type ThemePreset } from '@yapm/schema'
import { type AccentShades, deriveAccent, type Mode } from '@yapm/ui/lib/color'

export type { Mode }
export type Preset = ThemePreset

export const STORAGE_KEY = 'yapm:pref'

export interface ThemeState {
  theme: Preset
  mode: Mode
  accent: string | null
}

interface CachedPref extends ThemeState {
  accentStrong?: string
  accentHover?: string
  accentActive?: string
  accentSoft?: string
  accentLine?: string
  onAccent?: string
}

const PRESET_SET = new Set<string>(THEME_PRESETS)

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-hover',
  '--accent-active',
  '--accent-soft',
  '--accent-line',
  '--on-accent',
] as const

export function isPreset(value: unknown): value is Preset {
  return typeof value === 'string' && PRESET_SET.has(value)
}

export function systemMode(): Mode {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function defaultState(): ThemeState {
  return { theme: 'warm', mode: systemMode(), accent: null }
}

export function readCache(): ThemeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedPref>
    if (!isPreset(parsed.theme)) return null
    return {
      theme: parsed.theme,
      mode: parsed.mode === 'dark' ? 'dark' : 'light',
      accent: typeof parsed.accent === 'string' ? parsed.accent : null,
    }
  } catch {
    return null
  }
}

export function applyAccentVars(root: HTMLElement, shades: AccentShades | null): void {
  if (!shades) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name)
    return
  }
  root.style.setProperty('--accent', shades.accent)
  root.style.setProperty('--accent-strong', shades.strong)
  root.style.setProperty('--accent-hover', shades.hover)
  root.style.setProperty('--accent-active', shades.active)
  root.style.setProperty('--accent-soft', shades.soft)
  root.style.setProperty('--accent-line', shades.line)
  root.style.setProperty('--on-accent', shades.onAccent)
}

export function applyThemeToRoot(root: HTMLElement, state: ThemeState): void {
  root.setAttribute('data-theme', state.theme)
  root.classList.toggle('dark', state.mode === 'dark')
  applyAccentVars(root, state.accent ? deriveAccent(state.accent, state.mode) : null)
}

export function writeCache(state: ThemeState): void {
  const shades = state.accent ? deriveAccent(state.accent, state.mode) : null
  const payload: CachedPref = {
    theme: state.theme,
    mode: state.mode,
    accent: state.accent,
    ...(shades
      ? {
          accentStrong: shades.strong,
          accentHover: shades.hover,
          accentActive: shades.active,
          accentSoft: shades.soft,
          accentLine: shades.line,
          onAccent: shades.onAccent,
        }
      : {}),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore quota / disabled-storage failures; theming still works for the session.
  }
}
