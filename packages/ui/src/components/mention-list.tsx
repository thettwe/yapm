import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import type { MentionCandidate } from '@yapm/ui/lib/mention-match'
import { cn } from '@yapm/ui/lib/utils'

// Shown when the application marks somebody ineligible but supplies no reason of its own. A
// disabled row must always say something: a name that is present but unusable and silent is worse
// than one that was never offered at all.
export const MENTION_UNAVAILABLE_REASON = "Can't be mentioned here"

export function mentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

/**
 * The movement half of the keyboard contract, kept pure so the popup's owner can call it from a
 * ProseMirror `handleKeyDown` — which must answer synchronously — and so a test can assert it
 * without a DOM. Returns `null` for a key this list does not own, which the caller reads as "not
 * ours, let the editor have it".
 */
export function nextMentionIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

export function mentionEmptyStateText(query: string): string {
  return query.length === 0 ? 'No teammates to mention' : `No teammates match “${query}”`
}

export interface MentionAnnouncementInput {
  items: readonly MentionCandidate[]
  query: string
  activeIndex: number
  /** Bumped each time an accept key was pressed on a disabled option. */
  rejectedCount?: number
  loading?: boolean
}

/**
 * What the polite live region says. Three things have to reach a screen reader: how many names the
 * query left, that a name is present but unusable and why, and that nothing matched at all.
 *
 * `rejectedCount` changes the wording after an accept key landed on a disabled row, because an
 * unchanged live region is not re-announced and silence would read as "it worked".
 */
export function mentionAnnouncement({
  items,
  query,
  activeIndex,
  rejectedCount = 0,
  loading = false,
}: MentionAnnouncementInput): string {
  if (items.length === 0) return loading ? '' : `${mentionEmptyStateText(query)}.`

  const active = items[activeIndex]
  const count = `${items.length} ${items.length === 1 ? 'match' : 'matches'}`
  if (active === undefined) return `${count}.`

  if (!active.eligible) {
    const reason = active.reason ?? MENTION_UNAVAILABLE_REASON
    return rejectedCount > 0
      ? `${active.name} cannot be mentioned: ${reason}. Nothing was inserted.`
      : `${count}. ${active.name}, unavailable: ${reason}.`
  }
  return `${count}. ${active.name}.`
}

export interface MentionListProps {
  id: string
  items: readonly MentionCandidate[]
  query: string
  activeIndex: number
  rejectedCount?: number
  loading?: boolean
  label?: string
  onSelect: (index: number) => void
  onActiveChange?: (index: number) => void
  className?: string
}

/**
 * A bespoke listbox rather than the command-palette primitive: `Command.Input` owns focus, and
 * focus has to stay in the editor for the caret to keep moving while the list is open. So this
 * component takes no focus at all — it is driven entirely by `activeIndex` from the editor, and
 * the editor points `aria-activedescendant` at the active row.
 */
export function MentionList({
  id,
  items,
  query,
  activeIndex,
  rejectedCount = 0,
  loading = false,
  label = 'Mention a teammate',
  onSelect,
  onActiveChange,
  className,
}: MentionListProps) {
  return (
    <div
      className={cn(
        'max-h-64 w-64 overflow-y-auto rounded-card border border-border bg-bg-elevated py-1 font-ui shadow-lg',
        className,
      )}
    >
      <ul
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox of options is exactly a list of items; the rule's suggested div loses that
        role="listbox"
        id={id}
        aria-label={label}
        className="flex flex-col"
      >
        {items.map((item, index) => {
          const active = index === activeIndex
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: an activedescendant option MUST NOT be focusable — focus stays in the editor, which is the whole point of this component
            // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the editor's `handleKeyDown`, not this element's; a key handler here would never fire because it never has focus
            <li
              key={item.id}
              id={mentionOptionId(id, index)}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: `li[role=option]` inside `ul[role=listbox]` is the pattern, not a workaround
              role="option"
              aria-selected={active}
              aria-disabled={item.eligible ? undefined : true}
              data-active={active || undefined}
              // The active row is a soft-accent wash with an accent rule, and its ink stays
              // text-1/text-2: `--accent-strong` over `--accent-soft` measures ~3.9 in three of
              // the six presets, and the row a screen reader calls selected is the one a sighted
              // reader most needs to read. Asserted in `styles/contrast.test.ts`.
              className={cn(
                'flex cursor-default items-center gap-2 border-l-2 px-2 py-1.5 text-[13px] text-text-1 select-none',
                active ? 'border-accent-strong bg-accent-soft' : 'border-transparent',
              )}
              // The caret has to stay put: a mousedown inside the popup would blur the editor and
              // tear the suggestion down before the click ever landed.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActiveChange?.(index)}
              onClick={() => onSelect(index)}
            >
              <Avatar size="xs">
                {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                <AvatarFallback aria-hidden="true">
                  {item.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.name}</span>
                {item.eligible ? (
                  item.email ? (
                    <span
                      className={cn(
                        'truncate font-mono text-[11px]',
                        active ? 'text-text-2' : 'text-text-3',
                      )}
                    >
                      {item.email}
                    </span>
                  ) : null
                ) : (
                  <span className="truncate text-[11px] text-text-2">
                    {item.reason ?? MENTION_UNAVAILABLE_REASON}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {items.length === 0 && !loading ? (
        <p className="px-2 py-2 text-[13px] text-text-2">{mentionEmptyStateText(query)}</p>
      ) : null}

      <span role="status" aria-live="polite" className="sr-only">
        {mentionAnnouncement({ items, query, activeIndex, rejectedCount, loading })}
      </span>
    </div>
  )
}
