import type { ReactNode } from 'react'

const THEMES = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const

export function PresetGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {THEMES.flatMap((theme) =>
        MODES.map((mode) => (
          <div
            key={`${theme}-${mode}`}
            data-theme={theme}
            className={mode === 'dark' ? 'dark' : undefined}
          >
            <div className="flex flex-col gap-4 rounded-card border border-border bg-bg p-6 font-ui text-text-1">
              <div className="flex items-baseline justify-between">
                <span className="font-heading text-sm font-semibold capitalize">{theme}</span>
                <span className="font-mono text-[11px] text-text-2">{mode}</span>
              </div>
              {children}
            </div>
          </div>
        )),
      )}
    </div>
  )
}
