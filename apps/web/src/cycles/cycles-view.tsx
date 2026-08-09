import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  buildCycleRegister,
  buildDeploymentIndex,
  type CycleCarriedIn,
  type CycleCarriedRow,
  type CycleRegisterDigestRow,
  type CycleRegisterIssueRow,
  type CycleRegisterRow,
  DEFAULT_RETRO_FORMAT,
  mutators,
  newId,
  queries,
  type TeamDeploymentRow,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@yapm/ui/components/dialog'
import { CarryChain, ScopeBand } from '@yapm/ui/components/drawn'
import { How } from '@yapm/ui/components/how'
import { Input } from '@yapm/ui/components/input'
import { Label } from '@yapm/ui/components/label'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import { CycleGlyph, StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import type { DigestIssueRow } from '@/cycles/digest'
import { CycleDigestPanel } from '@/cycles/digest-panel'
import { type CycleRowData, currentCycle, formatCycleRange, partitionCycles } from '@/cycles/model'
import { PmDigestShareCard } from '@/cycles/pm-digest-card'
import { Masthead } from '@/frame/masthead'
import { deliveryView, type LinkedIssueRow, linkedEntitiesFor } from '@/issues/delivery'
import { STATUS_TO_KIND } from '@/issues/model'
import { runMutation } from '@/lib/mutation'
import { openRetroArgs } from '@/retro/model'

// CYCLES IS THE REGISTER: one row per cycle, and the work that survived a cycle boundary. Home's
// hero owns "how is this cycle going" and Delivery owns the six-cycle trend, so neither is redrawn
// here. Nothing on this page falls over time — a cycle keeps no status history, and the footnote
// says so once.

const HOW_LEDGER_CONSTRAINT =
  'landed = done · added = assigned after the start date · carry-ins stay committed'

export function CyclesView({ teamId }: { teamId: string }) {
  const navigate = useNavigate()
  const [teams] = useQuery(queries.teams.all())
  const [cyclesRaw, cyclesResult] = useQuery(queries.cycles.byTeam({ teamId }))
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))
  const [retrosRaw] = useQuery(queries.retros.byTeam({ teamId }))
  const [digestsRaw] = useQuery(queries.digests.byTeam({ teamId }))
  const [deployments] = useQuery(queries.deployments.byTeam({ teamId }))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const cycles = useMemo<CycleRowData[]>(
    () =>
      cyclesRaw.map((cycle) => ({
        id: cycle.id,
        number: cycle.number ?? null,
        name: cycle.name,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      })),
    [cyclesRaw],
  )

  const register = useMemo(
    () =>
      buildCycleRegister({
        teamKey,
        cycles,
        issues: issuesRaw as unknown as readonly CycleRegisterIssueRow[],
        retros: retrosRaw as readonly { cycleId?: string | null; closedAt?: number | null }[],
        digests: digestsRaw as unknown as readonly CycleRegisterDigestRow[],
      }),
    [teamKey, cycles, issuesRaw, retrosRaw, digestsRaw],
  )

  // The current cycle is selected on arrival, and the selection then belongs to the reader: it
  // waits on nothing, and completing a cycle does not move it off the row that was acted on.
  const arrival = useMemo(
    () => currentCycle(cycles) ?? partitionCycles(cycles).completed[0] ?? null,
    [cycles],
  )
  useEffect(() => {
    if (selectedId !== null || arrival === null) return
    setSelectedId(arrival.id)
  }, [selectedId, arrival])

  const selected = useMemo(
    () => cycles.find((cycle) => cycle.id === selectedId) ?? arrival,
    [cycles, selectedId, arrival],
  )

  const carriedIn = useMemo(() => register.carriedIn(selected?.id ?? null), [register, selected])

  const deployIndex = useMemo(
    () => buildDeploymentIndex(deployments as readonly TeamDeploymentRow[]),
    [deployments],
  )

  // The digest surface's evidence + scope-delta set: issues still pointing at the cycle PLUS the
  // issues this cycle rolled forward on completion (they now point at the next cycle but carry
  // `rolledOverFromCycleId`). Without the rolled-over set a completed cycle would report carried=0
  // and an undercounted total, since `cycle.complete` re-points its unfinished issues away.
  const selectedRawIssues = useMemo<readonly DigestIssueRow[]>(
    () =>
      selected
        ? (issuesRaw.filter(
            (issue) =>
              (issue.cycleId ?? null) === selected.id ||
              (issue.rolledOverFromCycleId ?? null) === selected.id,
          ) as unknown as readonly DigestIssueRow[])
        : [],
    [issuesRaw, selected],
  )

  const onOpenIssueId = useCallback(
    (issueId: string) => {
      void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: { open: issueId } })
    },
    [navigate, teamId],
  )

  // The report band's own condition, mirrored so its header is never drawn over nothing: the panel
  // renders for a completed cycle, and for a running one only once a digest row exists.
  const reportShown =
    selected !== null &&
    (selected.status === 'completed' ||
      digestsRaw.some((digest) => (digest.cycleId ?? null) === selected.id))

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || cyclesResult.type === 'complete' ? 'No such team.' : 'Loading…'}
      </p>
    )
  }

  return (
    <>
      <Masthead
        title="Cycles"
        count={cycles.length}
        actions={
          <>
            <CompleteCycleButton cycle={selected} cycles={cycles} />
            <NewCycleButton teamId={teamId} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1248px] px-8 pt-6 pb-2">
          <RegisterBand
            rows={register.rows}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />

          {carriedIn === null ? null : (
            <CarriedInBand
              carriedIn={carriedIn}
              issuesRaw={issuesRaw as unknown as readonly RawIssue[]}
              deployIndex={deployIndex}
              onOpenIssue={onOpenIssueId}
            />
          )}

          {selected === null ? null : (
            <>
              {reportShown ? (
                <section className="mt-[34px] border-t border-border pt-[22px]">
                  <div className="flex items-baseline gap-2.5">
                    <h2 className="text-[11px] font-bold tracking-[0.09em] text-text-1">
                      THE LAST REPORT
                    </h2>
                    <span className="font-mono text-xs text-text-3">{selected.name}</span>
                    <span className="font-mono text-[11px] text-text-3">
                      {formatCycleRange(selected.startDate, selected.endDate)}
                    </span>
                    <span className="ml-auto">
                      <RetroEntry teamId={teamId} cycle={selected} cycles={cycles} />
                    </span>
                  </div>
                  <CycleDigestPanel
                    teamId={teamId}
                    cycle={selected}
                    issues={selectedRawIssues}
                    onOpenIssue={onOpenIssueId}
                  />
                </section>
              ) : null}
              {/* Below the report and OUTSIDE its gate: what leaves the team is a different
                  artifact from the team's own digest, and it exists on a running cycle that has
                  no report yet. The card folds itself when the workspace shares nothing. */}
              <PmDigestShareCard cycleId={selected.id} />
            </>
          )}

          {register.rows.length === 0 ? null : <Footnote />}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// THE REGISTER.
// ---------------------------------------------------------------------------

function RegisterBand({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly CycleRegisterRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section className="pt-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[11px] font-bold tracking-[0.09em] text-text-1">THE REGISTER</h2>
        <span className="font-mono text-xs text-text-3" data-testid="register-count">
          {rows.length}
        </span>
        <span className="ml-auto">
          <How label="the ledger" constraint={HOW_LEDGER_CONSTRAINT} align="end">
            Completing a cycle stamps each unfinished issue with the cycle it left, and that stamp
            is overwritten the next time the issue moves — so only the latest completed cycle can
            still name what it committed to. Older rows read what landed and claim no total.
          </How>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="pt-4 text-[12.5px] text-text-3" role="status" data-testid="register-empty">
          No cycles yet
        </p>
      ) : (
        <div className="mt-3">
          {rows.map((row) => (
            <RegisterRow
              key={row.cycleId}
              row={row}
              selected={row.cycleId === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// Arrows move focus between rows; `Enter` / `Space` is the button's own selection. Nothing here
// waits on the network, so the report and the carry band re-point in the same frame.
function moveByArrow(event: ReactKeyboardEvent<HTMLButtonElement>, selector: string) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const container = event.currentTarget.parentElement
  if (container === null) return
  const items = [...container.querySelectorAll<HTMLElement>(selector)]
  const index = items.indexOf(event.currentTarget)
  if (index === -1) return
  event.preventDefault()
  items[event.key === 'ArrowDown' ? index + 1 : index - 1]?.focus()
}

function RegisterRow({
  row,
  selected,
  onSelect,
}: {
  row: CycleRegisterRow
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-register-row
      data-testid="register-row"
      data-cycle-id={row.cycleId}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(row.cycleId)}
      onKeyDown={(event) => moveByArrow(event, '[data-register-row]')}
      className={cn(
        'grid h-11 w-full grid-cols-[16px_78px_minmax(120px,1fr)_128px_190px_130px_200px] items-center gap-x-3.5 border-t border-l-[3px] border-l-transparent border-row-hairline px-3 pl-[9px] text-left outline-none last:border-b hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        selected && 'border-l-accent bg-bg-selected',
      )}
    >
      <span className="flex">
        <CycleGlyph kind={row.glyph} className="size-[15px]" />
      </span>
      {/* The mock inks the selected key with the accent; `--accent-strong` measures 3.84–4.38 on
          `--bg-selected` in two presets, so the key follows the issue row's own resolution — the
          ink steps to `--text-1` and the rail plus the tint carry the state. */}
      <span className={cn('font-mono text-xs', selected ? 'text-text-1' : 'text-text-2')}>
        {row.key}
      </span>
      <span className="truncate text-[13.5px] text-text-1">{row.name}</span>
      {/* 11px mono dates are a FACT on a dense row, so they take `--text-2` rather than the mock's
          `--text-3`, which measures 2.43–3.70 on the grounds a row is painted. Same trade the
          reality rail's mono fact line already made. */}
      <span className="font-mono text-[11px] text-text-2">
        {formatCycleRange(row.startDate, row.endDate)}
      </span>
      {row.ledger === null ? (
        <span />
      ) : (
        <span
          role="img"
          aria-label={row.ledger.label}
          className="flex items-center gap-2.5"
          data-testid="register-ledger"
        >
          <span className="w-[118px]">
            <ScopeBand band={row.ledger.band} size="row" />
          </span>
          <span className="whitespace-nowrap font-mono text-[11px] text-text-2">
            {row.ledger.reading}
          </span>
        </span>
      )}
      <span className="whitespace-nowrap text-[12.5px] text-text-2">
        {row.carriedForward === 0 ? null : `${row.carriedForward} carried forward`}
      </span>
      <span className="flex items-center justify-end gap-[7px]">
        {row.chips.cycleReport ? (
          <ArtifactChip glyph={<ReportGlyph />} label="Cycle report" />
        ) : null}
        {row.chips.wrapped ? <ArtifactChip glyph={<RetroGlyph />} label="Wrapped" /> : null}
      </span>
    </button>
  )
}

// A chip is drawn only where the artifact EXISTS; an empty slot draws no ink rather than repeating
// a "no digest" label down the column.
function ArtifactChip({ glyph, label }: { glyph: ReactNode; label: string }) {
  return (
    <span className="inline-flex h-[21px] items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border-strong bg-bg-elevated px-2 font-mono text-[11px] text-text-1">
      {glyph}
      {label}
      <span aria-hidden="true" className="text-text-3">
        ·
      </span>
    </span>
  )
}

function ReportGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3 text-text-2">
      <circle cx="10" cy="10" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 1.4 V4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5.5" cy="14.5" r="1.9" fill="currentColor" />
    </svg>
  )
}

function RetroGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3 text-text-2">
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
// CARRIED IN — the fact no other surface in the product shows.
// ---------------------------------------------------------------------------

interface RawIssue {
  readonly id: string
  readonly issueLinks?: readonly LinkedIssueRow[]
}

function CarriedInBand({
  carriedIn,
  issuesRaw,
  deployIndex,
  onOpenIssue,
}: {
  carriedIn: CycleCarriedIn
  issuesRaw: readonly RawIssue[]
  deployIndex: ReturnType<typeof buildDeploymentIndex>
  onOpenIssue: (issueId: string) => void
}) {
  return (
    <section className="mt-[34px] border-t border-border pt-[22px]" data-testid="carried-in">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[11px] font-bold tracking-[0.09em] text-text-1">CARRIED IN</h2>
        <span className="font-mono text-xs text-text-3">{carriedIn.count}</span>
        {carriedIn.originName === null ? null : (
          <span className="font-mono text-[11px] text-text-3">out of {carriedIn.originName}</span>
        )}
        <span className="ml-auto">
          <How
            label="the chain"
            align="end"
            constraint="solid = named origin · hollow = unnamed hop · accent = this cycle · dotted = before the record"
          >
            One node per cycle boundary the issue crossed, drawn from its carry count alone. Only
            the last hop has a named origin: the column that records it is overwritten every time
            the issue carries again.
          </How>
        </span>
      </div>

      <div className="mt-3">
        {carriedIn.rows.map((row, index) => (
          <CarriedRow
            key={row.issueId}
            row={row}
            links={issuesRaw.find((issue) => issue.id === row.issueId)?.issueLinks}
            deployIndex={deployIndex}
            labelled={index === 0}
            onOpenIssue={onOpenIssue}
          />
        ))}
      </div>
    </section>
  )
}

function CarriedRow({
  row,
  links,
  deployIndex,
  labelled,
  onOpenIssue,
}: {
  row: CycleCarriedRow
  links: readonly LinkedIssueRow[] | undefined
  deployIndex: ReturnType<typeof buildDeploymentIndex>
  labelled: boolean
  onOpenIssue: (issueId: string) => void
}) {
  const phrase = useMemo(
    () => deliveryView({ status: row.status }, linkedEntitiesFor(links, deployIndex)).phrase,
    [row.status, links, deployIndex],
  )

  return (
    <button
      type="button"
      data-testid="carried-row"
      data-issue-id={row.issueId}
      onClick={() => onOpenIssue(row.issueId)}
      onKeyDown={(event) => moveByArrow(event, '[data-testid="carried-row"]')}
      className={cn(
        // A deeply-carried row is washed, never badged and never inked urgent: it is not one of the
        // four attention classes, so it may not add a second attention number.
        'grid h-[46px] w-full grid-cols-[16px_72px_minmax(160px,1fr)_190px_auto_84px] items-center gap-x-3.5 border-t border-l-[3px] border-l-transparent border-row-hairline px-3 pl-[9px] text-left outline-none last:border-b hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        row.deep && 'border-l-status-in-progress bg-carry-soft',
      )}
    >
      <span className="flex">
        <StatusGlyph status={STATUS_TO_KIND[row.status]} />
      </span>
      <span className="font-mono text-xs text-text-3">{row.issueKey}</span>
      <span className="truncate text-[13.5px] text-text-1">{row.title}</span>
      <span className="truncate text-[12.5px]">
        <RestPhraseText phrase={phrase} />
      </span>
      <span className="flex justify-end">
        <CarryChain
          nodes={row.chain.nodes}
          leadIn={row.chain.leadIn}
          originLabel={row.originCycleName}
          labelled={labelled}
        />
      </span>
      {/* The deep row's count is NOT amber ink on the amber wash: `--status-in-progress-ink`
          measures 4.42 against `--carry-soft` in focused light, under AA. The wash and the left
          rail carry the depth; the count carries the fact, so the count keeps the readable ink. */}
      <span
        className={cn(
          'text-right font-mono text-[11.5px]',
          row.deep ? 'font-medium text-text-1' : 'text-text-2',
        )}
      >
        {row.fact}
      </span>
      <span className="sr-only">{row.say}</span>
    </button>
  )
}

function Footnote() {
  return (
    <div className="mt-[34px] border-t border-row-hairline">
      <div className="max-w-[660px] py-[26px] text-[12.5px] leading-[1.6] text-text-2">
        <b className="text-text-1">What this page won't guess:</b> a cycle keeps no status history,
        so nothing here burns down.{' '}
        <How label="the burndown refusal" constraint="no issue status history is stored">
          A burndown needs to know when each issue changed state. Nothing records that — an issue
          carries one timestamp for its last human status change, which cannot reconstruct a series.
          Every number on this page is a count of today's rows.
        </How>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The write controls — unchanged behaviour, moved into band 2 and the report header.
// ---------------------------------------------------------------------------

// The retro that hangs off a completed cycle. The scheduled maintenance pass opens one too and
// `retro.openForCycle` no-ops when the cycle already has a retro, so the two never race into a
// second row — the unique index on `cycle_id` is the backstop.
function RetroEntry({
  teamId,
  cycle,
  cycles,
}: {
  teamId: string
  cycle: CycleRowData
  cycles: readonly CycleRowData[]
}) {
  const zero = useZero()
  const navigate = useNavigate()
  const { canWrite } = useMembership()
  const [retros] = useQuery(queries.retros.byTeam({ teamId }))

  if (cycle.status !== 'completed') return null

  const existing = (retros as readonly { id: string; cycleId?: string | null }[]).find(
    (retro) => (retro.cycleId ?? null) === cycle.id,
  )

  if (existing) {
    return (
      <Link
        to="/teams/$teamId/retros/$retroId"
        params={{ teamId, retroId: existing.id }}
        data-testid="cycle-retro-link"
        className="rounded-control px-2 py-1 text-[12.5px] font-semibold text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
      >
        Retrospective
        <span aria-hidden="true" className="ml-[3px] font-normal text-text-3">
          ›
        </span>
      </Link>
    )
  }

  if (!canWrite) return null

  return (
    <Button
      size="sm"
      variant="ghost"
      data-testid="cycle-open-retro"
      onClick={() => {
        void openRetroFor(zero, cycles, cycle).then(({ retroId, failure }) => {
          if (failure !== undefined) return
          void navigate({ to: '/teams/$teamId/retros/$retroId', params: { teamId, retroId } })
        })
      }}
    >
      Open a retrospective
    </Button>
  )
}

async function openRetroFor(
  zero: ReturnType<typeof useZero>,
  cycles: readonly CycleRowData[],
  cycle: CycleRowData,
): Promise<{ retroId: string; failure: string | undefined }> {
  const args = openRetroArgs(cycle, cycles, DEFAULT_RETRO_FORMAT)
  const failure = await runMutation(zero.mutate(mutators.retro.openForCycle(args)))
  return { retroId: args.id, failure }
}

function CompleteCycleButton({
  cycle,
  cycles,
}: {
  cycle: CycleRowData | null
  cycles: readonly CycleRowData[]
}) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const [error, setError] = useState<string | undefined>(undefined)

  if (!canWrite || cycle === null || cycle.status === 'completed') return null

  // Completing a cycle also opens its retrospective, minting the retro and column ids here at the
  // call site. The scheduled maintenance pass does the same, and the mutator no-ops when the cycle
  // already has one, so the button racing the scheduler still yields exactly one retro.
  async function complete(target: CycleRowData) {
    const failure = await runMutation(
      zero.mutate(mutators.cycle.complete({ id: target.id, updatedAt: Date.now() })),
    )
    if (failure !== undefined) {
      setError(failure)
      return
    }
    const retro = await openRetroFor(zero, cycles, target)
    setError(retro.failure)
  }

  return (
    <div className="flex items-center gap-2">
      {error !== undefined ? (
        <span className="text-xs text-status-urgent" role="alert">
          {error}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void complete(cycle)}
        data-testid="complete-cycle"
      >
        Complete cycle
      </Button>
    </div>
  )
}

function NewCycleButton({ teamId }: { teamId: string }) {
  const { canWrite } = useMembership()
  const zero = useZero()
  const nameId = useId()
  const startId = useId()
  const endId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function reset() {
    setName('')
    setStart('')
    setEnd('')
    setError(undefined)
  }

  if (!canWrite) return null

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const startDate = Date.parse(start)
    const endDate = Date.parse(end)
    if (name.trim().length === 0 || Number.isNaN(startDate) || Number.isNaN(endDate)) {
      setError('Name and both dates are required.')
      return
    }
    setError(undefined)
    setBusy(true)
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(
        mutators.cycle.create({
          id: newId(),
          teamId,
          name: name.trim(),
          startDate,
          endDate,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )
    setBusy(false)
    if (failure !== undefined) {
      setError(failure)
      return
    }
    reset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" aria-label="New cycle" data-testid="new-cycle">
            + New cycle
          </Button>
        }
      />
      <DialogContent initialFocus>
        <DialogTitle>New cycle</DialogTitle>
        <DialogDescription>
          A cycle is a time-boxed iteration. Set a name and a start and end date.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={create} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Cycle name</Label>
            <Input
              id={nameId}
              aria-label="Cycle name"
              autoComplete="off"
              placeholder="Cycle name…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={startId}>Start date</Label>
            <Input
              id={startId}
              type="date"
              aria-label="Start date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={endId}>End date</Label>
            <Input
              id={endId}
              type="date"
              aria-label="End date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
          {error !== undefined ? (
            <p className="text-xs text-status-urgent" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              Create cycle
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
