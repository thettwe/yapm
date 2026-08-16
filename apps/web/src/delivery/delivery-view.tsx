import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import {
  BINDING_TEAM_LEVEL_RULE,
  buildDeliveryPage,
  DELIVERY_WINDOW_SIZES,
  type DeliveryDistributionSection,
  type DeliveryFlowSection,
  type DeliveryPageDeploymentRow,
  type DeliveryPageHonesty,
  type DeliveryPageHow,
  type DeliveryPageIssueRow,
  type DeliveryPageRetroRow,
  type DeliveryPeekSubject,
  type DeliveryRhythmSection,
  type DeliveryTimelineSection,
  type DeliveryWindowSize,
  queries,
} from '@yapm/schema'
import { AnnotatedTimeline } from '@yapm/ui/components/annotated-timeline'
import { DistributionStrip } from '@yapm/ui/components/distribution-strip'
import { Door } from '@yapm/ui/components/door'
import { FlowBand } from '@yapm/ui/components/flow-band'
import { How } from '@yapm/ui/components/how'
import { PeekFact, PeekPanel, PeekProvider, PeekTitle, usePeek } from '@yapm/ui/components/peek'
import {
  buildRealityShape,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { ReviewRhythm } from '@yapm/ui/components/review-rhythm'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'
import { StatRow } from '@/delivery/stat-tile'
import { useCommandSource } from '@/frame/command-registry'
import { Masthead } from '@/frame/masthead'
import { useMinuteNow } from '@/frame/team-context'
import { DIVERGENCE_LABEL } from '@/issues/delivery'
import { STATUS_TO_KIND } from '@/issues/model'

// The Delivery page as `northstar/delivery.html` draws it: a journalism cut, where each section
// leads with a sentence stating what the data says and then draws the evidence under it.
//
// This file RENDERS and formats nothing. Every number, sentence, annotation, position and
// derivation comes from `buildDeliveryPage` in `@yapm/schema` (design §D1), over the four reads the
// team Home already syncs — so changing the window re-runs a pure function over rows already in
// memory and waits on nothing.
//
// Team-level only at every depth: the model has nowhere to put a person, which is what makes that
// structural rather than a promise this file keeps.

export interface DeliveryViewProps {
  teamId: string
  size: DeliveryWindowSize
  onSizeChange: (size: DeliveryWindowSize) => void
}

export function DeliveryView({ teamId, size, onSizeChange }: DeliveryViewProps) {
  const now = useMinuteNow()
  const [teams] = useQuery(queries.teams.all())
  const [cyclesRaw, cyclesResult] = useQuery(queries.cycles.byTeam({ teamId }))
  // The substrate: the team's issues with their linked delivery subtree, plus the deployments and
  // retrospectives Home already reads. This view adds no query surface at all.
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))
  const [deploymentsRaw] = useQuery(queries.deployments.byTeam({ teamId }))
  const [retrosRaw] = useQuery(queries.retros.byTeam({ teamId }))

  const team = teams.find((candidate) => candidate.id === teamId)

  const model = useMemo(
    () =>
      team === undefined
        ? null
        : buildDeliveryPage(
            {
              teamKey: team.key,
              cycles: cyclesRaw,
              issues: issuesRaw as unknown as readonly DeliveryPageIssueRow[],
              deployments: deploymentsRaw as readonly DeliveryPageDeploymentRow[],
              retros: retrosRaw as readonly DeliveryPageRetroRow[],
              size,
            },
            now,
          ),
    [team, cyclesRaw, issuesRaw, deploymentsRaw, retrosRaw, size, now],
  )

  const commandGroups = useMemo(
    () => [
      {
        id: 'delivery',
        heading: 'Delivery',
        commands: DELIVERY_WINDOW_SIZES.map((option) => ({
          id: `delivery-window-${option}`,
          label: `Window: last ${option} cycles`,
          onSelect: () => onSizeChange(option),
        })),
      },
    ],
    [onSizeChange],
  )
  // ⌘K is owned globally by the frame; this surface registers and binds no listener of its own.
  useCommandSource('delivery', { groups: commandGroups })

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || cyclesResult.type === 'complete'
          ? 'This team no longer exists.'
          : 'Loading team…'}
      </p>
    )
  }

  return (
    <PeekProvider>
      <Masthead
        title="Delivery"
        actions={
          <Select
            value={String(size)}
            data-testid="delivery-window-size"
            // The visible label folds into the accessible name (design §D15): chrome is labels, and
            // the standfirst beside it already says what the window is.
            aria-label="Window"
            className="h-[30px] w-auto rounded-control border-border-strong bg-transparent pr-8 pl-3 text-[12.5px] font-semibold text-text-1 shadow-none"
            onChange={(event) => onSizeChange(Number(event.target.value) as DeliveryWindowSize)}
          >
            {DELIVERY_WINDOW_SIZES.map((option) => (
              <option key={option} value={option}>
                Last {option} cycles
              </option>
            ))}
          </Select>
        }
        // The binding rule, once in the whole app (`delivery.html` §masthead): this is the only page
        // that could tempt a per-person reading, so it is the only page that says the rule.
        meta={
          <p className="text-[12px] text-text-2" data-testid="delivery-standfirst">
            {model?.standfirst.cycleInProgress == null ? null : (
              <span>{`${model.standfirst.cycleInProgress} · `}</span>
            )}
            <span data-testid="delivery-window-label">
              {model === null ? 'No completed cycles yet' : model.standfirst.window}
            </span>
            {` · ${BINDING_TEAM_LEVEL_RULE}.`}
          </p>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1248px] px-8 pt-6 pb-2">
          {model === null ? (
            <div
              className="max-w-3xl rounded-card border border-dashed border-border px-3 py-2.5"
              data-testid="delivery-empty"
            >
              <p className="text-xs font-medium text-text-2">No completed cycles yet</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-3">
                These metrics are measured over completed cycles. Complete a cycle and this fills in
                from the team's own work — no connector required for the Delivered numbers.
              </p>
            </div>
          ) : (
            <>
              {model.timeline === null ? null : (
                <TimelineBand timeline={model.timeline} peek={model.peek} teamId={teamId} />
              )}

              <StatRow readings={model.stats} />

              {/* Said once, quietly, when a whole family is missing because nothing has been fed
                  in — never once per absent drawing (spec §"Degrades to the data that exists"). */}
              {model.flowAbsence === null ? null : (
                <p
                  data-testid="delivery-flow-absence"
                  className="max-w-[640px] pt-4 text-[12px] leading-[1.6] text-text-2"
                >
                  {model.flowAbsence}
                </p>
              )}

              {model.distribution === null ? null : (
                <Distribution distribution={model.distribution} />
              )}
              {model.flow === null ? null : <Flow flow={model.flow} />}
              {model.rhythm === null ? null : <Rhythm rhythm={model.rhythm} />}

              <Honesty honesty={model.honesty} />
            </>
          )}
        </div>
      </div>
    </PeekProvider>
  )
}

