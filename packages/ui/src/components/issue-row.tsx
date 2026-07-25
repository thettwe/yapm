import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import {
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type LucideIcon,
  TriangleAlertIcon,
} from 'lucide-react'
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

// The reality strip's typed vocabulary, mirrored from the schema delivery seam as plain string
// unions so this design-system primitive stays free of a schema dependency (the web layer
// computes the signal and hands over these primitives).
export type PrGlyphState = 'draft' | 'open' | 'approved' | 'merged' | 'closed'
export type CiHealthState = 'passing' | 'failing' | 'pending'

const PR_GLYPH: Record<PrGlyphState, { icon: LucideIcon; label: string; tone: string }> = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft PR', tone: 'text-text-3' },
  open: {
    icon: GitPullRequestIcon,
    label: 'PR open, awaiting review',
    tone: 'text-status-in-review',
  },
  approved: { icon: GitPullRequestArrowIcon, label: 'PR approved', tone: 'text-signal-sync' },
  merged: { icon: GitMergeIcon, label: 'PR merged', tone: 'text-status-done' },
  closed: { icon: GitPullRequestClosedIcon, label: 'PR closed', tone: 'text-text-3' },
}

const CI_DOT: Record<CiHealthState, { label: string; tone: string }> = {
  passing: { label: 'CI passing', tone: 'bg-signal-sync' },
  failing: { label: 'CI failing', tone: 'bg-status-urgent' },
  pending: { label: 'CI running', tone: 'bg-status-in-progress' },
}

// Compact review-age label ("3d", "2h", "now"), rendered from the ms since the newest review
// (or, before any review, how long the PR has awaited one).
export function formatReviewAge(ms: number): string {
  if (ms < 60_000) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export interface RealityStripProps {
  pr: PrGlyphState | null
  ci: CiHealthState | null
  reviewAgeMs: number | null
}

// The reality strip: PR lifecycle glyph, CI health dot, and review age — the row's "reality
// over ritual" slot. Occupies the same reserved width as the placeholder so populating a signal
// never shifts row alignment. Every color is a theme token; correct in all presets, light+dark.
function RealityStrip({ pr, ci, reviewAgeMs }: RealityStripProps) {
  const prGlyph = pr ? PR_GLYPH[pr] : null
  const ciDot = ci ? CI_DOT[ci] : null
  const PrIcon = prGlyph?.icon
  const summary = [
    prGlyph?.label,
    ciDot?.label,
    reviewAgeMs != null ? `reviewed ${formatReviewAge(reviewAgeMs)} ago` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <span
      data-slot="reality-strip"
      role="img"
      aria-label={summary || 'Delivery signal'}
      className="flex w-16 shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums text-text-3"
    >
      {PrIcon && prGlyph ? (
        <PrIcon className={cn('size-3.5 shrink-0', prGlyph.tone)} aria-hidden="true" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {ciDot ? (
        <span className={cn('size-1.5 shrink-0 rounded-full', ciDot.tone)} aria-hidden="true" />
      ) : null}
      {reviewAgeMs != null ? (
        <span className="truncate">{formatReviewAge(reviewAgeMs)}</span>
      ) : null}
    </span>
  )
}

function DivergenceFlag({
  label = 'Status diverges from delivery reality',
  decorative = false,
}: {
  label?: string
  // When the same sentence is already shown as adjacent visible text, mark the icon decorative
  // so a screen reader announces the divergence once, not twice.
  decorative?: boolean
}) {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center text-status-urgent">
      {decorative ? (
        <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
      ) : (
        <TriangleAlertIcon role="img" aria-label={label} className="size-3.5" />
      )}
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

export { DivergenceFlag, IssueRow, RealityStrip, RealityStripPlaceholder }
