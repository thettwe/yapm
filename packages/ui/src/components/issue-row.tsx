import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import { TriangleAlertIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

const LABEL_TONE = {
  neutral: 'text-text-3',
  accent: 'text-accent-strong',
  'in-progress': 'text-status-in-progress',
  'in-review': 'text-status-in-review',
  done: 'text-status-done',
  urgent: 'text-status-urgent',
} as const

export type LabelTone = keyof typeof LABEL_TONE

export interface IssueLabel {
  name: string
  tone?: LabelTone
  // A concrete color string from the label entity (hex/rgb/oklch). When present it drives the
  // dot directly; otherwise the `tone` token class is used. This is data, never a design value.
  color?: string
}

export interface IssueAssignee {
  name: string
  src?: string
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function RealityStripPlaceholder() {
  return (
    <span
      role="img"
      aria-label="No delivery signal yet"
      className="flex w-16 shrink-0 items-center gap-1 text-text-3"
    >
      <span className="size-1.5 rounded-full border border-current opacity-40" />
      <span className="size-1.5 rounded-full border border-current opacity-40" />
      <span className="size-1.5 rounded-full border border-current opacity-40" />
    </span>
  )
}

function DivergenceFlag({ label = 'Status diverges from delivery reality' }: { label?: string }) {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center text-status-urgent">
      <TriangleAlertIcon role="img" aria-label={label} className="size-3.5" />
    </span>
  )
}

export interface IssueRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  issueKey: string
  title: string
  status: StatusKind
  priority: PriorityKind
  labels?: IssueLabel[]
  cycle?: string
  date?: string
  assignee?: IssueAssignee
  selected?: boolean
  realityStrip?: ReactNode
  divergenceFlag?: ReactNode
}

function IssueRow({
  issueKey,
  title,
  status,
  priority,
  labels = [],
  cycle,
  date,
  assignee,
  selected = false,
  realityStrip,
  divergenceFlag,
  className,
  ...props
}: IssueRowProps) {
  return (
    <div
      data-slot="issue-row"
      data-selected={selected || undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable row primitive; issue-core assigns role/handlers
      tabIndex={0}
      className={cn(
        'group/issue-row relative flex min-h-[var(--density-row)] w-full items-center gap-2.5 px-4 text-left outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        selected && 'bg-accent-soft',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0 left-0 h-full w-0.5 rounded-r-full bg-accent transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-focus-visible/issue-row:opacity-100',
        )}
      />

      <span className="flex w-5 shrink-0 justify-center">
        <PriorityMark priority={priority} />
      </span>
      <span className="flex w-5 shrink-0 justify-center">
        <StatusGlyph status={status} />
      </span>
      <span className="w-[62px] shrink-0 truncate font-mono text-xs tabular-nums text-text-2">
        {issueKey}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-[-0.008em] text-text-1">
        {title}
      </span>

      {realityStrip ?? <RealityStripPlaceholder />}

      {labels.length > 0 ? (
        <span className="hidden shrink-0 items-center gap-2 md:flex">
          {labels.map((label) => (
            <span
              key={label.name}
              className="flex items-center gap-1.5 font-ui text-[11.5px] text-text-2"
            >
              {label.color ? (
                <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
              ) : (
                <span
                  className={cn(
                    'size-2 rounded-full bg-current',
                    LABEL_TONE[label.tone ?? 'neutral'],
                  )}
                />
              )}
              {label.name}
            </span>
          ))}
        </span>
      ) : null}

      {cycle ? (
        <span className="hidden w-11 shrink-0 text-right font-mono text-[10.5px] text-text-3 sm:block">
          {cycle}
        </span>
      ) : null}
      {date ? (
        <span className="w-[42px] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-text-3">
          {date}
        </span>
      ) : null}

      {assignee ? (
        <Avatar size="xs" className="shrink-0" title={assignee.name}>
          {assignee.src ? <AvatarImage src={assignee.src} alt={assignee.name} /> : null}
          <AvatarFallback aria-label={assignee.name}>{initials(assignee.name)}</AvatarFallback>
        </Avatar>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}

      {divergenceFlag ?? <span className="w-4 shrink-0" aria-hidden="true" />}
    </div>
  )
}

export { DivergenceFlag, IssueRow, RealityStripPlaceholder }
