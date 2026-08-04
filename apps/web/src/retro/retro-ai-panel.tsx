import { useQuery } from '@rocicorp/zero/react'
import {
  type AiArtifactStatus,
  type DigestConfidence,
  queries,
  RETRO_PROPOSAL_CATEGORIES,
  type RetroPhase,
  type RetroProposalCategory,
  type RetroProposalVerdict,
  type RetroReactionValue,
  type RetroSeed,
  type RetroSeedMetric,
  type RetroSeedRef,
  sortContestedFirst,
} from '@yapm/schema'
import { Badge } from '@yapm/ui/components/badge'
import { cn } from '@yapm/ui/lib/utils'
import {
  ChartNoAxesColumnIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  buildEvidenceIndex,
  type DigestIssueRow,
  type EvidenceIndex,
  resolveEvidence,
} from '@/cycles/digest'
import { retroCan } from '@/retro/model'
import type { RetroAiFocus } from '@/retro/retro-command'
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
//  3. **Nothing here is ratified until the team says so.** Until the verdict is stamped the section
//     says so in words, and each proposal shows the CALLER'S OWN reaction and nothing else — not a
//     count, not an avatar, not "3 people agreed". That is not a UI simplification: no query exists
//     that could return another member's reaction, so there is nothing to render.
const CATEGORY_LABEL: Record<RetroProposalCategory, string> = {
  win: 'Wins',
  loss: 'Losses',
  improvement: 'Improvements',
}

const CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-pill border border-accent-line bg-accent-soft/50 px-2 py-0.5 text-[11px] text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent'

// Every colour is a semantic token and the pressed state is carried by a border, a soft fill, a step
// up in ink AND the `aria-pressed` value — never by hue alone, so it survives every preset in both
// light and dark.
//
// THE PRESSED INK IS `text-1`, NOT `accent-strong`, and that is a contrast fact rather than a taste:
// `--accent-strong` over the soft-accent wash lands at 3.94–4.38 in Focused light, Focused dark and
// Editorial light — below AA for text this size. The mention typeahead's active row already learned
// this (see `styles/contrast.test.ts`); the highlight is the wash and the ink stays the readable
// pair. `contrast.test.ts` pins both toggle states so this cannot drift back.
const TOGGLE =
  'inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent'
const TOGGLE_OFF = 'border-border text-text-2 hover:text-text-1'
const TOGGLE_ON = 'border-accent-line bg-accent-soft text-text-1'

export interface RetroAiProposalRow {
  readonly id: string
  readonly category: RetroProposalCategory
  readonly summary: string
  readonly confidence: DigestConfidence
  readonly refs?: readonly RetroSeedRef[] | null
  readonly rank: number
  // Written ONCE at the `vote -> discuss` advance and nulled again by the step back. Absent means
  // the team has not decided yet, which is why the "not agreed" line keys off it.
  readonly verdict?: RetroProposalVerdict | null
  readonly agreeCount?: number | null
  readonly disagreeCount?: number | null
}

export interface RetroAiReactionRow {
  readonly proposalId: string
  readonly value: RetroReactionValue
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
  // Both come from the retro row and the membership, and both drive `retroCan` — the SAME predicate
  // the server enforces, so an affordance the authority would refuse cannot be drawn.
  phase: RetroPhase
  canWrite: boolean
  onOpenIssue: (issueId: string) => void
  // Reveals the seed panel and focuses the metric's tile — the shipped `seedWidgetSelector` join.
  onOpenMetric: (ref: RetroSeedRef) => void
  onReact: (proposalId: string, value: RetroReactionValue) => void
  onClearReaction: (proposalId: string) => void
  // Provenance only — no assignee is passed, here or anywhere on this path.
  onAddAction: (proposal: { id: string; summary: string }) => void
  // The palette's four AI entries act on whatever the keyboard last held, recorded here because
  // opening the dialog moves focus off it — the rule the board and the action list already use.
  onFocusProposal: (focus: RetroAiFocus | null) => void
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
  phase,
  canWrite,
  onOpenIssue,
  onOpenMetric,
  onReact,
  onClearReaction,
  onAddAction,
  onFocusProposal,
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

