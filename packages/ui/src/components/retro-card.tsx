import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { cn } from '@yapm/ui/lib/utils'
import type { ComponentProps, ReactNode, Ref } from 'react'

// A retro column's accent is a SEMANTIC kind, never a color: the stored value is one of these
// keys and this map is the only place a token stands behind one. Colour is reinforcement only —
// every column and card also carries its meaning in text, so nothing depends on hue alone.
export type RetroAccentKind = 'positive' | 'negative' | 'caution' | 'neutral' | 'action'

const ACCENT_RAIL: Record<RetroAccentKind, string> = {
  positive: 'bg-status-done',
  negative: 'bg-status-urgent',
  caution: 'bg-status-in-progress',
  neutral: 'bg-status-todo',
  action: 'bg-accent',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export interface RetroAccentBarProps extends ComponentProps<'span'> {
  accent: RetroAccentKind
}

function RetroAccentBar({ accent, className, ...props }: RetroAccentBarProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="retro-accent-bar"
      className={cn('h-3.5 w-1 shrink-0 rounded-full', ACCENT_RAIL[accent], className)}
      {...props}
    />
  )
}

export interface RetroCardAuthor {
  name: string
  src?: string | null
}

export interface RetroCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  body: string
  accent: RetroAccentKind
  // Absent for an anonymous card — there is no hidden author to strip, because the synced row
  // never carried one.
  author?: RetroCardAuthor
  anonymous?: boolean
  evidence?: ReactNode
  votes?: ReactNode
  actions?: ReactNode
  selected?: boolean
  dragging?: boolean
  muted?: boolean
  ref?: Ref<HTMLDivElement>
}

// The retro board's tokenized card primitive: one body of text, an optional author (or the
// anonymous marker), an optional evidence chip back to the widget/issue/PR it came from, and a
// slot for vote pips. Strictly tokenized. All DnD/keyboard wiring is spread in by the board.
function RetroCard({
  body,
  accent,
  author,
  anonymous = false,
  evidence,
  votes,
  actions,
  selected = false,
  dragging = false,
  muted = false,
  className,
  ref,
  ...props
}: RetroCardProps) {
  return (
    <div
      ref={ref}
      data-slot="retro-card"
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      className={cn(
        'group/retro-card relative flex touch-none flex-col gap-2 rounded-card border border-border bg-bg-elevated px-3 py-2.5 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        selected && 'bg-accent-soft',
        dragging && 'opacity-40',
        muted && 'opacity-70',
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <RetroAccentBar accent={accent} className="mt-1" />
        <span className="flex-1 whitespace-pre-wrap text-[13.5px] leading-snug tracking-[-0.008em] text-text-1">
          {body}
        </span>
        {votes}
      </div>
      {author || anonymous || evidence || actions ? (
        <div className="flex items-center gap-2 pl-3">
          {author ? (
            <span className="flex items-center gap-1.5 text-[11.5px] text-text-3">
              <Avatar size="xs" className="shrink-0">
                {author.src ? <AvatarImage src={author.src} alt="" /> : null}
                <AvatarFallback aria-hidden="true">{initials(author.name)}</AvatarFallback>
              </Avatar>
              {author.name}
            </span>
          ) : null}
          {anonymous ? <span className="text-[11.5px] text-text-3">Anonymous</span> : null}
          {evidence}
          {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export interface RetroVotePipsProps extends ComponentProps<'span'> {
  count: number
  mine: number
}

// The synced tally is the whole team's count; `mine` is the caller's own dots, which they alone
// can see. Both are rendered as text as well as pips, so the readout never depends on colour.
function RetroVotePips({ count, mine, className, ...props }: RetroVotePipsProps) {
  const pips = Math.min(count, 5)
  return (
    <span
      data-slot="retro-vote-pips"
      className={cn('flex shrink-0 items-center gap-1', className)}
      {...props}
    >
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {Array.from({ length: pips }, (_, index) => (
          <span
            key={index}
            className={cn('size-1.5 rounded-full', index < mine ? 'bg-accent' : 'bg-border-strong')}
          />
        ))}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-text-2">{count}</span>
    </span>
  )
}

export { RetroAccentBar, RetroCard, RetroVotePips }
