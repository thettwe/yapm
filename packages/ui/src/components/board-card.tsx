import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import type { IssueAssignee } from '@yapm/ui/components/issue-row'
import { RealityStripPlaceholder } from '@yapm/ui/components/issue-row'
import { type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import type { ComponentProps, ReactNode, Ref } from 'react'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export interface BoardCardProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  issueKey: string
  title: string
  status: StatusKind
  priority: PriorityKind
  assignee?: IssueAssignee
  labels?: { name: string; color?: string }[]
  selected?: boolean
  dragging?: boolean
  realityStrip?: ReactNode
  divergenceFlag?: ReactNode
  ref?: Ref<HTMLDivElement>
}

// The board's tokenized card primitive: reuses the same status/priority/assignee visuals and
// the reserved reality-strip and divergence slots as the list row, laid out vertically for a
// kanban column. Strictly tokenized (no hardcoded colors/fonts). All DnD/keyboard wiring
// (ref, listeners, role, tabIndex, aria-*) is spread in by the board via `...props`.
function BoardCard({
  issueKey,
  title,
  status,
  priority,
  assignee,
  labels = [],
  selected = false,
  dragging = false,
  realityStrip,
  divergenceFlag,
  className,
  ref,
  ...props
}: BoardCardProps) {
  return (
    <div
      ref={ref}
      data-slot="board-card"
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        'group/board-card relative flex touch-none flex-col gap-2 rounded-card border border-border bg-bg-elevated px-3 py-2.5 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        selected && 'bg-accent-soft',
        dragging && 'opacity-40',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0 left-0 h-full w-0.5 rounded-r-full bg-accent transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-focus-visible/board-card:opacity-100',
        )}
      />

      <div className="flex items-center gap-2">
        <StatusGlyph status={status} />
        <span className="font-mono text-xs tabular-nums text-text-2">{issueKey}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {divergenceFlag}
          <PriorityMark priority={priority} />
        </span>
      </div>

      <span className="text-[13.5px] font-medium leading-snug tracking-[-0.008em] text-text-1">
        {title}
      </span>

      <div className="flex items-center gap-2">
        {labels.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {labels.map((label) => (
              <span
                key={label.name}
                className="flex items-center gap-1 font-ui text-[11.5px] text-text-2"
              >
                {label.color ? (
                  <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
                ) : (
                  <span className="size-2 rounded-full bg-current text-text-3" />
                )}
                {label.name}
              </span>
            ))}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {realityStrip ?? <RealityStripPlaceholder />}
          {assignee ? (
            <Avatar size="xs" className="shrink-0" title={assignee.name}>
              {assignee.src ? <AvatarImage src={assignee.src} alt={assignee.name} /> : null}
              <AvatarFallback aria-label={assignee.name}>{initials(assignee.name)}</AvatarFallback>
            </Avatar>
          ) : null}
        </span>
      </div>
    </div>
  )
}

export { BoardCard }
