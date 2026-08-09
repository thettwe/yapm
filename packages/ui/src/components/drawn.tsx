import { cn } from '@yapm/ui/lib/utils'
import type { ReactNode } from 'react'

// The drawn band vocabulary: static inline drawings, no motion, every color a theme token. These
// took plain structural props from the day they were written, and now have three consumers rather
// than one, so they live here beside the row primitives instead of inside a page. The unions are
// mirrored from the schema seam as plain string unions (the `issue-row` precedent) and guarded
// both ways by `reality-track.test.tsx`.

export type DayBandSegment = 'past' | 'today' | 'future'
export type ScopeBlockKind = 'landed' | 'open' | 'added'

export function DayBand({ segments }: { segments: readonly DayBandSegment[] }) {
  const days = segments.map((kind, index) => ({ id: `day-${index + 1}`, kind }))
  return (
    <div aria-hidden="true" className="flex h-3 items-center gap-[5px]">
      {days.map((day) => (
        <span
          key={day.id}
          className={cn(
            'h-[6px] flex-1 rounded-[2.5px] bg-row-hairline',
            day.kind === 'past' && 'bg-accent-line',
            day.kind === 'today' && 'h-3 bg-accent',
          )}
        />
      ))}
    </div>
  )
}

export function ScopeBand({ band }: { band: readonly ScopeBlockKind[] }) {
  const blocks = band.map((kind, index) => ({ id: `block-${index + 1}`, kind }))
  return (
    <div aria-hidden="true" className="mt-[9px] flex gap-[3px]">
      {blocks.map((block) => (
        <span
          key={block.id}
          className={cn(
            'flex h-[11px] flex-1 items-center justify-center rounded-[2.5px]',
            block.kind === 'landed' && 'bg-status-done',
            block.kind === 'open' && 'border-[1.4px] border-border-strong bg-transparent',
            block.kind === 'added' && 'border-[1.4px] border-status-in-progress bg-transparent',
          )}
        >
          {/* 9px type, so the `+` takes the TEXT ink rather than the drawn hue its outline carries:
              one amber cannot clear both 3:1 as a mark and 4.5:1 as type and stay an amber. */}
          {block.kind === 'added' ? (
            <span className="text-[9px] font-bold leading-none text-status-in-progress-ink">+</span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

const TICK_HEIGHTS = [7, 10, 6, 11, 13, 9] as const
const TICK_CAP = 8

// One tick per CI check, `true` = failing; heights cycle a fixed pattern (they carry no data).
export function TickBar({ ticks }: { ticks: readonly boolean[] }) {
  const shown = ticks.slice(-TICK_CAP).map((bad, index) => ({
    id: `tick-${index + 1}`,
    bad,
    height: TICK_HEIGHTS[index % TICK_HEIGHTS.length] as number,
  }))
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-[2.5px]">
      {shown.map((tick) => (
        <span
          key={tick.id}
          style={{ height: `${tick.height}px` }}
          className={cn(
            'w-[3px] rounded-[1px]',
            tick.bad ? 'bg-status-urgent' : 'bg-border-strong',
          )}
        />
      ))}
    </span>
  )
}

// The drawn marks: one 20-unit grid, one 1.6 round-cap stroke, `currentColor` throughout, and
// `aria-hidden` because every one of them stands beside the word it reinforces. They live here
// rather than beside their consumer for the reason `reality-vocabulary` gives — one shared module
// for the drawn primitives — and because the retro mark is the `more▾` menu's own glyph.
function Mark({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-slot="drawn-mark"
      className={cn('size-4 flex-none', className)}
    >
      {children}
    </svg>
  )
}

// Anonymity: a figure whose shoulders are NOT drawn in. The dash is the whole argument — there is
// no author row behind the card, so the mark refuses to close the shape.
export function AnonymityMark({ className }: { className?: string }) {
  return (
    <Mark className={className}>
      <circle cx="10" cy="6.8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.6 16.8 C 4.6 13.1, 15.4 13.1, 16.4 16.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2.4 3.2"
      />
    </Mark>
  )
}

// The retro mark: the loop that comes back on itself, `ia.html`'s `g-retro`.
export function RetroMark({ className }: { className?: string }) {
  return (
    <Mark className={className}>
      <path
        d="M14.5 4.7 A7 7 0 1 0 16.9 8.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M15.4 10.4 L16.9 8.6 L18.6 10.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Mark>
  )
}

// The draft mark: two sparks on the grid, the second quieter. Ours rather than a vendor icon set's,
// so it sits at the same weight as everything else drawn beside it.
export function DraftMark({ className }: { className?: string }) {
  return (
    <Mark className={className}>
      <path
        d="M8 3.4 V8.4 M5 5.4 L11 8.6 M11 5.4 L5 8.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M14.4 11.2 V15.4 M12.6 12.4 L16.2 14.2 M16.2 12.4 L12.6 14.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity=".55"
      />
    </Mark>
  )
}

// Hollow dots for the triage class, capped visually — the true number lives in the row text.
export function TriageDots({ count }: { count: number }) {
  const dots = Array.from({ length: Math.max(0, Math.min(count, TICK_CAP)) }, (_, index) => ({
    id: `dot-${index + 1}`,
  }))
  return (
    <span aria-hidden="true" className="flex gap-1">
      {dots.map((dot) => (
        <span
          key={dot.id}
          className="size-[7px] rounded-full border-[1.5px] border-border-strong"
        />
      ))}
    </span>
  )
}
