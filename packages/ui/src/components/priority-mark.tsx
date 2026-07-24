import { cn } from '@yapm/ui/lib/utils'
import type { SVGProps } from 'react'

const PRIORITY = {
  'no-priority': 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
  urgent: 'Urgent',
} as const

export type PriorityKind = keyof typeof PRIORITY

const BAR_HEIGHTS = [
  { x: 2, y: 8, h: 4 },
  { x: 6, y: 5, h: 7 },
  { x: 10, y: 2, h: 10 },
] as const

const FILLED: Record<Exclude<PriorityKind, 'urgent'>, number> = {
  'no-priority': 0,
  low: 1,
  medium: 2,
  high: 3,
}

function PriorityMark({
  priority,
  className,
  ...props
}: { priority: PriorityKind } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const label = PRIORITY[priority]
  return (
    <svg
      viewBox="0 0 14 14"
      role="img"
      aria-label={label}
      className={cn('size-3.5 shrink-0', priority === 'urgent' && 'text-status-urgent', className)}
      {...props}
    >
      <title>{label}</title>
      {priority === 'urgent' ? (
        <>
          <rect x="1" y="1" width="12" height="12" rx="2.5" fill="currentColor" />
          <rect x="6.25" y="3.5" width="1.5" height="4.5" rx="0.75" fill="var(--bg)" />
          <rect x="6.25" y="9.2" width="1.5" height="1.6" rx="0.75" fill="var(--bg)" />
        </>
      ) : (
        BAR_HEIGHTS.map((bar, index) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width="2.5"
            height={bar.h}
            rx="0.75"
            fill={index < FILLED[priority] ? 'var(--text-2)' : 'var(--text-3)'}
            opacity={index < FILLED[priority] ? 1 : 0.4}
          />
        ))
      )}
    </svg>
  )
}

export { PRIORITY, PriorityMark }
