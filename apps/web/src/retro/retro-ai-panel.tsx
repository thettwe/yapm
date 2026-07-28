import { useQuery } from '@rocicorp/zero/react'
import {
  type AiArtifactStatus,
  type DigestConfidence,
  queries,
  RETRO_PROPOSAL_CATEGORIES,
  type RetroProposalCategory,
  type RetroSeed,
  type RetroSeedMetric,
  type RetroSeedRef,
} from '@yapm/schema'
import { Badge } from '@yapm/ui/components/badge'
import { cn } from '@yapm/ui/lib/utils'
import { ChartNoAxesColumnIcon, ExternalLinkIcon, SparklesIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  buildEvidenceIndex,
  type DigestIssueRow,
  type EvidenceIndex,
  resolveEvidence,
} from '@/cycles/digest'
import { findSeedMetric, formatSeedDelta, formatSeedValue } from '@/retro/seed-model'

// The AI's draft, BESIDE the seed panel and never inside the board's columns: `mad_sad_glad` and
// `4ls` do not map onto Wins/Losses/Improvements, so interleaving would either mislabel the output
// or restrict the feature to two of four formats.
//
// Three properties of this file are load-bearing rather than stylistic:
//
//  1. **It draws nothing unless there is something real to show.** No row, `ai_off`, `failed`, or
//     `ready` with zero surviving proposals all draw nothing at all — only the empty, silent live
//     region below, which has to predate the first thing it announces. The change-10 seed panel is
//     the raw-evidence fallback the substrate requires and it is already on screen — a failure banner
//     would be noise about a feature the team may not know it has.
//  2. **No number and no label here comes from the model.** A metric chip reads the metric out of the
//     client-computed seed by key; an entity chip is labelled from the synced row. `ref.label` is
//     model-authored text and is deliberately DISCARDED (see `evidenceTargetFor`) — the name
//     validator scrubs summaries and headings, not ref labels, so a label is the one place injected
//     text could still reach a reader.
//  3. **Nothing here is ratified.** There is no agree/disagree in this release, so the section says
//     so in words. That line is the whole reason the surface cannot be mistaken for a conclusion.
const CATEGORY_LABEL: Record<RetroProposalCategory, string> = {
  win: 'Wins',
  loss: 'Losses',
  improvement: 'Improvements',
}

const CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-pill border border-accent-line bg-accent-soft/50 px-2 py-0.5 text-[11px] text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent'

export interface RetroAiProposalRow {
  readonly id: string
  readonly category: RetroProposalCategory
  readonly summary: string
  readonly confidence: DigestConfidence
  readonly refs?: readonly RetroSeedRef[] | null
  readonly rank: number
}

export interface RetroAiDraftRow {
  readonly status: AiArtifactStatus
  // When the reveal stamped the row. The in-progress line is bounded by it (see below).
  readonly createdAt: number
}

export interface RetroAiPanelProps {
  retroId: string
  teamId: string
  // The team's own opt-in, off the `team` row every member already syncs. Null is off, and the panel
  // then subscribes to NOTHING: a team without the capability issues no extra query, which is what
  // "byte-identical to the retro that ships without this capability" has to mean.
  aiRetroDraftSince: number | null
  // The same seed the panel above renders, so a cited metric key resolves to the identical number.
  seed: RetroSeed | null
  onOpenIssue: (issueId: string) => void
  // Reveals the seed panel and focuses the metric's tile — the shipped `seedWidgetSelector` join.
  onOpenMetric: (ref: RetroSeedRef) => void
}

// How long a `pending` row is allowed to say "drafting…". The tail re-arms every few seconds, so a
// run that is genuinely in flight resolves far inside this; past it the row is not in progress, it is
// stuck — the tail is switched off instance-wide (`AI_RETRO_DRAFT=false`), or its chain and watchdog
// are both down. A spinner nothing will ever replace is worse than no spinner: the seed panel is the
// documented fallback and it is already on screen.
export const RETRO_AI_PENDING_VISIBLE_MS = 120_000

// Spoken and shown, in the same words. The visible line carries the ellipsis; a screen reader gets a
// sentence rather than a trailing pause.
const DRAFTING_LINE = "Drafting wins, losses and improvements from this cycle's work"

// The opt-in gate, and the reason it is a wrapper rather than an `if` inside the body: hooks cannot
// be skipped, so the only way to not issue the two artifact queries is to not mount the component
// that holds them.
export function RetroAiPanel(props: RetroAiPanelProps) {
  if (props.aiRetroDraftSince === null) return null
  return <OptedInRetroAiPanel {...props} />
}

