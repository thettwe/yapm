import { cn } from '@yapm/ui/lib/utils'
import { type FocusEvent, type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

export interface HowProps {
  // The derived thing, as the kicker names it: "OPEN TO MERGED". Uppercased by the drawing, so
  // callers write it the way they say it.
  readonly label: string
  // The derivation itself — one sentence, in the register of the page.
  readonly children: ReactNode
  // The mono line under it: the constraints the number was computed within.
  readonly constraint?: ReactNode
  readonly className?: string
}

// A derived number never explains itself at rest — it carries a quiet mono `how ·`, and the
// derivation appears only when somebody asks. Facts stay; footnotes fold.
//
// Click / `Enter`, not hover: a derivation is read, not glanced at, and hover-opening one over a
// dense metric row would fire on every pass of the pointer. That is the one place this pattern
// deliberately parts from the peek beside it.
function How({ label, children, constraint, className }: HowProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const reactId = useId()
  const panelId = `${reactId}-how`
  const kickerId = `${reactId}-how-kicker`

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Focus leaving the whole affordance folds it again: the derivation is read where it was asked
  // for, and the surface is quiet everywhere else.
  function onBlur(event: FocusEvent<HTMLElement>) {
    if (!open) return
    if (wrapperRef.current?.contains(event.relatedTarget)) return
    setOpen(false)
  }

  return (
    <span ref={wrapperRef} data-slot="how" className={cn('relative inline-block', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`How ${label} is derived`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="cursor-pointer font-mono text-[10px] leading-none text-text-3 transition-colors hover:text-text-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        how ·
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-modal={false}
          aria-labelledby={kickerId}
          data-slot="how-panel"
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-[280px] rounded-[10px] border border-border bg-bg-elevated px-[14px] py-[11px] text-left font-ui shadow-elevated"
        >
          <div
            id={kickerId}
            className="mb-[6px] font-mono text-[10px] uppercase tracking-[0.08em] text-text-3"
          >
            {`how · ${label}`}
          </div>
          <div className="text-[12.5px] leading-[1.55] text-text-1">{children}</div>
          {constraint === undefined ? null : (
            <div className="mt-[6px] font-mono text-[10.5px] text-text-3">{constraint}</div>
          )}
        </div>
      ) : null}
    </span>
  )
}

export { How }
