import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { useZero } from '@rocicorp/zero/react'
import {
  DELIVERY_PREDICATES,
  type DeliveryPredicate,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueFilter,
  type IssueGrouping,
  type IssuePriority,
  type IssueSort,
  type IssueSortKey,
  type IssueStatus,
  mutators,
  newId,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Input } from '@yapm/ui/components/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@yapm/ui/components/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@yapm/ui/components/popover'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import { CheckIcon, PlusIcon } from 'lucide-react'
import { type ReactNode, useCallback, useId, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { cycleKey } from '@/cycles/model'
import { Masthead } from '@/frame/masthead'
import {
  DEFAULT_GROUPING,
  type ListGrouping,
  NO_CYCLE,
  NO_PROJECT,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
  UNASSIGNED,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

// Band 2 for BOTH lenses on Issues. One implementation, imported by the list and by the board:
// four e2e specs drive these axes by their accessible names, and a second bar over one filter
// model is how two vocabularies start.

const GROUPING_LABEL: Record<ListGrouping, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  cycle: 'Cycle',
  project: 'Project',
  none: 'No grouping',
}

// The three reality-derived predicates. A team with no connector still sees all three offered:
// where a predicate has no linked data it matches nothing rather than being hidden, so the axis
// never implies the facts do not exist.
const DELIVERY_LABEL: Record<DeliveryPredicate, string> = {
  'blocked-on-review': 'Blocked on review',
  'failing-ci': 'Failing CI',
  'merged-not-deployed': 'Merged, not deployed',
}

const SORT_LABEL: Record<IssueSortKey, string> = {
  priority: 'Priority',
  status: 'Status',
  assignee: 'Assignee',
  updated: 'Last updated',
  created: 'Created',
  number: 'Number',
}

// The quiet register for the two native `<select>`s the bar keeps: transparent, borderless, and —
// because the base Select indicates focus with the very border and ring this strips — carrying the
// same focus outline the neighbouring plain-text triggers do. `outline-solid` is not decoration:
// the base sets `outline-none`, which pins `--tw-outline-style` to `none` on the element, so an
// outline width alone would draw nothing and the control would focus invisibly.
const QUIET_SELECT =
  'h-6 w-auto rounded-none border-0 bg-transparent py-0 pr-5 pl-0 text-[12.5px] text-text-2 shadow-none focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent'

// The mock's `≔` — the filter axes' shared mark, drawn once at the head of the row. Decorative:
// each axis carries its own accessible name.
function FilterMark() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 14 14"
      className="flex-none text-text-3"
    >
      <path
        d="M2 3.5h10M3.5 7h7M5.5 10.5h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface TeamMemberOption {
  id: string
  name: string
}

export interface CycleOption {
  id: string
  name: string
  number: number | null
}

export interface ProjectOption {
  id: string
  name: string
}

export interface FilterBarProps {
  count: number
  lens?: ReactNode
  filter: IssueFilter
  setFilter: (next: IssueFilter) => void
  grouping: ListGrouping
  sort: IssueSort
  memberOptions: readonly TeamMemberOption[]
  labelOptions: readonly { id: string; name: string; color: string }[]
  cycleOptions: readonly CycleOption[]
  cycleFilter: readonly (string | null)[] | undefined
  setCycleFilter: (next: readonly (string | null)[] | undefined) => void
  projectOptions: readonly ProjectOption[]
  projectFilter: readonly (string | null)[] | undefined
  setProjectFilter: (next: readonly (string | null)[] | undefined) => void
  savedViews: readonly {
    id: string
    name: string
    filter: unknown
    grouping: unknown
    sort: unknown
  }[]
  applySavedView: (view: { filter: unknown; grouping: unknown; sort: unknown }) => void
  teamId: string
  onNewIssue: () => void
  // The one thing the two lenses do NOT share. The list ends the row with its Group and Sort
  // controls; the board ends it with a statement, because a board's vertical order is the manual
  // rank and its horizontal grouping IS the status enum — neither control has anything to act on.
  trailing: ReactNode
}

