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
import { cn } from '@yapm/ui/lib/utils'
import { MessagesSquareIcon, PlusIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { CYCLE_STATUS_LABEL, type CycleRowData, formatCycleRange } from '@/cycles/model'
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-sm font-semibold tracking-tight text-text-1">Retrospectives</h1>
        <span className="font-mono text-xs text-text-3">{retros.length}</span>
      </header>

      {error !== undefined ? (
        <p className="text-xs text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      {retros.length === 0 ? (
        <p className="text-sm text-text-3" role="status">
          No retrospectives yet. One opens automatically when a cycle completes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {retros.map((retro) => {
            const cycle = cycles.find((candidate) => candidate.id === retro.cycleId)
            return (
              <li key={retro.id}>
                <Link
                  to="/teams/$teamId/retros/$retroId"
                  params={{ teamId, retroId: retro.id }}
                  data-testid="retro-link"
                  className={cn(
                    'flex items-center gap-2 rounded-card border border-border bg-bg-elevated px-3 py-2.5 outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  <MessagesSquareIcon className="size-3.5 text-text-3" />
                  <span className="text-[13.5px] font-medium text-text-1">{retro.title}</span>
                  <span className="rounded-full bg-bg-sidebar px-2 py-0.5 text-[11px] font-medium text-text-2">
                    {PHASE_LABEL[retro.phase]}
                  </span>
                  <span className="text-[11.5px] text-text-3">
                    {RETRO_FORMAT_LABEL[retro.format]}
                  </span>
                  {cycle ? (
                    <span className="ml-auto font-mono text-[11px] text-text-3">
                      {formatCycleRange(cycle.startDate, cycle.endDate)}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && withoutRetro.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label="Cycles without a retrospective">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {CYCLE_STATUS_LABEL.completed} without a retrospective
          </h2>
          {withoutRetro.map((cycle) => (
            <div
              key={cycle.id}
              className="flex items-center gap-2 rounded-card border border-dashed border-border px-3 py-2"
            >
              <span className="text-[13px] text-text-2">{cycle.name}</span>
              <span className="font-mono text-[11px] text-text-3">
                {formatCycleRange(cycle.startDate, cycle.endDate)}
              </span>
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
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
