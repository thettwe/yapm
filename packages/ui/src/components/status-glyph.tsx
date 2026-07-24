import { cn } from '@yapm/ui/lib/utils'
import type { SVGProps } from 'react'

const STATUS = {
  backlog: { label: 'Backlog', color: 'text-status-backlog' },
  todo: { label: 'Todo', color: 'text-status-todo' },
  'in-progress': { label: 'In progress', color: 'text-status-in-progress' },
  'in-review': { label: 'In review', color: 'text-status-in-review' },
  done: { label: 'Done', color: 'text-status-done' },
} as const

export type StatusKind = keyof typeof STATUS

function Pie({ fraction }: { fraction: number }) {
  return (
    <circle
      cx="7"
      cy="7"
      r="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      pathLength={100}
      strokeDasharray={`${fraction * 100} 100`}
      transform="rotate(-90 7 7)"
    />
  )
}

function StatusGlyph({
  status,
  className,
  ...props
}: { status: StatusKind } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const { label, color } = STATUS[status]
  return (
    <svg
      viewBox="0 0 14 14"
      role="img"
      aria-label={label}
      className={cn('size-3.5 shrink-0', color, className)}
      {...props}
    >
      <title>{label}</title>
      {status === 'backlog' ? (
        <circle
          cx="7"
          cy="7"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.2 2.2"
        />
      ) : (
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === 'in-progress' ? <Pie fraction={0.4} /> : null}
      {status === 'in-review' ? <Pie fraction={0.7} /> : null}
      {status === 'done' ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M4.4 7.1 6.2 8.9 9.7 5.2"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  )
}

export { STATUS, StatusGlyph }
