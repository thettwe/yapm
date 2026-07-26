// Email clients strip <style> blocks and do not resolve CSS custom properties, so the app's design
// tokens cannot be referenced here — the values have to be literal and inline. These are the Warm
// light preset's token values copied from `packages/ui/src/styles/globals.css`; they are the only
// place in the repo where a colour is written as a literal rather than read from a token, and the
// medium is why.
export const palette = {
  bg: '#faf7f1',
  surface: '#ffffff',
  border: '#e7e0d4',
  text1: '#2b2620',
  text2: '#6b6357',
  text3: '#9a9186',
  accent: '#bd5837',
  onAccent: '#ffffff',
} as const

export const fonts = {
  ui: '"Figtree", ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const
