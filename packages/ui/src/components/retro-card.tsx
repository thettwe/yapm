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
//
// THE PAPER-NOTE REGISTER. A note is flat: the elevated ground, a 3px radius against the app's
// 7/15px, and one 2px hairline of thickness at the foot. No rotation, no dog-ear, no shadow —
// `PLAY-warmth` filed all three as one illustration away from a greeting card.
//
// The vote slot keeps a RESERVED MEASURE whenever the card is a vote target, so a column does not
// shift under the reader as dots land, and draws nothing at all while the tally is zero.
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
        'group/retro-card relative flex touch-none flex-col gap-2 rounded-[3px] border border-border border-b-2 border-b-border-strong bg-bg-elevated px-3 py-2.5 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
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
      </div>
      {/* ONE foot line, not two. The vote slot, the attribution, the evidence chip and the card's
          controls share it: a second row holding only a delete button added a whole line of empty
          measure to every note on the board. */}
      {votes === undefined && !(author || anonymous || evidence || actions) ? null : (
        <div data-slot="retro-vote-slot" className="flex min-h-3 items-center gap-2 pl-[13px]">
          {votes}
          {author ? (
            <span className="flex items-center gap-1.5 text-[11.5px] text-text-2">
              <Avatar size="xs" className="shrink-0">
                {author.src ? <AvatarImage src={author.src} alt="" /> : null}
                <AvatarFallback aria-hidden="true">{initials(author.name)}</AvatarFallback>
              </Avatar>
              {author.name}
            </span>
          ) : null}
          {anonymous ? <span className="text-[11.5px] text-text-2">Anonymous</span> : null}
          {evidence}
          {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
        </div>
      )}
    </div>
  )
}

export interface RetroVotePipsProps extends ComponentProps<'span'> {
  count: number
  mine: number
}

// The synced tally is the whole team's count; `mine` is the caller's own dots, which they alone
// can see. Both are rendered as text as well as pips, so the readout never depends on colour.
//
// A ZERO TALLY DRAWS NOTHING — the `reality-vocabulary` rule that a slot with no fact draws no ink,
// enforced in the primitive rather than at each call site, so no caller can forget it. A mono `0`
// beside five hollow pips is reality ink on a quiet row: it says "measured, and none" where the
// truth is "nobody has voted yet".
function RetroVotePips({ count, mine, className, ...props }: RetroVotePipsProps) {
  if (count === 0) return null
  const pips = Math.min(count, 5)
  return (
    <span
      data-slot="retro-vote-pips"
      data-testid="retro-vote-pips"
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
