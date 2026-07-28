import type { Editor, Range } from '@tiptap/react'
import { cn } from '@yapm/ui/lib/utils'
import {
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  MinusIcon,
  QuoteIcon,
  TableIcon,
} from 'lucide-react'

/**
 * What a command needs from the surface that hosts it. `pickImage` is the whole of it today: the
 * editor package performs no fetch and knows no API path, so "insert an image" is "ask the host for
 * a file", and the host is the only thing that knows whether there is anywhere to put one.
 */
export interface SlashRunContext {
  pickImage: () => void
  canUpload: boolean
}

export interface SlashCommand {
  readonly id: string
  readonly title: string
  readonly hint: string
  /** Extra words the filter matches, so "bullet" finds the list and "hr" finds the divider. */
  readonly keywords: readonly string[]
  readonly Icon: LucideIcon
  readonly enabled: (editor: Editor, context: SlashRunContext) => boolean
  /**
   * Deletes the trigger range and applies the command in ONE transaction — TipTap's `chain()`
   * accumulates into a single `tr` and dispatches once — so a single Cmd+Z undoes the whole
   * insertion rather than leaving the user staring at a bare `/table`.
   */
  readonly run: (editor: Editor, range: Range, context: SlashRunContext) => void
}

function blockCommand(
  id: string,
  title: string,
  hint: string,
  keywords: readonly string[],
  Icon: LucideIcon,
  apply: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
  can: (editor: Editor) => boolean,
): SlashCommand {
  return {
    id,
    title,
    hint,
    keywords,
    Icon,
    enabled: (editor) => can(editor),
    run: (editor, range) => {
      apply(editor.chain().focus().deleteRange(range)).run()
    },
  }
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  blockCommand(
    'heading2',
    'Heading 2',
    'Section title',
    ['h2', 'title', 'heading', 'large'],
    Heading2Icon,
    (chain) => chain.setNode('heading', { level: 2 }),
    (editor) => editor.can().setNode('heading', { level: 2 }),
  ),
  blockCommand(
    'heading3',
    'Heading 3',
    'Sub-section title',
    ['h3', 'subheading', 'heading', 'small'],
    Heading3Icon,
    (chain) => chain.setNode('heading', { level: 3 }),
    (editor) => editor.can().setNode('heading', { level: 3 }),
  ),
  blockCommand(
    'bulletList',
    'Bullet list',
    'An unordered list',
    ['ul', 'bullet', 'unordered', 'list', 'points'],
    ListIcon,
    (chain) => chain.toggleBulletList(),
    (editor) => editor.can().toggleBulletList(),
  ),
  blockCommand(
    'orderedList',
    'Numbered list',
    'An ordered list',
    ['ol', 'numbered', 'ordered', 'list', 'steps'],
    ListOrderedIcon,
    (chain) => chain.toggleOrderedList(),
    (editor) => editor.can().toggleOrderedList(),
  ),
  blockCommand(
    'quote',
    'Quote',
    'A block quotation',
    ['blockquote', 'citation', 'quote'],
    QuoteIcon,
    (chain) => chain.toggleBlockquote(),
    (editor) => editor.can().toggleBlockquote(),
  ),
  blockCommand(
    'codeBlock',
    'Code block',
    'Syntax-highlighted code',
    ['code', 'pre', 'fence', 'snippet'],
    CodeIcon,
    (chain) => chain.toggleCodeBlock(),
    (editor) => editor.can().toggleCodeBlock(),
  ),
  blockCommand(
    'table',
    'Table',
    'A 3×3 table with a header row',
    ['table', 'grid', 'rows', 'columns'],
    TableIcon,
    (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    // A table inside a table is not reachable in this UI at all, and the cell schema forbids it.
    (editor) => !editor.isActive('table') && editor.can().insertTable({ rows: 3, cols: 3 }),
  ),
  {
    id: 'image',
    title: 'Image',
    hint: 'Upload from this computer',
    keywords: ['image', 'picture', 'photo', 'upload', 'attachment', 'screenshot'],
    Icon: ImageIcon,
    // Disabled rather than hidden when the host cannot upload: a row that says why is more use than
    // a row that was never there, and the reader of a read-only surface should still see the menu
    // is complete.
    enabled: (_editor, context) => context.canUpload,
    run: (editor, range, context) => {
      // The trigger text goes in one transaction NOW; the node — if the upload succeeds at all —
      // arrives in its own, much later. Nothing enters the document while bytes are in flight.
      editor.chain().focus().deleteRange(range).run()
      context.pickImage()
    },
  },
  blockCommand(
    'divider',
    'Divider',
    'A horizontal rule',
    ['hr', 'rule', 'divider', 'separator', 'line'],
    MinusIcon,
    (chain) => chain.setHorizontalRule(),
    (editor) => editor.can().setHorizontalRule(),
  ),
]

export interface SlashOption {
  readonly command: SlashCommand
  readonly disabled: boolean
}

/** Prefix-and-substring match over the title and the keyword list; no fuzzy scoring. */
export function matchSlashCommands(query: string): readonly SlashCommand[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (command) =>
      command.title.toLowerCase().includes(needle) ||
      command.keywords.some((keyword) => keyword.startsWith(needle)),
  )
}

