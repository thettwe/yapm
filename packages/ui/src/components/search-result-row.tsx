import { SnippetText } from '@yapm/ui/components/snippet-text'
import { cn } from '@yapm/ui/lib/utils'
import {
  CircleDotIcon,
  type LucideIcon,
  MessagesSquareIcon,
  TagIcon,
  TargetIcon,
  TimerIcon,
  UsersIcon,
} from 'lucide-react'
import type { ComponentProps } from 'react'

// The entity vocabulary is a plain string union rather than a schema import, exactly as
// `IssueRow`'s status and priority kinds are: this primitive stays a design-system component that
// knows nothing about queries, teams or permissions, and the application hands it resolved display
// values.
export const SEARCH_RESULT_KINDS = [
  'issue',
  'comment',
  'project',
  'cycle',
  'label',
  'team',
] as const

export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number]

const KIND_GLYPH: Record<SearchResultKind, { icon: LucideIcon; label: string }> = {
  issue: { icon: CircleDotIcon, label: 'Issue' },
  comment: { icon: MessagesSquareIcon, label: 'Comment' },
  project: { icon: TargetIcon, label: 'Project' },
  cycle: { icon: TimerIcon, label: 'Cycle' },
  label: { icon: TagIcon, label: 'Label' },
  team: { icon: UsersIcon, label: 'Team' },
}

// The two states H11 requires results to carry visibly. Both rows are readable, so neither is a
// permission question — search reports what exists and the lists are what curate, which is only
// honest if a result that every list holds out says so on its face.
export const SEARCH_RESULT_STATES = ['triage', 'canceled'] as const

export type SearchResultState = (typeof SEARCH_RESULT_STATES)[number]

const STATE_LABEL: Record<SearchResultState, string> = {
  triage: 'Triage',
  canceled: 'Canceled',
}

export interface SearchResultRowProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  kind: SearchResultKind
  /** Already formatted for display (`ENG-12`); omitted for a result that has no key. */
  issueKey?: string | null
  title: string
  /** Raw `ts_headline` output with its delimiters; rendered as segments, never as markup. */
  snippet?: string | null
  states?: readonly SearchResultState[]
  active?: boolean
}

export function SearchResultRow({
  kind,
  issueKey,
  title,
  snippet,
  states = [],
  active = false,
  className,
  ...props
}: SearchResultRowProps) {
  const glyph = KIND_GLYPH[kind]
  const Glyph = glyph.icon

  return (
    <div
      data-slot="search-result-row"
      data-active={active || undefined}
      // The wash-plus-rule selection idiom the mention typeahead established, and the ink stays
      // `text-1`/`text-2`: `--accent-strong` over `--accent-soft` measures 3.94–3.95 in three of
      // the six preset/mode combinations, so accent-coloured ink on the row a screen reader calls
      // selected would be the row a sighted reader cannot read. Asserted in `styles/contrast.test`.
      className={cn(
        'flex min-h-[var(--density-row)] w-full items-center gap-2.5 border-l-2 px-3 py-1.5 text-left outline-none transition-colors',
        active ? 'border-accent-strong bg-accent-soft' : 'border-transparent',
        className,
      )}
      {...props}
    >
      <span className="flex w-5 shrink-0 justify-center text-text-3">
        <Glyph role="img" aria-label={glyph.label} className="size-3.5" />
      </span>

      {issueKey ? (
        <span className="w-[62px] shrink-0 truncate font-mono text-xs tabular-nums text-text-2">
          {issueKey}
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-ui text-[13.5px] font-medium tracking-[-0.008em] text-text-1">
          {title}
        </span>
        {snippet ? <SnippetText text={snippet} /> : null}
      </span>

      {states.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {states.map((state) => (
            <span
              key={state}
              className="rounded-pill border border-border px-1.5 py-0.5 font-ui text-[10.5px] font-medium whitespace-nowrap text-text-2"
            >
              {STATE_LABEL[state]}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  )
}
