import { cn } from '@yapm/ui/lib/utils'
import type { ReactNode } from 'react'

// Band 2 — the masthead. The page OWNS this band and adapts it; what it may not do is hand-roll
// chrome, which is what ten routes did before this change. `ia.html`'s band-2 anatomy and nothing
// else: title + mono count on the left, the lens toggle beside it, meta below, actions right.
//
// Labels only — the word diet's CHROME tier. The one binding-rule sentence (declared once, as
// `BINDING_TEAM_LEVEL_RULE` in `@yapm/schema`) is stated on Delivery, once per app, not here.
export function Masthead({
  kicker,
  title,
  count,
  lens,
  meta,
  actions,
  className,
}: {
  // The row ABOVE the title: a breadcrumb, an identifier, a state pill — what the reader needs to
  // know they are in the right place before they read the title. Additive and optional, so band 2
  // stays one component: the alternative is a page hand-rolling its own masthead, which is exactly
  // what `app-frame` deleted from ten routes.
  kicker?: ReactNode
  title: ReactNode
  // A string count is the already-capped reading a surface publishes ("99+"), not a second
  // formatting of the same number.
  count?: number | string
  lens?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      data-testid="masthead"
      className={cn('flex flex-col gap-2 border-b border-border px-5 py-3', className)}
    >
      {kicker === undefined ? null : (
        <div data-testid="masthead-kicker" className="flex flex-wrap items-center gap-2">
          {kicker}
        </div>
      )}
      <div className="flex items-center gap-3">
        <h1 className="font-heading text-[15px] font-bold tracking-tight text-text-1">{title}</h1>
        {count === undefined ? null : (
          <span data-testid="masthead-count" className="font-mono text-[11px] text-text-3">
            {count}
          </span>
        )}
        {lens === undefined ? null : <div className="flex items-center gap-1">{lens}</div>}
        {actions === undefined ? null : (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>
      {meta === undefined ? null : <div className="flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
  )
}
