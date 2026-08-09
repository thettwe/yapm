import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import type { IssueAssignee } from '@yapm/ui/components/issue-row'
import { type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import type { ComponentProps, ReactNode, Ref } from 'react'

// The card is narrower than a list row, so the same shape is placed at the card's own measure —
// composable width, one implementation.
export const CARD_TRACK_WIDTH = 86

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
  // The card is the SOURCE of a live move: it keeps its own measure and empties, so the gap the
  // reader sees is exactly the size of the card that left it.
  dragging?: boolean
  // The card is the one being CARRIED: the page's whole elevation budget, spent on its one
  // transient, plus whatever contract `footer` states while the move is live.
  inFlight?: boolean
  footer?: ReactNode
  // A sentence, drawn only when the register has one. Never a reserved empty line: a card with
  // nothing true to say is SHORTER, it does not carry a blank row.
  phrase?: ReactNode
  // Composed by the caller from the same delivery seam the list row uses. Absent is not "quiet
  // signal" — it is a caller that draws no track at all — and either way the slot below keeps its
  // 86px, so a fact arriving later shifts nothing.
  realityTrack?: ReactNode
  ref?: Ref<HTMLDivElement>
}

// The board's tokenized card primitive: the list row's facts in a different shape — status glyph,
// mono key, priority mark, title, rest phrase, labels, the reserved reality-track slot, assignee.
// Strictly tokenized (no hardcoded colors/fonts). All DnD/keyboard wiring (ref, listeners, role,
// tabIndex, aria-*) is spread in by the board via `...props`.
function BoardCard({
  issueKey,
  title,
  status,
  priority,
  assignee,
  labels = [],
  selected = false,
  dragging = false,
  inFlight = false,
  footer,
  phrase,
  realityTrack,
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
      data-in-flight={inFlight || undefined}
      className={cn(
        'group/board-card relative flex touch-none flex-col gap-2 rounded-card border border-border bg-bg-elevated px-3 py-2.5 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        selected && 'bg-accent-soft',
        // The hole. Same element, same measure, no fill and the reserved slot's dashed border —
        // a card that is elsewhere, rather than a card that has been disabled. The border is
        // `--text-2` and not the mock's `--border-strong`, which measures 1.3-1.4 against the
        // column ground in all six themes: the outline is the whole drawing of the hole, so it
        // answers to 3:1 (see `styles/contrast.test.ts`).
        dragging && 'border-dashed border-text-2 bg-transparent hover:border-text-2',
        inFlight && 'border-accent bg-bg-elevated shadow-elevated ring-2 ring-accent-line',
        className,
      )}
      {...props}
    >
      <div className={cn('flex flex-col gap-2', dragging && 'invisible')}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-card"
        >
          <span
            className={cn(
              'absolute top-0 left-0 h-full w-0.5 rounded-r-full bg-accent transition-opacity',
              selected ? 'opacity-100' : 'opacity-0 group-focus-visible/board-card:opacity-100',
            )}
          />
        </span>

        <div className="flex items-center gap-2">
          <StatusGlyph status={status} />
          <span className="font-mono text-xs tabular-nums text-text-2">{issueKey}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <PriorityMark priority={priority} />
          </span>
        </div>

        <span className="text-[13.5px] font-medium leading-snug tracking-[-0.008em] text-text-1">
          {title}
        </span>

        {phrase === undefined || phrase === null ? null : (
          <div data-slot="board-card-phrase" className="flex min-w-0 items-center text-[11.5px]">
            {phrase}
          </div>
        )}

        <div className="flex items-center gap-2">
          {labels.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {labels.map((label) => (
                <span
                  key={label.name}
                  className="flex items-center gap-1 font-ui text-[11.5px] text-text-2"
                >
                  {label.color ? (
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                  ) : (
                    <span className="size-2 rounded-full bg-current text-text-3" />
                  )}
                  {label.name}
                </span>
              ))}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <span
              data-slot="board-card-track"
              className="flex flex-none items-center"
              style={{ width: `${CARD_TRACK_WIDTH}px` }}
            >
              {realityTrack}
            </span>
            {assignee ? (
              <Avatar size="xs" className="shrink-0" title={assignee.name}>
                {assignee.src ? <AvatarImage src={assignee.src} alt={assignee.name} /> : null}
                <AvatarFallback aria-label={assignee.name}>
                  {initials(assignee.name)}
                </AvatarFallback>
              </Avatar>
            ) : null}
          </span>
        </div>

        {footer === undefined || footer === null ? null : (
          <div
            data-slot="board-card-footer"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-row-hairline border-t pt-1.5 font-mono text-[10.5px] text-text-2"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export { BoardCard }
