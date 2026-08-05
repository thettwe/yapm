import { useQuery } from '@rocicorp/zero/react'
import { DELIVERY_WINDOW_SIZES, type DeliveryWindowSize, queries } from '@yapm/schema'
import { Label } from '@yapm/ui/components/label'
import { Select } from '@yapm/ui/components/select'
import { useId, useMemo } from 'react'
import { MetricSection } from '@/delivery/metric-tiles'
import type { SeedCycleRow, SeedIssueRow } from '@/delivery/rows'
import { buildTeamDeliveryFor } from '@/delivery/window-model'

// The team's delivery metrics, out of the one retro they were reachable from. Same formulas, same
// tiles, wider scope: a rolling window of completed cycles rather than a single one.
//
// Computed entirely on the client from rows the issue list already syncs — Zero has no aggregates,
// and reaching for a server aggregate here would put a network wait in front of a common
// interaction. Changing the window re-runs a pure function over rows already in memory.
//
// Team-level only, at every depth: no per-person breakdown, no filter, no drill-down, no tooltip.
// `DeliveryWindow` has nowhere to put a person, which is what makes that structural rather than a
// promise this file keeps.

export interface DeliveryViewProps {
  teamId: string
  size: DeliveryWindowSize
  onSizeChange: (size: DeliveryWindowSize) => void
}

export function DeliveryView({ teamId, size, onSizeChange }: DeliveryViewProps) {
  const sizeId = useId()
  const [teams] = useQuery(queries.teams.all())
  const [cyclesRaw, cyclesResult] = useQuery(queries.cycles.byTeam({ teamId }))
  // The substrate: the team's issues with their linked delivery subtree, already the issue list's
  // and the retro panel's query. This view adds no query surface at all.
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))

  const team = teams.find((candidate) => candidate.id === teamId)

  const delivery = useMemo(
    () =>
      buildTeamDeliveryFor(
        cyclesRaw as readonly SeedCycleRow[],
        issuesRaw as readonly SeedIssueRow[],
        size,
      ),
    [cyclesRaw, issuesRaw, size],
  )

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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold tracking-tight text-text-1">Delivery</h1>
          <p className="text-[11.5px] text-text-2" data-testid="delivery-window-label">
            {delivery === null ? 'No completed cycles yet' : delivery.label}
          </p>
        </div>
        <div className="ml-auto flex flex-col gap-1">
          <Label htmlFor={sizeId} className="text-[11px] text-text-3">
            Window
          </Label>
          <Select
            id={sizeId}
            value={String(size)}
            data-testid="delivery-window-size"
            className="h-7 w-40"
            onChange={(event) => onSizeChange(Number(event.target.value) as DeliveryWindowSize)}
          >
            {DELIVERY_WINDOW_SIZES.map((option) => (
              <option key={option} value={option}>
                Last {option} cycles
              </option>
            ))}
          </Select>
        </div>
      </header>

      <p className="max-w-3xl text-[11.5px] leading-relaxed text-text-2">
        Team-level trends from this team's own work, computed from cycles and linked pull requests.
        Never a per-person number. The cycle in progress is excluded — a half-finished cycle would
        read as a decline that is only the calendar.
      </p>

      {delivery === null ? (
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
        <div className="flex flex-col gap-3">
          {delivery.sections.map((section) => (
            <MetricSection
              key={section.key}
              section={section}
              sectionTestId="delivery-section"
              emptyTestId="delivery-empty-section"
              testId="delivery-widget"
              sparklineTestId="delivery-sparkline"
              noTrendTestId="delivery-no-trend"
              headingLevel={2}
              deltaBasis={`the previous ${delivery.cycleCount} cycles`}
            />
          ))}
        </div>
      )}

      <NotShownYet />
    </div>
  )
}

// Permanent, not dismissible and not a tooltip. A page showing five flow metrics under a
// DORA-adjacent heading and saying nothing is implying four keys it does not have; naming the three
// that are missing, and the one that is only half here, is cheaper than the reader assuming.
function NotShownYet() {
  return (
    <section
      className="max-w-3xl rounded-card border border-border bg-bg-sidebar/40 px-3 py-2.5"
      aria-labelledby="delivery-gaps-heading"
      data-testid="delivery-gaps"
    >
      <h2
        id="delivery-gaps-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2"
      >
        What this doesn't show yet
      </h2>
      <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px] leading-relaxed text-text-3">
        <li>
          <span className="font-medium text-text-2">Lead time for changes</span> is partial: PR
          cycle time is measured open to merge only. Commit to deploy is not measured.
        </li>
        <li>
          <span className="font-medium text-text-2">Deployment frequency</span> is absent. It needs
          durable deploy history, which is being built; it lands here in a later change.
        </li>
        <li>
          <span className="font-medium text-text-2">Change failure rate</span> and{' '}
          <span className="font-medium text-text-2">time to restore</span> are absent. Both need an
          incident record that yapm does not have yet.
        </li>
      </ul>
    </section>
  )
}