export function slashOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

export function slashEmptyStateText(query: string): string {
  return query.length === 0 ? 'No blocks to insert' : `No block matches “${query}”`
}

/** The copy a disabled row carries, and the same copy the live region reads out. */
export const SLASH_UNAVAILABLE_REASON = "Can't be inserted here"

export interface SlashAnnouncementInput {
  items: readonly SlashOption[]
  query: string
  activeIndex: number
}

export function slashAnnouncement({ items, query, activeIndex }: SlashAnnouncementInput): string {
  if (items.length === 0) return `${slashEmptyStateText(query)}.`
  const active = items[activeIndex]
  const count = `${items.length} ${items.length === 1 ? 'block' : 'blocks'}`
  if (active === undefined) return `${count}.`
  if (active.disabled)
    return `${count}. ${active.command.title}, unavailable: ${SLASH_UNAVAILABLE_REASON}.`
  return `${count}. ${active.command.title}.`
}

export interface SlashListProps {
  id: string
  items: readonly SlashOption[]
  query: string
  activeIndex: number
  label?: string
  onSelect: (index: number) => void
  onActiveChange?: (index: number) => void
  className?: string
}

/**
 * A SEPARATE component from `MentionList`, deliberately, and the two share nothing but
 * `nextRovingIndex`. `MentionList` carries eligibility, a rejection count and per-row "why not"
 * copy sourced from the application; a command list carries none of that and never will. Merging
 * them would turn every one of those into an `undefined`-guarded branch in a component two
 * unrelated surfaces then have to agree about.
 *
 * Like the mention list it takes NO focus: focus stays in the editable so the caret keeps moving,
 * and the editor points `aria-activedescendant` at the active row.
 */
export function SlashList({
  id,
  items,
  query,
  activeIndex,
  label = 'Insert a block',
  onSelect,
  onActiveChange,
  className,
}: SlashListProps) {
  return (
    <div
      className={cn(
        'max-h-64 w-64 overflow-y-auto rounded-card border border-border bg-bg-elevated py-1 font-ui shadow-lg',
        className,
      )}
      data-testid="slash-menu"
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
          const { command } = item
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: an activedescendant option MUST NOT be focusable — focus stays in the editor
            // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the editor's `handleKeyDown`, not this element's
            <li
              key={command.id}
              id={slashOptionId(id, index)}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: `li[role=option]` inside `ul[role=listbox]` is the pattern, not a workaround
              role="option"
              aria-selected={active}
              aria-disabled={item.disabled ? true : undefined}
              data-active={active || undefined}
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
              <command.Icon aria-hidden="true" className="size-4 shrink-0 text-text-2" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{command.title}</span>
                <span className="truncate text-[11px] text-text-2">
                  {item.disabled ? SLASH_UNAVAILABLE_REASON : command.hint}
                </span>
              </span>
            </li>
          )
        })}
      </ul>

      {items.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-text-2">{slashEmptyStateText(query)}</p>
      ) : null}
    </div>
  )
}