export function FilterBar({
  lens,
  count,
  filter,
  setFilter,
  grouping,
  sort,
  memberOptions,
  labelOptions,
  cycleOptions,
  cycleFilter,
  setCycleFilter,
  projectOptions,
  projectFilter,
  setProjectFilter,
  savedViews,
  applySavedView,
  teamId,
  onNewIssue,
  trailing,
}: FilterBarProps) {
  const patch = (next: Partial<IssueFilter>) => setFilter({ ...filter, ...next })

  return (
    <Masthead
      // The deck one band above already reads the team; repeating it here is a word the diet does
      // not pay for, and Board's masthead already reads `Issues`.
      title="Issues"
      count={count}
      {...(lens === undefined ? {} : { lens })}
      actions={
        <>
          <SavedViewControls
            teamId={teamId}
            filter={filter}
            grouping={grouping}
            sort={sort}
            savedViews={savedViews}
            applySavedView={applySavedView}
          />
          <Button size="sm" onClick={onNewIssue} data-testid="new-issue">
            <PlusIcon />
            New issue
          </Button>
        </>
      }
      meta={
        <div className="-mt-0.5 flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          <FilterMark />

          <FilterMenu
            label="Status"
            options={ISSUE_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABEL[status],
              icon: <StatusGlyph status={STATUS_TO_KIND[status]} />,
            }))}
            selected={(filter.status ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                status: toggle(
                  filter.status as readonly IssueStatus[] | undefined,
                  value as IssueStatus,
                ),
              })
            }
          />
          <FilterMenu
            label="Priority"
            options={ISSUE_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABEL[priority],
              icon: <PriorityMark priority={PRIORITY_TO_KIND[priority]} />,
            }))}
            selected={(filter.priority ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                priority: toggle(
                  filter.priority as readonly IssuePriority[] | undefined,
                  value as IssuePriority,
                ),
              })
            }
          />
          <FilterMenu
            label="Assignee"
            options={[
              { value: UNASSIGNED, label: 'Unassigned' },
              ...memberOptions.map((member) => ({ value: member.id, label: member.name })),
            ]}
            selected={(filter.assigneeIds ?? []).map((id) => id ?? UNASSIGNED)}
            onToggle={(value) => {
              const real = value === UNASSIGNED ? null : value
              patch({ assigneeIds: toggle(filter.assigneeIds, real) })
            }}
          />
          <FilterMenu
            label="Delivery"
            options={DELIVERY_PREDICATES.map((predicate) => ({
              value: predicate,
              label: DELIVERY_LABEL[predicate],
            }))}
            selected={(filter.delivery ?? []) as readonly string[]}
            onToggle={(value) =>
              patch({
                delivery: toggle(
                  filter.delivery as readonly DeliveryPredicate[] | undefined,
                  value as DeliveryPredicate,
                ),
              })
            }
          />
          {labelOptions.length > 0 ? (
            <FilterMenu
              label="Label"
              options={labelOptions.map((label) => ({
                value: label.id,
                label: label.name,
                icon: (
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                ),
              }))}
              selected={filter.labelIds ?? []}
              onToggle={(value) => patch({ labelIds: toggle(filter.labelIds, value) })}
            />
          ) : null}
          {cycleOptions.length > 0 ? (
            <FilterMenu
              label="Cycle"
              options={[
                { value: NO_CYCLE, label: 'No cycle' },
                ...cycleOptions.map((cycle) => ({
                  value: cycle.id,
                  label: `${cycle.name} · ${cycleKey(cycle)}`,
                })),
              ]}
              selected={(cycleFilter ?? []).map((id) => id ?? NO_CYCLE)}
              onToggle={(value) => {
                const real = value === NO_CYCLE ? null : value
                setCycleFilter(toggle(cycleFilter, real))
              }}
            />
          ) : null}
          {projectOptions.length > 0 ? (
            <FilterMenu
              label="Project"
              options={[
                { value: NO_PROJECT, label: 'No project' },
                ...projectOptions.map((project) => ({ value: project.id, label: project.name })),
              ]}
              selected={(projectFilter ?? []).map((id) => id ?? NO_PROJECT)}
              onToggle={(value) => {
                const real = value === NO_PROJECT ? null : value
                setProjectFilter(toggle(projectFilter, real))
              }}
            />
          ) : null}

          {/* The mock draws no search field — ⌘K carries search in band 1. Cutting the field
              would cut a capability, so it stays, quiet: no border, no icon, no width it does not
              need. */}
          <Input
            aria-label="Search issues"
            placeholder="Search…"
            value={filter.text ?? ''}
            onChange={(event) => patch({ text: event.target.value || undefined })}
            className="h-6 w-32 rounded-none border-0 border-b border-transparent bg-transparent px-0 text-[12.5px] shadow-none placeholder:text-text-3 focus-visible:border-b-accent focus-visible:ring-0"
          />

          <div className="ml-auto flex items-center gap-1.5 text-text-3">{trailing}</div>
        </div>
      }
    />
  )
}

