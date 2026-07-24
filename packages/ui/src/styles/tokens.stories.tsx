const THEMES = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const

type Theme = (typeof THEMES)[number]
type Mode = (typeof MODES)[number]

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-9 w-full rounded-control border border-border ${className}`} />
      <span className="font-mono text-[10px] text-text-3">{label}</span>
    </div>
  )
}

function Panel({ theme, mode }: { theme: Theme; mode: Mode }) {
  return (
    <div data-theme={theme} className={mode === 'dark' ? 'dark' : undefined}>
      <div className="flex flex-col gap-4 rounded-card border border-border bg-bg p-5 font-ui text-text-1">
        <div className="flex items-baseline justify-between">
          <span className="font-heading text-lg font-semibold capitalize">{theme}</span>
          <span className="font-mono text-[11px] text-text-2">{mode}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Swatch className="bg-bg" label="bg" />
          <Swatch className="bg-bg-elevated" label="elevated" />
          <Swatch className="bg-bg-sidebar" label="sidebar" />
          <Swatch className="bg-bg-hover" label="hover" />
          <Swatch className="bg-bg-selected" label="selected" />
          <Swatch className="bg-border-strong" label="border-strong" />
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-text-1">Primary text — the quick brown fox.</p>
          <p className="text-text-2">Secondary text — jumps over the lazy dog.</p>
          <p className="text-text-3">Muted metadata — ENG-142 · 3d ago</p>
          <p className="font-mono text-xs text-text-2">mono · ENG-1042 · ⌘K · 12 issues</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-on-accent">
            Primary action
          </span>
          <span className="rounded-control bg-accent-soft px-3 py-1.5 text-sm text-accent-strong">
            Selected row
          </span>
          <span className="text-sm text-accent-strong underline underline-offset-4">A link</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ['backlog', 'bg-status-backlog'],
              ['todo', 'bg-status-todo'],
              ['in-progress', 'bg-status-in-progress'],
              ['in-review', 'bg-status-in-review'],
              ['done', 'bg-status-done'],
              ['urgent', 'bg-status-urgent'],
              ['sync', 'bg-signal-sync'],
            ] as const
          ).map(([name, cls]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${cls}`} />
              <span className="font-mono text-[10px] text-text-2">{name}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default {
  title: 'Tokens',
}

export function AllPresets() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {THEMES.flatMap((theme) =>
        MODES.map((mode) => <Panel key={`${theme}-${mode}`} theme={theme} mode={mode} />),
      )}
    </div>
  )
}
