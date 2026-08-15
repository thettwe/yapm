import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import {
  buildTeamHome,
  compareCycles,
  formatHomeAge,
  queries,
  type TeamHomeAttention,
  type TeamHomeCadence,
  type TeamHomeCycleRow,
  type TeamHomeDeploymentRow,
  type TeamHomeDigestRow,
  type TeamHomeHero,
  type TeamHomeIssueRow,
  type TeamHomeModel,
  type TeamHomeNotificationRow,
  type TeamHomeRetroRow,
  type TeamHomeRunway,
  type TeamHomeShipped,
  type TeamHomeSinceYesterday,
  type TeamHomeTriageRow,
  type TeamHomeYours,
} from '@yapm/schema'
import { CadenceChart } from '@yapm/ui/components/cadence-chart'
import { DayBand, ScopeBand, TickBar, TriageDots } from '@yapm/ui/components/drawn'
import { How } from '@yapm/ui/components/how'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import {
  buildRealityShape,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import { type ReactNode, useMemo } from 'react'
import { useMinuteNow } from '@/frame/team-context'
import { PRIORITY_TO_KIND, STATUS_TO_KIND } from '@/issues/model'
import { useSyncSession } from '@/zero/provider'

// The team Home: the morning digest of design-explorations/overhaul-2026-08/northstar/
// home-digest-2.html, rendered over rows the app already syncs. This file is rendering only —
// every count, phrase and fold flag comes from `buildTeamHome` in @yapm/schema (design §D1), and
// every band folds by the model's own null rather than a view-side guess. Doorways are real Links
// in document order (§D13); nothing here waits on the network.

const DOORWAY =
  'outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset'

function formatClock(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function TeamHome({ teamId }: { teamId: string }) {
  const { userID } = useSyncSession()
  const now = useMinuteNow()
  const [teams, teamsResult] = useQuery(queries.teams.all())
  const [cyclesRaw] = useQuery(queries.cycles.byTeam({ teamId }))
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))
  const [triageRaw] = useQuery(queries.triage.inbox({ teamId }))
  const [deploymentsRaw] = useQuery(queries.deployments.byTeam({ teamId }))
  const [retrosRaw] = useQuery(queries.retros.byTeam({ teamId }))
  const [notificationsRaw] = useQuery(queries.notifications.mine())

  const team = teams.find((candidate) => candidate.id === teamId)
  const cycles = cyclesRaw as readonly TeamHomeCycleRow[]
  const activeCycleId = useMemo(
    () => [...cycles].filter((cycle) => cycle.status === 'active').sort(compareCycles)[0]?.id,
    [cycles],
  )
  const [digestRaw] = useQuery(
    activeCycleId === undefined ? undefined : queries.digests.byCycle({ cycleId: activeCycleId }),
  )

  const model = useMemo(
    () =>
      team === undefined || userID === null
        ? null
        : buildTeamHome(
            {
              team: { id: team.id, key: team.key, name: team.name },
              cycles,
              issues: issuesRaw as unknown as readonly TeamHomeIssueRow[],
              triage: triageRaw as readonly TeamHomeTriageRow[],
              deployments: deploymentsRaw as readonly TeamHomeDeploymentRow[],
              digest: (digestRaw ?? null) as TeamHomeDigestRow | null,
              retros: retrosRaw as unknown as readonly TeamHomeRetroRow[],
              notifications: notificationsRaw as readonly TeamHomeNotificationRow[],
            },
            now,
            userID,
          ),
    [
      team,
      userID,
      cycles,
      issuesRaw,
      triageRaw,
      deploymentsRaw,
      digestRaw,
      retrosRaw,
      notificationsRaw,
      now,
    ],
  )

  if (team === undefined || model === null) {
    return (
      <p className="text-sm text-text-3" role="status">
        {teamsResult.type === 'complete' ? 'This team no longer exists.' : 'Loading team…'}
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      <Hero model={model} teamId={teamId} />
      {model.attention === null ? null : (
        <AttentionBand attention={model.attention} teamId={teamId} />
      )}
      {model.sinceYesterday === null ? null : (
        <SinceYesterdayBand since={model.sinceYesterday} teamId={teamId} />
      )}
      <YoursBand yours={model.yours} runway={model.runway} teamId={teamId} />
      {model.runway === null ? null : <ReadyBand runway={model.runway} teamId={teamId} />}
      {model.cadence === null ? null : <CadenceBand cadence={model.cadence} teamId={teamId} />}
      {model.shipped === null ? null : <ShippedBand shipped={model.shipped} />}
      <Footline model={model} />
      <OnwardFooter teamId={teamId} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared band grammar.
// ---------------------------------------------------------------------------

function Band({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <section
      {...(id === undefined ? {} : { id })}
      className="mt-[50px] border-t border-border pt-6"
    >
      {children}
    </section>
  )
}

function BandHeader({
  title,
  count,
  countTestId,
  onward,
}: {
  title: string
  count?: number
  countTestId?: string
  onward?: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <h2 className="text-[11px] font-bold tracking-[0.09em] text-text-1">{title}</h2>
      {count === undefined ? null : (
        <span
          className="font-mono text-xs text-text-3"
          {...(countTestId === undefined ? {} : { 'data-testid': countTestId })}
        >
          {count}
        </span>
      )}
      {onward === undefined ? null : <span className="ml-auto">{onward}</span>}
    </div>
  )
}

function Onward({ children }: { children: ReactNode }) {
  return (
    <span className="text-[12.5px] font-semibold text-text-2">
      {children}
      <span aria-hidden="true" className="ml-[3px] font-normal text-text-3">
        ›
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Hero — editorial left, drawn vitals right (§D3).
// ---------------------------------------------------------------------------

function Hero({ model, teamId }: { model: TeamHomeModel; teamId: string }) {
  const hero: TeamHomeHero = model.hero
  const membersDoorway = (
    <Link
      to="/teams/$teamId/members"
      params={{ teamId }}
      className={cn('ml-auto rounded-control px-2 py-1', DOORWAY)}
    >
      <Onward>Members</Onward>
    </Link>
  )

  if (hero.cycle === null) {
    return (
      <section>
        <div className="flex items-start">
          <h1 className="font-heading text-[40px] font-bold leading-none tracking-[-0.032em] text-text-1">
            {model.teamName}
          </h1>
          {membersDoorway}
        </div>
        <p className="mt-[18px] text-[14.5px] leading-[1.65] text-text-1">
          No cycle is running. Start one and this page becomes the team's morning.
        </p>
        <Link
          to="/teams/$teamId/cycles"
          params={{ teamId }}
          className={cn(
            'mt-3 inline-flex items-center rounded-control px-2 py-1 text-[12.5px] font-semibold text-text-2',
            DOORWAY,
          )}
        >
          <Onward>Cycles</Onward>
        </Link>
      </section>
    )
  }

  const cycle = hero.cycle
  return (
    <section>
      <div className="flex items-start">
        <h1 className="font-heading text-[52px] font-bold leading-none tracking-[-0.032em] text-text-1">
          {cycle.title}
        </h1>
        {membersDoorway}
      </div>
      <div className="mt-[22px]">
        <DayBand segments={cycle.dayBand} />
      </div>
      <div className="mt-2.5 text-[12.5px] text-text-2">
        Day {cycle.dayIndex} of {cycle.dayCount} · ends {cycle.endsWeekday}
      </div>
      <div className="mt-5 grid grid-cols-[1fr_288px] gap-11">
        <div>
          <div className="flex gap-6 text-[15px]">
            <span className="flex items-center gap-[9px] font-medium text-text-1">
              <span aria-hidden="true" className="size-2 flex-none rounded-full bg-status-done" />
              {cycle.statusWords.shipped} shipped
            </span>
            <span className="flex items-center gap-[9px] font-medium text-text-1">
              <span
                aria-hidden="true"
                className="size-2 flex-none rounded-full bg-status-in-review"
              />
              {cycle.statusWords.inReview} in review
            </span>
            {model.attention === null ? null : (
              <span className="flex items-center gap-[9px] font-semibold text-status-urgent-ink">
                <span aria-hidden="true" className="size-2 flex-none rounded-sm bg-status-urgent" />
                <span data-testid="attention-count">{cycle.statusWords.needAttention}</span> need
                attention
              </span>
            )}
          </div>
          {hero.narrative === null ? null : (
            <p className="mt-[18px] text-[14.5px] leading-[1.65] text-text-1">
              {hero.narrative.sentences.join(' ')}
            </p>
          )}
          {cycle.chips.cycleReport || cycle.chips.wrapped ? (
            <div className="mt-[18px] flex items-center gap-2.5">
              {cycle.chips.cycleReport ? (
                <Link
                  to="/teams/$teamId/cycles"
                  params={{ teamId }}
                  className={cn(
                    'inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-border-strong bg-bg-elevated px-2 font-mono text-[11.5px] text-text-1',
                    DOORWAY,
                  )}
                >
                  <CyclesGlyph />
                  Cycle report
                </Link>
              ) : null}
              {cycle.chips.wrapped ? (
                <Link
                  to="/teams/$teamId/retros"
                  params={{ teamId }}
                  className={cn(
                    'inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-border-strong bg-bg-elevated px-2 font-mono text-[11.5px] text-text-1',
                    DOORWAY,
                  )}
                >
                  <RetroGlyph />
                  Wrapped
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <aside className="flex flex-col gap-[18px] self-start border-l border-border pl-7">
          <div>
            <div className="font-mono text-[10px] tracking-[0.1em] text-text-3">
              SCOPE · AGAINST ITS PLAN
            </div>
            <div className="mt-2 flex items-baseline gap-4">
              <span className="flex items-baseline gap-[5px]">
                <span className="text-xl font-bold tracking-[-0.02em] text-text-1">
                  {cycle.scope.committed}
                </span>
                <span className="text-[11px] text-text-2">committed</span>
              </span>
              <span className="flex items-baseline gap-[5px]">
                <span className="text-xl font-bold tracking-[-0.02em] text-text-1">
                  {cycle.scope.landed}
                </span>
                <span className="text-[11px] text-text-2">landed</span>
              </span>
              <span className="flex items-baseline gap-[5px]">
                <span className="text-xl font-bold tracking-[-0.02em] text-status-in-progress">
                  {cycle.scope.added}
                </span>
                <span className="text-[11px] text-text-2">added</span>
              </span>
            </div>
            {cycle.scope.band.length > 0 ? <ScopeBand band={cycle.scope.band} /> : null}
          </div>
          {cycle.next.length > 0 ? (
            <div>
              <div className="font-mono text-[10px] tracking-[0.1em] text-text-3">NEXT</div>
              <div className="mt-2 flex flex-col gap-[9px]">
                {cycle.next.map((ritual) => (
                  <Link
                    key={ritual.retroId}
                    to="/teams/$teamId/retros/$retroId"
                    params={{ teamId, retroId: ritual.retroId }}
                    className={cn(
                      'flex items-center gap-[9px] rounded-control text-[12.5px] text-text-1',
                      DOORWAY,
                    )}
                  >
                    <RetroGlyph className="size-[13px] text-text-2" />
                    <span className="truncate">{ritual.title}</span>
                    <span className="ml-auto font-mono text-[11px] text-text-3">
                      {ritual.phase}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <div className="font-mono text-[11px] text-text-3">
            {cycle.daysLeft} {cycle.daysLeft === 1 ? 'day' : 'days'} left in the cycle
          </div>
        </aside>
      </div>
    </section>
  )
}

function CyclesGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn('size-[13px] text-text-2', className)}
    >
      <circle cx="10" cy="10" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 1.4 V4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5.5" cy="14.5" r="1.9" fill="currentColor" />
    </svg>
  )
}

function RetroGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn('size-[13px] text-text-2', className)}
    >
      <path
        d="M14.5 4.7 A7 7 0 1 0 16.9 8.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M15.4 10.4 L16.9 8.6 L18.6 10.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// NEEDS ATTENTION — four exception classes, each a doorway with drawn evidence (§D2).
// ---------------------------------------------------------------------------

const ATTENTION_ROW =
  'flex h-[50px] items-center gap-3 border-t border-row-hairline px-3 text-[13.5px] text-text-1 last:border-b'

// The divergence class summarises N issues, so it has no single strip; what every one of those
// issues shares is the shape the class is named for — merged, green, and nothing live carrying it.
// The break's position still comes from the divergence kind, not from a hardcoded index.
const DIVERGED_CLASS_STRIP = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: null,
  deployedAt: null,
} as const

function AttentionBand({ attention, teamId }: { attention: TeamHomeAttention; teamId: string }) {
  return (
    <Band>
      <BandHeader title="NEEDS ATTENTION" count={attention.count} countTestId="attention-count" />
      <div className="mt-[18px]">
        {attention.divergence === null ? null : (
          <ClassRow
            teamId={teamId}
            rows={attention.divergence.rows}
            className="bg-urgent-soft font-normal text-status-urgent-ink"
            dot={
              <span aria-hidden="true" className="size-2 flex-none rounded-sm bg-status-urgent" />
            }
            text={
              <span>
                <b className="font-semibold">{attention.divergence.count}</b> done in git, not on
                the board
              </span>
            }
            evidence={
              <RealityTrack
                shape={buildRealityShape(DIVERGED_CLASS_STRIP, {
                  divergence: 'status_behind_merge',
                })}
                label={realityTrackLabel(DIVERGED_CLASS_STRIP, 'Reality ran ahead of the board')}
              />
            }
          />
        )}
        {attention.waitingReview === null ? null : (
          <Link
            to="/teams/$teamId/board"
            params={{ teamId }}
            className={cn(ATTENTION_ROW, DOORWAY)}
          >
            <span
              aria-hidden="true"
              className="size-2 flex-none rounded-sm bg-status-in-progress"
            />
            <span>
              <b className="font-semibold">{attention.waitingReview.count}</b> waiting on review
              over a day
            </span>
            <span className="ml-auto flex items-center gap-[5px] font-mono text-[11px] text-text-3">
              {attention.waitingReview.agesMs.map(formatHomeAge).join(' · ')}
            </span>
            <span className="w-[76px] flex-none text-right font-mono text-[11px] text-text-3">
              Board
            </span>
            <span aria-hidden="true" className="text-[13px] text-text-3">
              ›
            </span>
          </Link>
        )}
        {attention.checksFailing === null ? null : (
          <ClassRow
            teamId={teamId}
            rows={attention.checksFailing.rows}
            dot={
              <span aria-hidden="true" className="size-2 flex-none rounded-sm bg-status-urgent" />
            }
            text={
              <span>
                Checks failing on <b className="font-semibold">{attention.checksFailing.count}</b>{' '}
                {attention.checksFailing.count === 1 ? 'change' : 'changes'}
              </span>
            }
            evidence={
              <>
                <TickBar ticks={attention.checksFailing.rows[0]?.ticks ?? []} />
                {attention.checksFailing.rows[0]?.redForMs == null ? null : (
                  <span className="ml-1.5 font-mono text-[11px] text-text-3">
                    red {formatHomeAge(attention.checksFailing.rows[0].redForMs)}
                  </span>
                )}
              </>
            }
          />
        )}
        {attention.triage === null ? null : (
          <Link
            to="/teams/$teamId/triage"
            params={{ teamId }}
            className={cn(ATTENTION_ROW, DOORWAY)}
          >
            <span
              aria-hidden="true"
              className="size-2 flex-none rounded-full border-[1.5px] border-border-strong"
            />
            <span>
              <b className="font-semibold">{attention.triage.count}</b> new in triage
            </span>
            <span className="ml-auto flex items-center gap-[5px]">
              <TriageDots count={attention.triage.dotCount} />
            </span>
            <span className="w-[76px] flex-none text-right font-mono text-[11px] text-text-3">
              Triage
            </span>
            <span aria-hidden="true" className="text-[13px] text-text-3">
              ›
            </span>
          </Link>
        )}
      </div>
    </Band>
  )
}

// A per-issue class row: one issue links straight to it and shows its key; more than one goes to
// the board, where all of them are visible.
function ClassRow({
  teamId,
  rows,
  className,
  dot,
  text,
  evidence,
}: {
  teamId: string
  rows: readonly { readonly issueKey: string }[]
  className?: string
  dot: ReactNode
  text: ReactNode
  evidence: ReactNode
}) {
  const single = rows.length === 1 ? rows[0] : undefined
  const body = (
    <>
      {dot}
      {text}
      <span className="ml-auto flex items-center gap-[5px]">{evidence}</span>
      <span className="w-[76px] flex-none text-right font-mono text-[11px] text-text-3">
        {single === undefined ? 'Board' : single.issueKey}
      </span>
      <span aria-hidden="true" className="text-[13px] text-text-3">
        ›
      </span>
    </>
  )
  return single === undefined ? (
    <Link
      to="/teams/$teamId/board"
      params={{ teamId }}
      className={cn(ATTENTION_ROW, DOORWAY, className)}
    >
      {body}
    </Link>
  ) : (
    <Link
      to="/teams/$teamId/issues/$issueKey"
      params={{ teamId, issueKey: single.issueKey }}
      className={cn(ATTENTION_ROW, DOORWAY, className)}
    >
      {body}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// SINCE YESTERDAY — cards over a literal trailing 24h window (§D4).
// ---------------------------------------------------------------------------

const CARD = 'relative block rounded-card border border-border bg-bg-elevated px-4 pb-[13px] pt-3.5'

function CardShell({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <>
      <span className="font-mono text-[10px] tracking-[0.1em] text-text-3">{kicker}</span>
      <span aria-hidden="true" className="absolute right-[15px] top-[13px] text-xs text-text-3">
        ›
      </span>
      {children}
    </>
  )
}

function SinceYesterdayBand({ since, teamId }: { since: TeamHomeSinceYesterday; teamId: string }) {
  return (
    <Band>
      <BandHeader
        title="SINCE YESTERDAY"
        count={since.cardCount}
        onward={
          <Link to="/inbox" className={cn('rounded-control px-2 py-1', DOORWAY)}>
            <Onward>Inbox</Onward>
          </Link>
        }
      />
      <div className="mt-[18px] grid grid-cols-3 gap-3.5">
        {since.overnight === null ? null : (
          <Link
            to="/teams/$teamId/delivery"
            params={{ teamId }}
            search={{ window: 6 }}
            className={cn(CARD, DOORWAY)}
          >
            <CardShell kicker="OVERNIGHT">
              <div className="mt-[11px] text-[13.5px] leading-normal">
                {since.overnight.lines.map((line) => (
                  <div
                    key={`${line.atMs}-${line.text}`}
                    className="flex items-center gap-2 py-[3px] text-[13px] text-text-1"
                  >
                    <span
                      aria-hidden="true"
                      className="size-[7px] flex-none rounded-full bg-status-done"
                    />
                    <span className="truncate">{line.text}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-text-3">
                      {formatClock(line.atMs)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-[11px] font-mono text-[10.5px] text-text-3">
                {since.overnight.provenance}
              </div>
            </CardShell>
          </Link>
        )}
        {since.yourReview === null || since.yourReview.rows[0] === undefined ? null : (
          <Link
            to="/teams/$teamId/issues/$issueKey"
            params={{ teamId, issueKey: since.yourReview.rows[0].issueKey }}
            className={cn(CARD, DOORWAY)}
          >
            <CardShell kicker="YOUR REVIEW">
              <div className="mt-[11px] flex flex-col gap-1.5 text-[13.5px] leading-normal text-text-1">
                {since.yourReview.rows.map((fact) => (
                  <div
                    key={`${fact.issueId}-${fact.state}-${fact.ageMs}`}
                    className="flex items-start gap-[9px]"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 flex-none text-status-in-review"
                    >
                      <circle
                        cx="10"
                        cy="10"
                        r="7"
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity=".28"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M10 3 A7 7 0 1 1 3 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>
                      <b className="font-semibold">{fact.outcome}</b>
                      {fact.state === 'approved' ? " — merge when you're ready." : null}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-[11px] font-mono text-[10.5px] text-text-3">
                {since.yourReview.rows[0].issueKey} ·{' '}
                {formatHomeAge(since.yourReview.rows[0].ageMs)} ago · on your issues
              </div>
            </CardShell>
          </Link>
        )}
        {since.inbox === null ? null : (
          <Link to="/inbox" className={cn(CARD, DOORWAY)}>
            <CardShell kicker="INBOX">
              <div className="mt-[11px] text-[13.5px] leading-normal">
                {since.inbox.rows.slice(0, 3).map((fact) => (
                  <div
                    key={`${fact.kind}-${fact.title}-${fact.ageMs}`}
                    className="flex items-center gap-2 py-[3px] text-[13px] text-text-1"
                  >
                    <span className="truncate">
                      {fact.subjectKey === null ? fact.title : `${fact.subjectKey} — ${fact.title}`}
                    </span>
                    <span className="ml-auto font-mono text-[10.5px] text-text-3">
                      {formatHomeAge(fact.ageMs)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-[11px] font-mono text-[10.5px] text-text-3">
                {since.inbox.count} unread in the last day
              </div>
            </CardShell>
          </Link>
        )}
      </div>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// YOURS — the viewer's own held work; never anyone else's (§D5).
// ---------------------------------------------------------------------------

function YoursBand({
  yours,
  runway,
  teamId,
}: {
  yours: TeamHomeYours
  runway: TeamHomeRunway | null
  teamId: string
}) {
  const empty = yours.count === 0
  return (
    <Band>
      <BandHeader
        title="YOURS"
        count={yours.count}
        onward={
          empty ? (
            runway !== null ? (
              <a href="#ready-for-you" className={cn('rounded-control px-2 py-1', DOORWAY)}>
                <span className="text-[12.5px] font-semibold text-text-2">
                  Runway
                  <span aria-hidden="true" className="ml-[3px] font-normal text-text-3">
                    →
                  </span>
                </span>
              </a>
            ) : undefined
          ) : (
            <How label="yours" align="end" constraint={yours.derivation}>
              {yours.derivationProse}
            </How>
          )
        }
      />
      <div className="mt-[18px]">
        {empty ? (
          <div className="flex h-[47px] items-center gap-2.5 border-y border-row-hairline px-3 text-[13px] text-text-2">
            <span aria-hidden="true" className="text-xs text-status-done">
              ✓
            </span>
            {/* "nothing owed" is a claim, and `noReviewsOwed` is its predicate (§D5) — the clause
                renders only when the model verified it. */}
            <span>
              {yours.noReviewsOwed ? 'Nothing held, nothing owed' : 'Nothing held'}
              {runway === null
                ? '.'
                : ` — the runway has ${runway.count} clear ${runway.count === 1 ? 'start' : 'starts'} when you want one.`}
            </span>
          </div>
        ) : (
          <>
            {yours.rows.map((row) => (
              <Link
                key={row.issueId}
                to="/teams/$teamId/issues/$issueKey"
                params={{ teamId, issueKey: row.issueKey }}
                className={cn(
                  'flex h-[52px] items-center gap-3 border-t border-row-hairline px-3 text-[13.5px] text-text-1 last:border-b',
                  DOORWAY,
                )}
              >
                <StatusGlyph
                  status={STATUS_TO_KIND[row.status]}
                  className={cn('size-3.5', row.sayUrgent && 'text-status-urgent')}
                />
                <span className="w-[62px] flex-none font-mono text-xs text-text-3">
                  {row.issueKey}
                </span>
                <span className="truncate">{row.title}</span>
                <span className="flex-1" />
                {/* The facts, named — not a static string that names none of them. The divergence
                    sentence is omitted because `row.say` states it in visible text beside this,
                    and a screen reader should hear it once. */}
                <RealityTrack
                  shape={buildRealityShape(row.strip, { divergence: row.divergence })}
                  label={realityTrackLabel(row.strip)}
                />
                <span className="flex-none text-right">
                  <span
                    className={cn(
                      'block text-[12.5px] font-semibold text-text-2',
                      row.sayUrgent && 'text-status-urgent-ink',
                    )}
                  >
                    {row.say}
                  </span>
                  {row.git === '' ? null : (
                    <span className="mt-0.5 block font-mono text-[10.5px] text-text-3">
                      {row.git}
                    </span>
                  )}
                </span>
                <span aria-hidden="true" className="w-2.5 text-right text-xs text-text-3">
                  ›
                </span>
              </Link>
            ))}
            {yours.waitingOnOthers === null ? null : (
              <div className="flex h-9 items-center gap-2.5 border-t border-row-hairline px-3 text-[12.5px] text-text-2 last:border-b">
                <span aria-hidden="true" className="text-[10px] text-text-3">
                  ▸
                </span>
                <span>
                  {yours.waitingOnOthers.count} of yours{' '}
                  {yours.waitingOnOthers.count === 1 ? 'is' : 'are'} waiting on others
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-3">
                  review {yours.waitingOnOthers.agesMs.map(formatHomeAge).join(' · ')}
                </span>
              </div>
            )}
            {yours.noReviewsOwed ? (
              <div className="flex h-9 items-center gap-2.5 border-t border-row-hairline px-3 text-[12.5px] text-text-2 last:border-b">
                <span aria-hidden="true" className="text-xs text-status-done">
                  ✓
                </span>
                <span>No reviews owed — nobody is waiting on you</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// READY FOR YOU — the Runway lane only; Crit and Verify fold away (§D6).
// ---------------------------------------------------------------------------

function ReadyBand({ runway, teamId }: { runway: TeamHomeRunway; teamId: string }) {
  return (
    <Band id="ready-for-you">
      <BandHeader title="READY FOR YOU" count={runway.count} />
      <div className="mt-[18px]">
        <div className="flex h-9 items-center gap-[9px] border-t border-row-hairline bg-bg-hover px-3.5 text-[12.5px] font-semibold text-text-1">
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full border-[2.3px] border-status-done"
          />
          Runway
          <span className="font-mono text-[11.5px] font-normal text-text-3">{runway.count}</span>
        </div>
        {runway.rows.map((row) => (
          <Link
            key={row.issueId}
            to="/teams/$teamId/issues/$issueKey"
            params={{ teamId, issueKey: row.issueKey }}
            className={cn(
              'flex h-11 items-center gap-3 border-t border-row-hairline px-3.5 text-[13.5px] text-text-1 last:border-b',
              DOORWAY,
            )}
          >
            <PriorityMark priority={PRIORITY_TO_KIND[row.priority]} className="size-3.5" />
            <span className="w-[62px] flex-none font-mono text-xs text-text-3">{row.issueKey}</span>
            <span className="truncate">{row.title}</span>
            <span className="flex-1" />
            <span
              className={cn(
                'whitespace-nowrap text-[12.5px] text-text-2',
                row.urgent && 'font-semibold text-status-urgent-ink',
              )}
            >
              {row.phrase}
            </span>
            <span aria-hidden="true" className="w-2.5 text-right text-xs text-text-3">
              ›
            </span>
          </Link>
        ))}
      </div>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// SHIP CADENCE + SHIPPED THIS CYCLE (§D7–§D8).
// ---------------------------------------------------------------------------

function CadenceBand({ cadence, teamId }: { cadence: TeamHomeCadence; teamId: string }) {
  return (
    <Band>
      <BandHeader
        title="SHIP CADENCE"
        onward={
          <Link
            to="/teams/$teamId/delivery"
            params={{ teamId }}
            search={{ window: 6 }}
            className={cn('rounded-control px-2 py-1', DOORWAY)}
          >
            <Onward>Delivery</Onward>
          </Link>
        }
      />
      <div className="mt-[18px]">
        <CadenceChart cadence={cadence} />
      </div>
    </Band>
  )
}

function ShippedBand({ shipped }: { shipped: TeamHomeShipped }) {
  const split = Math.ceil(shipped.rows.length / 2)
  const columns = [shipped.rows.slice(0, split), shipped.rows.slice(split)].filter(
    (column) => column.length > 0,
  )
  return (
    <Band>
      <BandHeader title="SHIPPED THIS CYCLE" count={shipped.count} />
      <div className="mt-[18px] grid grid-cols-2 gap-x-11">
        {columns.map((column) => (
          <div key={column[0]?.issueId ?? 'empty'}>
            {column.map((row) => (
              <div
                key={row.issueId}
                className="flex h-10 items-center gap-3 border-t border-row-hairline text-[13.5px] text-text-1 last:border-b"
              >
                <span className="w-[58px] flex-none font-mono text-xs text-text-3">
                  {row.issueKey}
                </span>
                <span className="truncate">{row.title}</span>
                <span className="flex-1" />
                {row.live ? (
                  <span className="flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-semibold text-status-done">
                    <span aria-hidden="true" className="size-[7px] rounded-full bg-status-done" />
                    Live
                  </span>
                ) : (
                  <span className="flex items-center gap-[7px] whitespace-nowrap text-[12.5px] text-text-2">
                    <span
                      aria-hidden="true"
                      className="size-[7px] rounded-full border-[1.5px] border-status-done"
                    />
                    Built — not live
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Band>
  )
}

// ---------------------------------------------------------------------------
// The composed footline and the onward footer (§D9).
// ---------------------------------------------------------------------------

function Footline({ model }: { model: TeamHomeModel }) {
  if (model.footline.length === 0) return null
  return (
    <div className="mt-12">
      <How label="this page" constraint={model.footline.join(' · ')}>
        This page was composed by the rules it actually applied: {model.footline.join(', ')}.
      </How>
    </div>
  )
}

function OnwardFooter({ teamId }: { teamId: string }) {
  const divider = (
    <span aria-hidden="true" className="mx-2.5 font-normal text-border-strong">
      ·
    </span>
  )
  const link = cn('rounded-control', DOORWAY)
  return (
    <div className="mt-4 flex items-center border-t border-border pt-[22px] text-[12.5px] font-semibold text-text-2">
      <Link to="/teams/$teamId/issues" params={{ teamId }} className={link}>
        Issues
        <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
          ›
        </span>
      </Link>
      {divider}
      <Link to="/teams/$teamId/board" params={{ teamId }} className={link}>
        Board
        <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
          ›
        </span>
      </Link>
      {divider}
      <Link
        to="/teams/$teamId/delivery"
        params={{ teamId }}
        search={{ window: 6 }}
        className={link}
      >
        Delivery in full
        <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
          ›
        </span>
      </Link>
      {divider}
      <Link to="/teams/$teamId/retros" params={{ teamId }} className={link}>
        Retro
        <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
          ›
        </span>
      </Link>
      {divider}
      <Link to="/teams/$teamId/roadmap" params={{ teamId }} className={link}>
        Roadmap
        <span aria-hidden="true" className="ml-0.5 font-normal text-text-3">
          ›
        </span>
      </Link>
      <span className="ml-auto flex items-center gap-[7px] text-[12.5px] font-normal text-text-3">
        <kbd className="rounded border border-border-strong bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-3">
          ⌘K
        </kbd>
        goes anywhere
      </span>
    </div>
  )
}