// ---------------------------------------------------------------------------
// The annotated timeline, and the page's ONE peek.
// ---------------------------------------------------------------------------

function TimelineBand({
  timeline,
  peek,
  teamId,
}: {
  timeline: DeliveryTimelineSection
  peek: DeliveryPeekSubject | null
  teamId: string
}) {
  return (
    <section data-testid="delivery-timeline" aria-label={timeline.label} className="pb-2">
      <AnnotatedTimeline
        startLabel={timeline.startLabel}
        endLabel={timeline.endLabel}
        deploys={timeline.deploys.map((deploy, index) => ({
          id: `deploy-${index + 1}-${deploy.atMs}`,
          position: deploy.position,
        }))}
        retros={timeline.retros.map((retro, index) => ({
          id: `retro-${index + 1}-${retro.atMs}`,
          position: retro.position,
          title: retro.title,
          detail: retro.counts,
        }))}
        callout={
          timeline.callout === null
            ? null
            : {
                position: timeline.callout.position,
                headline: timeline.callout.headline,
                subline: timeline.callout.subline,
              }
        }
        todayPosition={timeline.todayPosition}
        todayLabel={timeline.todayLabel}
        daysLeftLabel={timeline.daysLeftLabel}
        label={timeline.label}
        {...(peek === null || peek.position === null
          ? {}
          : { chip: <DivergedChip peek={peek} teamId={teamId} />, chipPosition: peek.position })}
      />
      <div className="mt-1 flex justify-end">
        <HowLine how={timeline.how} />
      </div>
    </section>
  )
}