// Stays a native `<select>` on purpose: `cycles.spec.ts` drives it with `selectOption`, a keyboard
// assertion that already passes, and the mock renders this control as one word. Only the register
// changes — transparent, borderless, the current value bold.
export function GroupSelect({
  grouping,
  setGrouping,
}: {
  grouping: ListGrouping
  setGrouping: (next: ListGrouping) => void
}) {
  return (
    <Select
      aria-label="Group by"
      value={grouping}
      onChange={(event) => setGrouping(event.target.value as ListGrouping)}
      className={cn(QUIET_SELECT, 'font-semibold')}
    >
      {(Object.keys(GROUPING_LABEL) as ListGrouping[]).map((value) => (
        <option key={value} value={value}>
          {GROUPING_LABEL[value]}
        </option>
      ))}
    </Select>
  )
}

// Sort is the one control that could NOT stay a pair of native selects: direction is a toggle, not
// a value list. Key and direction fold into one menu, and the direction's accessible names survive
// as explicit `Sort ascending` / `Sort descending` items.
export function SortMenu({
  sort,
  setSort,
}: {
  sort: IssueSort
  setSort: (next: IssueSort) => void
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Sort by"
            className="rounded-control px-0.5 whitespace-nowrap text-text-3 transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sort <span className="font-semibold text-text-2">{SORT_LABEL[sort.key]}</span>
          </button>
        }
      />
      <MenuContent className="max-h-72 overflow-y-auto">
        {(Object.keys(SORT_LABEL) as IssueSortKey[]).map((value) => (
          <MenuItem
            key={value}
            closeOnClick={false}
            onClick={() => setSort({ ...sort, key: value })}
            className="justify-between"
          >
            {SORT_LABEL[value]}
            {sort.key === value ? <CheckIcon className="size-3.5 text-accent-strong" /> : null}
          </MenuItem>
        ))}
        {(['asc', 'desc'] as const).map((direction) => (
          <MenuItem
            key={direction}
            closeOnClick={false}
            aria-label={`Sort ${direction === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() => setSort({ ...sort, direction })}
            className="justify-between border-border border-t text-text-2"
          >
            {direction === 'asc' ? 'Ascending' : 'Descending'}
            {sort.direction === direction ? (
              <CheckIcon className="size-3.5 text-accent-strong" />
            ) : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function FilterMenu({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: readonly { value: string; label: string; icon?: ReactNode }[]
  selected: readonly string[]
  onToggle: (value: string) => void
}) {
  const selectedSet = new Set(selected)
  const descriptionId = useId()
  // The count beside the trigger is the whole explanation of why a seeded axis renders 3 of 57
  // issues, and drawn alone it is visible only to people who can see it. The accessible NAME stays
  // verbatim — four e2e specs drive it — so the state rides a description instead.
  const description =
    selectedSet.size === 0
      ? 'No filter applied'
      : `${selectedSet.size} of ${options.length} selected`
  return (
    <Menu>
      {/* Plain text, as the mock draws it — the accessible name is what four e2e specs drive, and
          it is preserved verbatim through the re-registering. */}
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Filter by ${label}`}
            aria-describedby={descriptionId}
            className={cn(
              'rounded-control px-0.5 whitespace-nowrap transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              selectedSet.size > 0 ? 'text-text-1' : 'text-text-2',
            )}
          >
            {label}
            {selectedSet.size > 0 ? (
              <span className="ml-1 font-mono text-[10.5px] text-accent-strong">
                {selectedSet.size}
              </span>
            ) : null}
          </button>
        }
      />
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <MenuContent className="max-h-72 overflow-y-auto">
        {options.map((option) => (
          // A toggle set, so each option is a checkbox item: the tick beside it is a drawn glyph,
          // and a drawn glyph is not a state anything but an eye can read.
          <MenuItem
            key={option.value}
            role="menuitemcheckbox"
            aria-checked={selectedSet.has(option.value)}
            closeOnClick={false}
            onClick={() => onToggle(option.value)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
            {selectedSet.has(option.value) ? (
              <CheckIcon className="size-3.5 text-accent-strong" />
            ) : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

function SavedViewControls({
  teamId,
  filter,
  grouping,
  sort,
  savedViews,
  applySavedView,
}: {
  teamId: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
  savedViews: readonly {
    id: string
    name: string
    filter: unknown
    grouping: unknown
    sort: unknown
  }[]
  applySavedView: (view: { filter: unknown; grouping: unknown; sort: unknown }) => void
}) {
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      {savedViews.length > 0 ? (
        <Select
          aria-label="Saved view"
          className={QUIET_SELECT}
          defaultValue=""
          onChange={(event) => {
            const view = savedViews.find((candidate) => candidate.id === event.target.value)
            if (view) applySavedView(view)
          }}
        >
          <option value="">Views</option>
          {savedViews.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </Select>
      ) : null}
      <SaveViewButton teamId={teamId} filter={filter} grouping={grouping} sort={sort} />
    </div>
  )
}

function SaveViewButton({
  teamId,
  filter,
  grouping,
  sort,
}: {
  teamId: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
}) {
  const { canWrite } = useMembership()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const saver = useSaveView()

  if (!canWrite) return null

  async function save() {
    if (name.trim().length === 0) return
    const failure = await saver({ teamId, name: name.trim(), filter, grouping, sort })
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setName('')
    setError(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Save current view"
            className="rounded-control px-0.5 whitespace-nowrap text-[12.5px] text-text-2 transition-colors hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Save view
          </button>
        }
      />
      <PopoverContent className="w-64">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            autoFocus
            aria-label="View name"
            placeholder="View name…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error !== undefined ? (
            <p className="text-xs text-status-urgent" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={name.trim().length === 0}>
            Save view
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function toggle<T>(list: readonly T[] | undefined, value: T): T[] | undefined {
  const current = list ?? []
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  return next.length === 0 ? undefined : next
}

interface SaveViewInput {
  teamId: string
  name: string
  filter: IssueFilter
  grouping: ListGrouping
  sort: IssueSort
}

// Saved views persist only the schema groupings; the web-only cycle/project groupings fall
// back to the default when a view is saved.
function persistableGrouping(grouping: ListGrouping): IssueGrouping {
  return grouping === 'cycle' || grouping === 'project' ? DEFAULT_GROUPING : grouping
}

function useSaveView(): (input: SaveViewInput) => Promise<string | undefined> {
  const zero = useZero()
  return useCallback(
    ({ teamId, name, filter, grouping, sort }) => {
      const now = Date.now()
      return runMutation(
        zero.mutate(
          mutators.savedView.create({
            id: newId(),
            teamId,
            name,
            filter: filter as unknown as ReadonlyJSONValue,
            grouping: persistableGrouping(grouping),
            sort: sort as unknown as ReadonlyJSONValue,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      )
    },
    [zero],
  )
}