function OptedInRetroAiPanel({
  retroId,
  teamId,
  seed,
  onOpenIssue,
  onOpenMetric,
}: RetroAiPanelProps) {
  const [draftRow] = useQuery(queries.retroAiDrafts.byRetro({ retroId }))
  const [proposalRows] = useQuery(queries.retroAiProposals.byRetro({ retroId }))
  // Already the issue list's query and the seed's substrate, so resolving an entity chip costs no
  // new sync surface and no round trip.
  const [issues] = useQuery(queries.issues.byTeam({ teamId }))

  const index = useMemo(() => buildEvidenceIndex(issues as readonly DigestIssueRow[], []), [issues])

  const groups = useMemo(
    () => groupByCategory(proposalRows as readonly RetroAiProposalRow[]),
    [proposalRows],
  )

  const draft = (draftRow ?? null) as RetroAiDraftRow | null
  const pendingSince = draft?.status === 'pending' ? draft.createdAt : null

  // Nothing here polls. One timer, armed only while a `pending` row is still inside its window, so
  // the line disappears on its own for a reader who was watching when it was stamped.
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (pendingSince === null) return
    const remaining = pendingSince + RETRO_AI_PENDING_VISIBLE_MS - Date.now()
    if (remaining <= 0) return
    const handle = window.setTimeout(() => setClock(Date.now()), remaining)
    return () => window.clearTimeout(handle)
  }, [pendingSince])

  const drafting = pendingSince !== null && clock - pendingSince < RETRO_AI_PENDING_VISIBLE_MS
  const drafted = draft?.status === 'ready' && groups.length > 0

  const announcement = drafting ? `${DRAFTING_LINE}.` : drafted ? readyAnnouncement(groups) : ''

  // THE LIVE REGION IS RENDERED UNCONDITIONALLY, and its text arrives a tick later. Both halves are
  // load-bearing. A `role="status"` element inserted into the DOM together with its own text announces
  // NEITHER — and in the live path the first thing that appears is the `pending` state, so a region
  // owned by the section would be exactly that non-announcing pattern and the drafting notice would be
  // spoken by nothing. Rendering it outside the null/drafting/drafted branching makes it the same node
  // for the whole life of the retro; deferring its text by one tick guarantees the region predates
  // anything it has to say, including the first thing.
  const [spoken, setSpoken] = useState('')
  useEffect(() => {
    const handle = window.setTimeout(() => setSpoken(announcement), 0)
    return () => window.clearTimeout(handle)
  }, [announcement])

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" data-testid="retro-ai-announcement">
        {spoken}
      </p>
      {drafting ? (
        <AiSection>
          <p className="mt-2 text-[11.5px] text-text-2" data-testid="retro-ai-pending">
            {DRAFTING_LINE}…
          </p>
        </AiSection>
      ) : null}
      {drafted ? (
        <AiSection unratified>
          <div className="mt-3 flex flex-col gap-3" data-testid="retro-ai-groups">
            {groups.map((group) => (
              <section
                key={group.category}
                aria-label={CATEGORY_LABEL[group.category]}
                data-testid="retro-ai-category"
                data-category={group.category}
              >
                <h3 className="mb-1.5">
                  <Badge variant="outline" data-testid="retro-ai-category-chip">
                    {CATEGORY_LABEL[group.category]}
                  </Badge>
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {group.proposals.map((proposal) => (
                    <li
                      key={proposal.id}
                      className="flex flex-col gap-1.5 rounded-card border border-border bg-bg-elevated px-3 py-2"
                      data-testid="retro-ai-proposal"
                      data-category={proposal.category}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-1">
                          {proposal.summary}
                        </span>
                        <ConfidenceNote confidence={proposal.confidence} />
                      </div>
                      <EvidenceChips
                        refs={proposal.refs ?? []}
                        index={index}
                        seed={seed}
                        onOpenIssue={onOpenIssue}
                        onOpenMetric={onOpenMetric}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </AiSection>
      ) : null}
    </>
  )
}

// The section chrome, shared by the drafting line and the drafted proposals so the surface does not
// move under the reader when the background pass finishes. The live region deliberately lives OUTSIDE
// it — see `OptedInRetroAiPanel` — because this section is itself one of the things being announced.
function AiSection({
  unratified = false,
  children,
}: {
  unratified?: boolean
  children: ReactNode
}) {
  return (
    <section
      className="border-b border-border bg-bg-sidebar/40 px-4 py-3"
      aria-labelledby="retro-ai-heading"
      data-testid="retro-ai-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SparklesIcon className="size-4 text-text-2" aria-hidden="true" />
        <h2 id="retro-ai-heading" className="text-[13px] font-semibold text-text-1">
          AI draft
        </h2>
        {unratified ? (
          <p className="text-[11.5px] text-text-2" data-testid="retro-ai-unratified">
            AI-drafted, not agreed — the team has not decided any of this.
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

// What the reader is told when the background pass finishes: the counts, in the order they are drawn.
// Nothing model-authored is spoken — a summary read aloud out of context would be exactly the
// unratified claim the section spends a line of copy disclaiming.
const CATEGORY_UNIT: Record<RetroProposalCategory, readonly [string, string]> = {
  win: ['win', 'wins'],
  loss: ['loss', 'losses'],
  improvement: ['improvement', 'improvements'],
}

function readyAnnouncement(groups: readonly CategoryGroup[]): string {
  const counted = groups.map((group) => {
    const [one, many] = CATEGORY_UNIT[group.category]
    const count = group.proposals.length
    return `${count} ${count === 1 ? one : many}`
  })
  return `AI draft ready: ${counted.join(', ')}.`
}

interface CategoryGroup {
  readonly category: RetroProposalCategory
  readonly proposals: readonly RetroAiProposalRow[]
}

// The query orders by `category` then `rank`, which is alphabetical across categories; the reader
// wants Wins, Losses, Improvements. So the grouping imposes the canonical order and keeps `rank`
// within it. An empty category renders no heading at all rather than a hollow one.
function groupByCategory(rows: readonly RetroAiProposalRow[]): CategoryGroup[] {
  return RETRO_PROPOSAL_CATEGORIES.map((category) => ({
    category,
    proposals: rows.filter((row) => row.category === category).sort((a, b) => a.rank - b.rank),
  })).filter((group) => group.proposals.length > 0)
}

// High confidence says nothing, because a note on every line is a note on none. Both remaining
// levels are `text-2`: the distinction is carried by the words, not by dimming one of them below AA.
function ConfidenceNote({ confidence }: { confidence: DigestConfidence }) {
  if (confidence === 'high') return null
  return (
    <span className="shrink-0 text-[11px] text-text-2" data-testid="retro-ai-confidence">
      {confidence === 'low' ? 'possible' : 'medium confidence'}
    </span>
  )
}

function EvidenceChips({
  refs,
  index,
  seed,
  onOpenIssue,
  onOpenMetric,
}: {
  refs: readonly RetroSeedRef[]
  index: EvidenceIndex
  seed: RetroSeed | null
  onOpenIssue: (issueId: string) => void
  onOpenMetric: (ref: RetroSeedRef) => void
}) {
  // In `refs` order: the stored order is the model's citation order, and a reader following the
  // sentence reads them in the order the sentence implies.
  const chips = refs.map((ref) => {
    if (ref.kind === 'widget') {
      const metric = findSeedMetric(seed, ref.id)
      return metric === null ? null : (
        <MetricChip key={`widget-${ref.id}`} metric={metric} onOpen={onOpenMetric} />
      )
    }
    const target = evidenceTargetFor(ref, index)
    if (target === null) return null
    if (target.kind === 'issue') {
      return (
        <button
          key={`${ref.kind}-${ref.id}`}
          type="button"
          className={CHIP}
          aria-label={`Open issue ${target.label}`}
          data-testid="retro-ai-evidence-issue"
          onClick={() => onOpenIssue(target.issueId)}
        >
          {target.label}
        </button>
      )
    }
    return (
      <a
        key={`${ref.kind}-${ref.id}`}
        href={target.href}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(CHIP, 'hover:underline')}
        data-testid="retro-ai-evidence-external"
      >
        {target.label}
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </a>
    )
  })

  if (chips.every((chip) => chip === null)) return null

  return <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
}

// `resolveEvidence` is called WITHOUT the ref's label on purpose. The label is model-authored and no
// validator scrubs it, so the resolver falls back to yapm's own naming (`#12`, `acme/app#7`) drawn
// from the synced row. A ref the client cannot name from its own data resolves to `plain` and is
// dropped rather than rendered as an inert word.
function evidenceTargetFor(
  ref: RetroSeedRef,
  index: EvidenceIndex,
):
  | { kind: 'issue'; issueId: string; label: string }
  | { kind: 'external'; href: string; label: string }
  | null {
  if (ref.kind === 'widget') return null
  const target = resolveEvidence({ kind: ref.kind, id: ref.id }, index)
  return target.kind === 'plain' ? null : target
}

// The join the substrate requires: the model points at a metric KEY and yapm renders its own value
// and delta for it. No number on the proposal row is ever displayed.
function MetricChip({
  metric,
  onOpen,
}: {
  metric: RetroSeedMetric
  onOpen: (ref: RetroSeedRef) => void
}) {
  const value = formatSeedValue(metric)
  const delta = formatSeedDelta(metric)
  return (
    <button
      type="button"
      className={CHIP}
      aria-label={`${metric.label}: ${value}${delta === null ? '' : `, ${delta}`} — show this figure`}
      data-testid="retro-ai-evidence-metric"
      // NOT `data-metric`: that is the attribute `seedWidgetSelector` matches, and a chip carrying it
      // would be a second match for its own selector — activating it could focus itself instead of
      // the seed tile it points at.
      data-metric-key={metric.key}
      onClick={() => onOpen({ kind: 'widget', id: metric.key, label: metric.label })}
    >
      <ChartNoAxesColumnIcon className="size-3" aria-hidden="true" />
      <span>{metric.label}</span>
      <span className="font-mono tabular-nums text-text-1">{value}</span>
      {delta === null ? null : <span className="text-text-2">{delta}</span>}
    </button>
  )
}
