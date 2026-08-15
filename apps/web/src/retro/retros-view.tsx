import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  DEFAULT_RETRO_FORMAT,
  mutators,
  queries,
  type RetroFormat,
  type RetroPhase,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { RetroMark } from '@yapm/ui/components/drawn'
import { cn } from '@yapm/ui/lib/utils'
import { PlusIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  CYCLE_STATUS_LABEL,
  type CycleRowData,
  currentCycle,
  formatCycleRange,
} from '@/cycles/model'
import { Masthead } from '@/frame/masthead'
import { runMutation } from '@/lib/mutation'
import { openRetroArgs, PHASE_LABEL, RETRO_FORMAT_LABEL } from '@/retro/model'

interface RetroSummary {
  id: string
  title: string
  phase: RetroPhase
  format: RetroFormat
  cycleId: string | null
  createdAt: number
}

export function RetrosView({ teamId }: { teamId: string }) {
  const zero = useZero()
  const navigate = useNavigate()
  const { canWrite } = useMembership()
  const [teams] = useQuery(queries.teams.all())
  const [retrosRaw, retrosResult] = useQuery(queries.retros.byTeam({ teamId }))
  const [cyclesRaw] = useQuery(queries.cycles.byTeam({ teamId }))
  const [error, setError] = useState<string | undefined>(undefined)

  const team = teams.find((candidate) => candidate.id === teamId)

  const retros = useMemo<RetroSummary[]>(
    () =>
      (retrosRaw as readonly RetroSummary[]).map((retro) => ({
        id: retro.id,
        title: retro.title,
        phase: retro.phase,
        format: retro.format,
        cycleId: retro.cycleId ?? null,
        createdAt: retro.createdAt,
      })),
    [retrosRaw],
  )

  const cycles = useMemo<CycleRowData[]>(
    () =>
      (
        cyclesRaw as readonly {
          id: string
          number?: number | null
          name: string
          status: CycleRowData['status']
          startDate: number
          endDate: number
        }[]
      ).map((cycle) => ({
        id: cycle.id,
        number: cycle.number ?? null,
        name: cycle.name,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      })),
    [cyclesRaw],
  )

  const withoutRetro = useMemo(
    () =>
      cycles.filter(
        (cycle) =>
          cycle.status === 'completed' && !retros.some((retro) => retro.cycleId === cycle.id),
      ),
    [cycles, retros],
  )

  // Stated only where a cycle exists to state it: a brand-new team has no next boundary, and a
  // sentence naming one it does not have would be the invention this page exists to refuse.
  const nextClose = useMemo(() => {
    const running = currentCycle(cycles)
    if (running === null) return null
    const days = Math.ceil((running.endDate - Date.now()) / 86_400_000)
    if (days < 0) return null
    const when = days <= 0 ? 'today' : days === 1 ? 'in 1 day' : `in ${days} days`
    return `${running.name.toLowerCase()} closes ${when}`
  }, [cycles])

  const open = useCallback(
    async (cycle: CycleRowData) => {
      const args = openRetroArgs(cycle, cycles, DEFAULT_RETRO_FORMAT)
      const failure = await runMutation(zero.mutate(mutators.retro.openForCycle(args)))
      if (failure !== undefined) {
        setError(failure)
        return
      }
      setError(undefined)
      void navigate({
        to: '/teams/$teamId/retros/$retroId',
        params: { teamId, retroId: args.id },
      })
    },
    [cycles, navigate, teamId, zero],
  )

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || retrosResult.type === 'complete'
          ? 'This team no longer exists.'
          : 'Loading team…'}
      </p>
    )
  }

  return (
    <>
      <Masthead
        title="Retros"
        count={retros.length}
        {...(error === undefined
          ? {}
          : {
              meta: (
                <p className="text-xs text-status-urgent-ink" role="alert">
                  {error}
                </p>
              ),
            })}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {retros.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {retros.map((retro) => {
              const cycle = cycles.find((candidate) => candidate.id === retro.cycleId)
              return (
                <li key={retro.id}>
                  {/* One row, one link, and nothing on it that no stored row supports: no
                      participant count, no card count, no per-person figure of any kind. */}
                  <Link
                    to="/teams/$teamId/retros/$retroId"
                    params={{ teamId, retroId: retro.id }}
                    data-testid="retro-link"
                    className={cn(
                      'flex h-[46px] items-center gap-3 rounded-control border border-border border-l-[3px] border-l-accent bg-bg-elevated px-3 outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <RetroMark className="size-3.5 text-text-2" />
                    <span className="text-[13.5px] font-medium text-text-1">{retro.title}</span>
                    {/* The pill's ink is `--text-1`, not `--accent-strong`: over the soft-accent
                        wash that pair lands at 3.94–4.38 in Focused light, Focused dark and
                        Editorial light — the same miss the mention typeahead's active row already
                        learned. The wash is the highlight; the ink stays readable. */}
                    <span className="rounded-pill bg-accent-soft px-[9px] py-0.5 text-[11.5px] font-semibold text-text-1">
                      {PHASE_LABEL[retro.phase]}
                    </span>
                    <span className="text-xs text-text-2">{RETRO_FORMAT_LABEL[retro.format]}</span>
                    {cycle ? (
                      <span className="ml-auto font-mono text-[11px] text-text-2">
                        {formatCycleRange(cycle.startDate, cycle.endDate)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : null}

        {/* The empty state, and the mono fact ONLY where a cycle exists to state one. A team with
            no cycle at all gets the sentence and nothing else — there is no next close to name.
            An index that is already listing retros explains nothing: the rows stand alone. There
            is no create control: a retro is opened FOR a completed cycle, from that cycle's row.

            Empty is not the same fact as not-yet-known, so the two states say different things and
            the sentence waits for completeness — an unhydrated query is not a team with no retros.
            The node itself stays mounted across that swap: a `role="status"` inserted with its
            message already inside it is not reliably spoken, and this is precisely the transition
            (still syncing, then known-empty) that needs announcing. */}
        {retros.length === 0 ? (
          <p
            className="text-[12.5px] text-text-2"
            role="status"
            {...(retrosResult.type === 'complete' ? { 'data-testid': 'retros-quiet' } : {})}
          >
            {retrosResult.type === 'complete' ? (
              <>
                A retro opens when a cycle closes.
                {nextClose === null ? null : (
                  <span className="mt-1.5 block font-mono text-[10.5px] text-text-2">
                    {nextClose}
                  </span>
                )}
              </>
            ) : (
              'Loading…'
            )}
          </p>
        ) : null}

        {/* A cycle owed a retro is a team fact, so a viewer reads the group like everyone else; only
            the control that opens one is a writer's. Hiding the group from a viewer would hide the
            debt itself. */}
        {withoutRetro.length > 0 ? (
          <section className="flex flex-col gap-1.5" aria-label="Cycles without a retrospective">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-2">
              {CYCLE_STATUS_LABEL.completed} without a retrospective
            </h2>
            {withoutRetro.map((cycle) => (
              <div
                key={cycle.id}
                className="flex items-center gap-3 rounded-control border border-dashed border-border px-3 py-2"
              >
                <span className="text-[13px] text-text-2">{cycle.name}</span>
                <span className="font-mono text-[11px] text-text-2">
                  {formatCycleRange(cycle.startDate, cycle.endDate)}
                </span>
                {canWrite ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="ml-auto"
                    data-testid="retro-open-for-cycle"
                    onClick={() => void open(cycle)}
                  >
                    <PlusIcon />
                    Open a retrospective
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </>
  )
}