// The chip is a real `<Link>`, so `⏎` is the browser's own activation and the peek intercepts
// nothing; `esc` closes and returns focus, both from the shipped `usePeek` (design §D10).
function DivergedChip({ peek, teamId }: { peek: DeliveryPeekSubject; teamId: string }) {
  const { open, triggerProps, peekProps } = usePeek<HTMLAnchorElement>('delivery-diverged', {
    label: `${peek.issueKey} — ${peek.title}`,
  })
  const strip = buildRealityShape(peek.strip, { divergence: 'status_behind_merge' })

  return (
    <span className="relative inline-flex">
      <Link
        to="/teams/$teamId/issues/$issueKey"
        params={{ teamId, issueKey: peek.issueKey }}
        data-testid="delivery-peek-chip"
        {...triggerProps}
        className="inline-flex h-[21px] items-center gap-1.5 rounded-[6px] border border-status-urgent/40 bg-urgent-soft px-1.5 font-mono text-[11.5px] whitespace-nowrap text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <StatusGlyph status={STATUS_TO_KIND[peek.status]} className="size-[13px]" />
        <Door hot={open}>{peek.issueKey}</Door>
      </Link>
      {open ? (
        // A chip in the back half of the cycle opens a 312px panel that would run past the content
        // column; from there the panel hangs from the chip's right edge instead.
        <PeekPanel
          {...peekProps}
          align={(peek.position ?? 0) > 0.6 ? 'end' : 'start'}
          data-testid="delivery-peek"
        >
          <PeekTitle>{peek.title}</PeekTitle>
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-text-2">
            <StatusGlyph status={STATUS_TO_KIND[peek.status]} className="size-[13px]" />
            {peek.cycleName === null ? null : <span>{peek.cycleName}</span>}
          </div>
          <div className="mt-2.5">
            {/* The divergence sentence, never `peek.phrase`: `PeekFact` draws that phrase in
                visible text one line below, and a name that repeated it would have a screen
                reader hear the register's words twice in one panel. */}
            <RealityTrack
              shape={strip}
              label={realityTrackLabel(peek.strip, DIVERGENCE_LABEL.status_behind_merge)}
            />
          </div>
          <PeekFact phrase={peek.phrase} detail={peek.classLabel} />
        </PeekPanel>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// The three drawn sections. Each leads with a sentence and carries one `how ·`.
// ---------------------------------------------------------------------------

// Every section's trigger sits at the RIGHT edge of the content column, so its panel hangs from
// that edge rather than running 280px past it into a scroll container that clips it.
function HowLine({ how, align = 'end' }: { how: DeliveryPageHow; align?: 'start' | 'end' }) {
  return (
    <How label={how.label} constraint={how.constraint} align={align}>
      {how.body}
    </How>
  )
}

function Section({
  kicker,
  standfirst,
  how,
  aside,
  children,
}: {
  kicker: string
  standfirst: string | null
  how: DeliveryPageHow
  aside?: string | null
  children: ReactNode
}) {
  return (
    <section
      data-testid="delivery-drawn-section"
      data-section={kicker.toLowerCase().replaceAll(' ', '-')}
      className="border-t border-row-hairline pt-11 pb-2"
    >
      <div className="mb-1.5 flex items-baseline gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-2">
          {kicker}
        </span>
        {aside == null ? null : <span className="font-mono text-[11px] text-text-2">{aside}</span>}
        <span className="ml-auto">
          <HowLine how={how} />
        </span>
      </div>
      {standfirst === null ? null : (
        <h2
          data-testid="delivery-standfirst-sentence"
          className="mb-1 font-heading text-[20px] font-bold tracking-[-0.015em] text-text-1"
        >
          {standfirst}
        </h2>
      )}
      {children}
    </section>
  )
}

function Distribution({ distribution }: { distribution: DeliveryDistributionSection }) {
  return (
    <Section kicker="Open to merged" standfirst={distribution.standfirst} how={distribution.how}>
      <DistributionStrip
        dots={distribution.entries.map((entry, index) => ({
          id: entry.changeId ?? `change-${index + 1}`,
          position: entry.position,
          outlier: entry.outlier,
        }))}
        ticks={distribution.ticks}
        axisMax={distribution.axisMaxHours}
        tickSuffix="h"
        medianPosition={distribution.medianPosition}
        medianLabel={distribution.medianLabel}
        notes={distribution.annotations.map((annotation) => ({
          id: annotation.kind,
          kind: annotation.kind,
          position: annotation.position,
          text: annotation.text,
        }))}
        label={distribution.label}
      />
    </Section>
  )
}

function Flow({ flow }: { flow: DeliveryFlowSection }) {
  return (
    <Section kicker="Cycle flow" standfirst={flow.standfirst} how={flow.how}>
      <FlowBand
        bars={flow.cycles.map((cycle) => ({
          id: cycle.cycleId,
          label: cycle.label,
          shipped: cycle.shipped,
          added: cycle.addedMidCycle,
          addedLabel: cycle.addedLabel,
        }))}
        carries={flow.carries.map((carry) => ({
          id: `carry-${carry.fromIndex}-${carry.toIndex}`,
          fromIndex: carry.fromIndex,
          toIndex: carry.toIndex,
          count: carry.count,
          label: carry.label,
        }))}
        label={flow.label}
      />
    </Section>
  )
}

function Rhythm({ rhythm }: { rhythm: DeliveryRhythmSection }) {
  return (
    <Section
      kicker="Review rhythm"
      standfirst={rhythm.standfirst}
      how={rhythm.how}
      aside={rhythm.capLabel}
    >
      <ReviewRhythm
        rows={rhythm.changes.map((change, index) => ({
          id: change.changeId ?? `change-${index + 1}`,
          spanHours: change.spanHours,
          firstReviewHours: change.firstReviewHours,
          reviewOffsetsHours: change.reviewOffsetsHours,
          overAxis: change.overAxis,
          spanLabel: change.spanLabel,
        }))}
        axisMaxHours={rhythm.axisMaxHours}
        label={rhythm.label}
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The honesty line — one line plus `more ·`, and nothing that could dismiss it.
// ---------------------------------------------------------------------------

function Honesty({ honesty }: { honesty: DeliveryPageHonesty }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const reactId = useId()
  const panelId = `${reactId}-honesty`

  return (
    <div className="border-t border-row-hairline pb-10" data-testid="delivery-honesty">
      <p className="max-w-[640px] pt-[30px] text-[12.5px] leading-[1.6] text-text-2">
        {honesty.line}{' '}
        {/* The panel holds no focusable thing, so focus never leaves the trigger — which is why
            `esc` is bound here rather than on a wrapper that would have to be given a role to
            justify listening for a key. */}
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-describedby={open ? panelId : undefined}
          aria-label="More on what this page does not measure"
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open) return
            event.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus()
          }}
          className="cursor-pointer font-mono text-[10.5px] leading-none text-text-2 transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          more ·
        </button>
      </p>
      {open ? (
        <ul
          id={panelId}
          data-testid="delivery-honesty-more"
          className="mt-2 flex max-w-[640px] list-disc flex-col gap-1 pl-4 text-[12.5px] leading-[1.6] text-text-2"
        >
          {honesty.more.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