  const canReact = retroCan(phase, 'react', { canWrite })
  const canAct = retroCan(phase, 'action', { canWrite })

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
        <DraftedProposals
          retroId={retroId}
          groups={groups}
          index={index}
          seed={seed}
          canReact={canReact}
          canAct={canAct}
          onOpenIssue={onOpenIssue}
          onOpenMetric={onOpenMetric}
          onReact={onReact}
          onClearReaction={onClearReaction}
          onAddAction={onAddAction}
          onFocusProposal={onFocusProposal}
        />
      ) : null}
    </>
  )
}

// THE REACTION QUERY LIVES HERE, one level below the opt-in gate, and for the same reason the gate
// itself is a wrapper: hooks cannot be skipped, so the only way to not issue it is to not mount the
// component that holds it. `ai_off`, `failed` and a `ready` draft whose proposals were all dropped
// each draw nothing — and each must also ASK for nothing beyond the two artifact queries, because
// "byte-identical to the retro that ships without this capability" is a claim about the sync surface
// and not only about the DOM. The caller's own reactions are consumed by controls that render only
// under `drafted`, so nothing above needs them.
function DraftedProposals({
  retroId,
  groups,
  index,
  seed,
  canReact,
  canAct,
  onOpenIssue,
  onOpenMetric,
  onReact,
  onClearReaction,
  onAddAction,
  onFocusProposal,
}: {
  retroId: string
  groups: readonly CategoryGroup[]
  index: EvidenceIndex
  seed: RetroSeed | null
  canReact: boolean
  canAct: boolean
  onOpenIssue: (issueId: string) => void
  onOpenMetric: (ref: RetroSeedRef) => void
  onReact: (proposalId: string, value: RetroReactionValue) => void
  onClearReaction: (proposalId: string) => void
  onAddAction: (proposal: { id: string; summary: string }) => void
  onFocusProposal: (focus: RetroAiFocus | null) => void
}) {
  // SELF-SCOPED WITH NO ADMIN BYPASS. It returns the caller's own rows and there is no other query
  // over that table anywhere, which is why this surface renders no count before the stamp: not a
  // choice, an absence of data.
  const [reactionRows] = useQuery(queries.retroAiReactions.mine({ retroId }))

  const mine = useMemo(() => {
    const byProposal = new Map<string, RetroReactionValue>()
    for (const row of reactionRows as readonly RetroAiReactionRow[]) {
      byProposal.set(row.proposalId, row.value)
    }
    return byProposal
  }, [reactionRows])

  // The stamp, not the phase name: `discuss` onward is exactly when a verdict exists, and reading it
  // off the data means a step back that cleared it also clears the display in the same tick.
  const ratified = groups.some((group) =>
    group.proposals.some((proposal) => proposal.verdict != null),
  )
  // Contested first, then the (category, rank) order the grouping already imposes. Sorted client-side
  // over already-synced rows rather than as an `orderBy`, because the ordering is phase-dependent and
  // a phase-varying synced query would be a second read shape for the same rows.
  const ordered = useMemo(
    () => (ratified ? sortContestedFirst(groups.flatMap((group) => group.proposals)) : []),
    [groups, ratified],
  )

  const focusFor = (proposalId: string): RetroAiFocus | null => {
    const proposal = groups
      .flatMap((group) => group.proposals)
      .find((candidate) => candidate.id === proposalId)
    if (proposal === undefined) return null
    return {
      id: proposal.id,
      body: proposal.summary,
      category: proposal.category,
      verdict: proposal.verdict ?? null,
      mine: mine.get(proposal.id) ?? null,
    }
  }

  const proposalProps = (proposal: RetroAiProposalRow) => ({
    proposal,
    index,
    seed,
    mine: mine.get(proposal.id) ?? null,
    canReact,
    canAct,
    onOpenIssue,
    onOpenMetric,
    onReact,
    onClearReaction,
    onAddAction,
  })

  const onProposalFocus = (event: { target: EventTarget | null }) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-retro-ai-proposal]',
    )
    const id = row?.dataset.retroAiProposal
    onFocusProposal(id === undefined ? null : focusFor(id))
  }

  return (
    <AiSection unratified={!ratified}>
      <div
        className="mt-3 flex flex-col gap-3"
        data-testid="retro-ai-groups"
        onFocusCapture={onProposalFocus}
      >
        {/* Before the stamp the board keeps its category headings, which is how people read it.
            After the stamp the ordering becomes global — contested first, across categories —
            because the point of the ceremony is to spend scarce discussion time on disagreement,
            and a per-category sort would bury a contested Improvement under agreed Wins. Each row
            then carries its own category chip, so nothing is lost with the headings. */}
        {ratified ? (
          <ul className="flex flex-col gap-1.5" data-testid="retro-ai-ratified">
            {ordered.map((proposal) => (
              <ProposalItem key={proposal.id} showCategory {...proposalProps(proposal)} />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
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
                  <ProposalItem key={proposal.id} {...proposalProps(proposal)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </AiSection>
  )
}

interface ProposalItemProps {
  proposal: RetroAiProposalRow
  index: EvidenceIndex
  seed: RetroSeed | null
  mine: RetroReactionValue | null
  canReact: boolean
  canAct: boolean
  showCategory?: boolean
  onOpenIssue: (issueId: string) => void
  onOpenMetric: (ref: RetroSeedRef) => void
  onReact: (proposalId: string, value: RetroReactionValue) => void
  onClearReaction: (proposalId: string) => void
  onAddAction: (proposal: { id: string; summary: string }) => void
}

function ProposalItem({
  proposal,
  index,
  seed,
  mine,
  canReact,
  canAct,
  showCategory = false,
  onOpenIssue,
  onOpenMetric,
  onReact,
  onClearReaction,
  onAddAction,
}: ProposalItemProps) {
  const verdict = proposal.verdict ?? null
  // The one-keystroke path exists on an AGREED IMPROVEMENT only: a win needs no follow-up and a loss
  // is not itself a thing to do. The mutator is deliberately laxer (design D8) — this is the
  // affordance, not the authority.
  const actionable = canAct && verdict === 'agreed' && proposal.category === 'improvement'

  return (
    <li
      className="flex flex-col gap-1.5 rounded-card border border-border bg-bg-elevated px-3 py-2"
      data-testid="retro-ai-proposal"
      data-category={proposal.category}
      data-verdict={verdict ?? undefined}
      data-retro-ai-proposal={proposal.id}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-1">
          {proposal.summary}
        </span>
        {showCategory ? (
          <Badge variant="outline" data-testid="retro-ai-category-chip">
            {CATEGORY_LABEL[proposal.category]}
          </Badge>
        ) : null}
        <ConfidenceNote confidence={proposal.confidence} />
      </div>
      <EvidenceChips
        refs={proposal.refs ?? []}
        index={index}
        seed={seed}
        onOpenIssue={onOpenIssue}
        onOpenMetric={onOpenMetric}
      />
      {canReact ? (
        <ReactionToggles
          proposalId={proposal.id}
          summary={proposal.summary}
          mine={mine}
          onReact={onReact}
          onClearReaction={onClearReaction}
        />
      ) : null}
      {verdict === null ? null : (
        <VerdictNote
          verdict={verdict}
          agree={proposal.agreeCount ?? 0}
          disagree={proposal.disagreeCount ?? 0}
        />
      )}
      {actionable ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cn(TOGGLE, TOGGLE_OFF)}
            aria-label={`Add as an action: ${proposal.summary}`}
            data-testid="retro-ai-add-action"
            // NO ASSIGNEE IS PASSED, and none is offered: the AI layer has no identity dimension, so
            // an owner here could only be invented. A human assigns it afterwards.
            onClick={() => onAddAction({ id: proposal.id, summary: proposal.summary })}
          >
            <ListChecksIcon className="size-3" aria-hidden="true" />
            Add as an action
          </button>
        </div>
      ) : null}
    </li>
  )
}

// Two real buttons in DOM order after the summary, so the whole control is reachable by Tab alone,
// and `aria-pressed` rather than a checked role because this is a toggle, not a form field. Pressing
// the already-pressed value clears it — a mis-click must not become a permanent opinion.
//
// IT RENDERS ONLY THE CALLER'S OWN REACTION. No count, no avatar, no other member's state, in any
// phase and for any role, because no query exists that could return one.
//
// Each toggle is NAMED BY THE PROPOSAL IT ACTS ON, the `Vote for ${label}` pattern the board's dot
// buttons already hold: a section carrying nine proposals otherwise offers a screen-reader user
// eighteen controls called "Agree" and "Disagree", and which one is which is carried by visual
// adjacency alone.
function ReactionToggles({
  proposalId,
  summary,
  mine,
  onReact,
  onClearReaction,
}: {
  proposalId: string
  summary: string
  mine: RetroReactionValue | null
  onReact: (proposalId: string, value: RetroReactionValue) => void
  onClearReaction: (proposalId: string) => void
}) {
  function toggle(value: RetroReactionValue) {
    if (mine === value) onClearReaction(proposalId)
    else onReact(proposalId, value)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="retro-ai-reactions">
      <button
        type="button"
        aria-pressed={mine === 'agree'}
        aria-label={`Agree with: ${summary}`}
        className={cn(TOGGLE, mine === 'agree' ? TOGGLE_ON : TOGGLE_OFF)}
        data-testid="retro-ai-agree"
        onClick={() => toggle('agree')}
      >
        <ThumbsUpIcon className="size-3" aria-hidden="true" />
        Agree
      </button>
      <button
        type="button"
        aria-pressed={mine === 'disagree'}
        aria-label={`Disagree with: ${summary}`}
        className={cn(TOGGLE, mine === 'disagree' ? TOGGLE_ON : TOGGLE_OFF)}
        data-testid="retro-ai-disagree"
        onClick={() => toggle('disagree')}
      >
        <ThumbsDownIcon className="size-3" aria-hidden="true" />
        Disagree
      </button>
    </div>
  )
}

// `contested` is the routing signal — the reason the ceremony exists — so it is the one verdict that
// gets the accent. The other three are carried by their words alone, the same discipline
// `ConfidenceNote` holds: no meaning depends on hue, and nothing is dimmed below AA to make a point.
//
// It takes the SOLID accent rather than the soft one. `Badge variant="accent"` is
// `bg-accent-soft text-accent-strong`, which is the pair that misses AA in three of the six presets;
// `variant="solid"` is `bg-accent text-on-accent`, asserted at AA in all six by
// `styles/contrast.test.ts`. This is the first product use of either variant, so the choice is being
// made rather than inherited.
const VERDICT_LABEL: Record<RetroProposalVerdict, string> = {
  agreed: 'Agreed',
  contested: 'Contested',
  rejected: 'Rejected',
  unrated: 'Nobody responded',
}

// A TEAM-LEVEL AGGREGATE WITH NO PER-PERSON DIMENSION. There is no name here and no surface anywhere
// that could pair one with a direction — the counts are the whole of what the team's decision says.
function VerdictNote({
  verdict,
  agree,
  disagree,
}: {
  verdict: RetroProposalVerdict
  agree: number
  disagree: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="retro-ai-verdict">
      <Badge variant={verdict === 'contested' ? 'solid' : 'outline'}>
        {VERDICT_LABEL[verdict]}
      </Badge>
      {verdict === 'unrated' ? null : (
        <span className="text-[11px] text-text-2" data-testid="retro-ai-verdict-counts">
          {agree} agreed, {disagree} disagreed
        </span>
      )}
    </div>
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
