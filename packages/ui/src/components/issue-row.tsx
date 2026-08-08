import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { buildRealityShape, RealityTrack } from '@yapm/ui/components/reality-track'
import { StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
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

// The unlinked row still draws the track — four empty stations and an empty age column at the same
// reserved measure — so populating a signal can never shift a row's alignment.
function EmptyRealityTrack() {
  return <RealityTrack shape={buildRealityShape(null)} age={null} label="No delivery signal yet" />
}

// The mock's phrase column, wide enough for the longest entry in the shared dictionary's neutral
// register at 12.5px. Reserved whether or not it is filled, so a row whose checks go red does not
// shove its neighbours' tracks left.
export const PHRASE_SLOT_WIDTH = 178

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
  // The row's one reality slot: the drawn track, at `REALITY_TRACK_WIDTH`. Divergence rides on
  // the track's `//` break, so there is no second flag slot to keep in step with it.
  realityTrack?: ReactNode
  // The phrase at rest, from the shared dictionary's neutral register. Omitted or null means this
  // row has nothing true to say and its slot renders genuinely blank — never a dash, never filler.
  phrase?: ReactNode
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
  realityTrack,
  phrase,
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
        selected && 'bg-bg-selected',
        className,
      )}
      {...props}
    >
      {/* Position as well as colour: the rail marks selection where hue alone would not (1.4.1). */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0 left-0 h-full w-[3px] rounded-r-full bg-accent transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-focus-visible/issue-row:opacity-100',
        )}
      />

      <span className="flex w-5 shrink-0 justify-center">
        <PriorityMark priority={priority} />
      </span>
      <span className="flex w-5 shrink-0 justify-center">
        <StatusGlyph status={status} />
      </span>
      <span
        className={cn(
          // The mock inks the selected key with the accent; `--accent-strong` measures 3.84–4.38
          // on `--bg-selected` in two presets, so the ink steps up to `--text-1` instead and the
          // rail plus the tint carry the state. `contrast.test.ts` holds the measurement.
          'w-[62px] shrink-0 truncate font-mono text-xs tabular-nums',
          selected ? 'text-text-1' : 'text-text-2',
        )}
      >
        {issueKey}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-[-0.008em] text-text-1">
        {title}
      </span>

      {/* The title yields space, never the phrase: the phrase is the shorter string and the one
          the reader came to the list for. Reserved unconditionally — an empty slot is what keeps
          a populating signal from moving every track on the page. */}
      <span
        data-slot="issue-row-phrase"
        style={{ width: `${PHRASE_SLOT_WIDTH}px` }}
        className="hidden flex-none items-center justify-end gap-1.5 whitespace-nowrap text-[12.5px] lg:flex"
      >
        {phrase}
      </span>

      {realityTrack ?? <EmptyRealityTrack />}

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
    </div>
  )
}

export { IssueRow }
