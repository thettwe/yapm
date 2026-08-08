import { cn } from '@yapm/ui/lib/utils'
import type { SVGProps } from 'react'

const STATUS = {
  backlog: { label: 'Backlog', color: 'text-status-backlog' },
  todo: { label: 'Todo', color: 'text-status-todo' },
  'in-progress': { label: 'In progress', color: 'text-status-in-progress' },
  'in-review': { label: 'In review', color: 'text-status-in-review' },
  done: { label: 'Done', color: 'text-status-done' },
  canceled: { label: 'Canceled', color: 'text-text-3' },
} as const

export type StatusKind = keyof typeof STATUS

// Status is CYCLE POSITION: one loop, filled as far as the work has run. Drawn on the northstar's
// 20-grid with 1.6px round-capped strokes — dashed ring, open ring, half arc, three-quarter arc,
// filled disc. `done` is a plain disc: fill, not hue, is what separates it from `in-review`, so
// 1.4.1 holds without a check mark inside it.
const RING = { cx: 10, cy: 10, r: 7 } as const
const STROKE = 1.6
const GHOST_OPACITY = 0.28
const HALF_ARC = 'M10 3 A7 7 0 0 1 10 17'
const THREE_QUARTER_ARC = 'M10 3 A7 7 0 1 1 3 10'

function Ring({ opacity, dashed = false }: { opacity?: number; dashed?: boolean }) {
  return (
    <circle
      {...RING}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      {...(opacity === undefined ? {} : { strokeOpacity: opacity })}
      {...(dashed ? { strokeDasharray: '2.6 3.4', strokeLinecap: 'round' as const } : {})}
    />
  )
}

function Arc({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
}

function StatusGlyph({
  status,
  className,
  ...props
}: { status: StatusKind } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const { label, color } = STATUS[status]
  return (
    <svg
      viewBox="0 0 20 20"
      role="img"
      aria-label={label}
      className={cn('size-3.5 shrink-0', color, className)}
      {...props}
    >
      <title>{label}</title>
      {status === 'backlog' ? <Ring dashed /> : null}
      {status === 'todo' || status === 'canceled' ? <Ring /> : null}
      {status === 'in-progress' || status === 'in-review' ? <Ring opacity={GHOST_OPACITY} /> : null}
      {status === 'in-progress' ? <Arc d={HALF_ARC} /> : null}
      {status === 'in-review' ? <Arc d={THREE_QUARTER_ARC} /> : null}
      {/* The product's sixth status; the northstar's set is five, so it is redrawn on the same
          grid and stroke rather than borrowed from another family. */}
      {status === 'canceled' ? <Arc d="M6.9 6.9 13.1 13.1M13.1 6.9 6.9 13.1" /> : null}
      {status === 'done' ? <circle cx="10" cy="10" r="7.6" fill="currentColor" /> : null}
    </svg>
  )
}

export { STATUS, StatusGlyph }
