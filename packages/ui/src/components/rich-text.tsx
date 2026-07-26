import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention'
import { PluginKey } from '@tiptap/pm/state'
import {
  EditorContent,
  type Extensions,
  type JSONContent,
  mergeAttributes,
  useEditor,
  useEditorState,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { Button } from '@yapm/ui/components/button'
import { MentionList, mentionOptionId, nextMentionIndex } from '@yapm/ui/components/mention-list'
import { type MentionCandidate, matchMentions } from '@yapm/ui/lib/mention-match'
import { cn } from '@yapm/ui/lib/utils'
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  StrikethroughIcon,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export type RichTextValue = JSONContent

export type { MentionCandidate }

// `MentionPluginKey` is NOT exported by @tiptap/extension-mention 3.28 — it survives only in a
// JSDoc `@default`. Every editor instance gets its own EditorState, so one shared key object is
// safe; two plugins with this key in ONE state is what throws `RangeError: Adding different
// instances of a keyed plugin`, and the mention node contributes exactly one.
export const MENTION_PLUGIN_KEY = new PluginKey('yapm-mention')

/** Maps a mentioned user's id to their current display name, from live synced data. */
export type MentionNameLookup = ReadonlyMap<string, string>

// The stored `label` is a HINT, never the truth: nothing stops a crafted document pairing one
// person's id with another person's name, and a display name changes the moment somebody renames
// themselves. So the rendered name comes from the live lookup, and a mention whose id resolves to
// nobody — including every mention when no lookup was supplied at all — degrades to inert text
// rather than asserting a person who may not exist. Safe by default, not by opting in.
function mentionRenderAttrs(
  attrs: Record<string, unknown>,
  resolve: ((id: string) => string | undefined) | undefined,
): { label: string; resolved: boolean } {
  const id = typeof attrs.id === 'string' ? attrs.id : ''
  const stored = typeof attrs.label === 'string' ? attrs.label.trim() : ''
  const live = id === '' ? undefined : resolve?.(id)
  if (live !== undefined && live !== '') return { label: live, resolved: true }
  return { label: stored !== '' ? stored : id, resolved: false }
}

// Tinted wash plus weight rather than accent-coloured ink: `--accent-strong` over `--accent-soft`
// is sub-AA in three of the six presets (asserted in `styles/contrast.test.ts`), and a chip is
// normal-size text in the middle of prose.
const MENTION_CHIP_CLASS = 'rounded-pill bg-accent-soft px-1 py-px font-medium text-text-1'

// The suggestion plugin cannot be switched off: `addProseMirrorPlugins` always instantiates one,
// falling back to the singular `suggestion` option when `suggestions` is empty. So the read-only
// default ships a plugin that can never match.
const INERT_MENTION_SUGGESTION: Omit<
  SuggestionOptions<MentionCandidate, MentionNodeAttrs>,
  'editor'
> = {
  char: '@',
  pluginKey: MENTION_PLUGIN_KEY,
  items: () => [],
  allow: () => false,
}

export interface RichTextExtensionOptions {
  resolveMentionName?: ((id: string) => string | undefined) | undefined
  mentionSuggestion?: Omit<SuggestionOptions<MentionCandidate, MentionNodeAttrs>, 'editor'>
}

/**
 * One extension set for both the editable editor and the read-only renderer, so a document
 * round-tripping through the renderer never loses a mention node.
 */
export function createRichTextExtensions(options: RichTextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
    }),
    Mention.configure({
      // Array-shaped with exactly one entry: `@` addressing one person is all that ships, but a
      // second trigger is an added element rather than a signature change.
      suggestions: [options.mentionSuggestion ?? INERT_MENTION_SUGGESTION],
      // `renderText`/`renderHTML`, never the deprecated `renderLabel`.
      renderText: ({ node }) =>
        `@${mentionRenderAttrs(node.attrs, options.resolveMentionName).label}`,
      renderHTML: ({ options: merged, node }) => {
        const mention = mentionRenderAttrs(node.attrs, options.resolveMentionName)
        const text = `@${mention.label}`
        if (!mention.resolved) return ['span', { 'data-type': 'mention' }, text]
        return [
          'span',
          mergeAttributes(merged.HTMLAttributes, {
            class: MENTION_CHIP_CLASS,
            'aria-label': `Mention: ${mention.label}`,
          }),
          text,
        ]
      },
    }),
  ]
}

export const richTextExtensions: Extensions = createRichTextExtensions()

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function collectText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(collectText).join('')
}

function hasStructuralLeaf(node: JSONContent): boolean {
  if (node.type === 'horizontalRule' || node.type === 'image') return true
  return (node.content ?? []).some(hasStructuralLeaf)
}

export function isRichTextEmpty(value: JSONContent | null | undefined): boolean {
  if (!value) return true
  const nodes = value.content ?? []
  if (nodes.length === 0) return true
  if (nodes.map(collectText).join('').trim().length > 0) return false
  return !nodes.some(hasStructuralLeaf)
}

const contentClass = cn(
  'font-ui text-[13.5px] leading-relaxed text-text-1',
  '[&_.tiptap]:outline-none [&_.tiptap]:min-h-[inherit]',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text-1',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-heading [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-text-1',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:my-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-2',
  '[&_code]:rounded [&_code]:bg-bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-text-1',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-bg-hover [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:text-text-1',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_hr]:my-4 [&_hr]:border-border',
)

export interface RichTextKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  defaultPrevented: boolean
  preventDefault: () => void
}

// ProseMirror's `handleKeyDown` calls `preventDefault()` on a key one of the editor's own
// extensions already consumed, but it does NOT stop React's synthetic bubbling — the event still
// reaches this wrapper. Without the `defaultPrevented` bail-out an inner surface that handles
// Escape to dismiss itself would also cancel the draft, and one that handles Cmd+Enter to commit a
// choice would also submit it: two effects from one keystroke, the second of them destructive.
export function handleRichTextKeyDown(
  event: RichTextKeyEvent,
  handlers: { onSubmit?: (() => void) | undefined; onCancel?: (() => void) | undefined },
): void {
  if (event.defaultPrevented) return

  if (handlers.onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    handlers.onSubmit()
    return
  }
  if (handlers.onCancel && event.key === 'Escape') {
    event.preventDefault()
    handlers.onCancel()
  }
}

interface MentionPopupState {
  items: MentionCandidate[]
  query: string
  activeIndex: number
  rejectedCount: number
  loading: boolean
}

interface MentionHost {
  candidates: () => readonly MentionCandidate[] | undefined
  containerSelector: string
  element: HTMLElement | null
  read: () => MentionPopupState | null
  write: (next: MentionPopupState | null) => void
}

interface MentionController {
  suggestion: Omit<SuggestionOptions<MentionCandidate, MentionNodeAttrs>, 'editor'>
  accept: (index: number) => boolean
  setActive: (index: number) => void
}

function createMentionController(host: MentionHost): MentionController {
  let latest: SuggestionProps<MentionCandidate, MentionNodeAttrs> | null = null
  let unmount: (() => void) | null = null

  function publish(props: SuggestionProps<MentionCandidate, MentionNodeAttrs>): void {
    latest = props
    const previous = host.read()
    const keepIndex =
      previous !== null &&
      previous.query === props.query &&
      previous.activeIndex < props.items.length
    host.write({
      items: props.items,
      query: props.query,
      activeIndex: keepIndex ? previous.activeIndex : 0,
      rejectedCount: 0,
      loading: props.loading,
    })
  }

  function accept(index: number): boolean {
    const state = host.read()
    if (state === null) return false
    const item = state.items[index]
    if (item === undefined) return false
    if (!item.eligible) {
      // Reachable, announced, and inert. Swallowing the key keeps the popup open so the reason
      // stays on screen rather than the draft gaining a stray newline.
      host.write({ ...state, activeIndex: index, rejectedCount: state.rejectedCount + 1 })
      return true
    }
    latest?.command({ id: item.id, label: item.name })
    return true
  }

  function setActive(index: number): void {
    const state = host.read()
    if (state === null || index === state.activeIndex) return
    host.write({ ...state, activeIndex: index, rejectedCount: 0 })
  }

  return {
    accept,
    setActive,
    suggestion: {
      char: '@',
      pluginKey: MENTION_PLUGIN_KEY,
      // Stated rather than inherited from the default: the allowed prefix set is exactly what
      // keeps `someone@example.com` typed in prose from opening the popup mid-word.
      allowedPrefixes: [' ', '('],
      // Mounted INSIDE the editor's own wrapper, not portalled to the body. Load-bearing twice
      // over: it keeps a `[role="listbox"]` in the application's popup-ownership ancestor chain,
      // and it makes `aria-activedescendant` a legal same-subtree IDREF. A body portal breaks both
      // and looks perfect to a sighted developer.
      container: host.containerSelector,
      placement: 'bottom-start',
      allow: ({ state, range }) => {
        if (host.candidates() === undefined) return false
        const type = state.schema.nodes.mention
        if (!type) return false
        const $from = state.doc.resolve(range.from)
        if (!$from.parent.type.contentMatch.matchType(type)) return false
        if ($from.parent.type.spec.code === true) return false
        const code = state.schema.marks.code
        if (
          code &&
          (code.isInSet($from.marks()) !== undefined ||
            state.doc.rangeHasMark(range.from, range.to, code))
        ) {
          return false
        }
        return true
      },
      // An ARRAY, never a promise. This is the whole sub-100ms story: the rows are already
      // replicated to IndexedDB, so a keystroke filters memory rather than waiting on a network.
      items: ({ query }) => matchMentions(host.candidates() ?? [], query),
      render: () => ({
        onStart: (props) => {
          if (host.element !== null) unmount = props.mount(host.element)
          publish(props)
        },
        onUpdate: (props) => publish(props),
        onExit: () => {
          unmount?.()
          unmount = null
          latest = null
          host.write(null)
        },
        onKeyDown: ({ view, event }) => {
          // Escape dismisses the POPUP AND NOTHING ELSE. Returning true makes ProseMirror call
          // `preventDefault()`, which is what the wrapper's `defaultPrevented` guard reads to stand
          // down — without it, dismissing the list also discards the whole draft.
          if (event.key === 'Escape' || event.key === 'Esc') {
            exitSuggestion(view, MENTION_PLUGIN_KEY)
            return true
          }
          const state = host.read()
          if (state === null) return false

          const moved = nextMentionIndex(event.key, state.activeIndex, state.items.length)
          if (moved !== null) {
            host.write({ ...state, activeIndex: moved, rejectedCount: 0 })
            return true
          }
          // Cmd/Ctrl+Enter lands here too, so the submit shortcut accepts the option instead of
          // posting a half-written comment.
          if (event.key === 'Enter' || event.key === 'Tab') return accept(state.activeIndex)
          return false
        },
      }),
    },
  }
}

export interface RichTextEditorProps {
  defaultValue?: JSONContent | null
  editable?: boolean
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
  minHeight?: string
  showToolbar?: boolean
  className?: string
  /**
   * The people the `@` typeahead may offer. Data-agnostic by design: this component knows nothing
   * about teams, queries or permissions, so the application decides who is eligible and why not.
   * Omitted entirely, the popup never opens.
   */
  mentionables?: readonly MentionCandidate[]
  mentionNames?: MentionNameLookup
  onChange?: (doc: JSONContent) => void
  onSubmit?: (doc: JSONContent) => void
  onCancel?: () => void
}

export function RichTextEditor({
  defaultValue,
  editable = true,
  placeholder,
  ariaLabel,
  autoFocus = false,
  minHeight = '2.5rem',
  showToolbar = true,
  className,
  mentionables,
  mentionNames,
  onChange,
  onSubmit,
  onCancel,
}: RichTextEditorProps) {
  // `useId` yields `:r0:`, which is a legal id but not a legal bare CSS selector.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const wrapperId = `yapm-rte-${uid}`
  const listboxId = `${wrapperId}-mentions`

  const mentionablesRef = useRef(mentionables)
  mentionablesRef.current = mentionables
  const mentionNamesRef = useRef(mentionNames)
  mentionNamesRef.current = mentionNames

  const [popup, setPopup] = useState<MentionPopupState | null>(null)
  const popupRef = useRef<MentionPopupState | null>(null)
  const [popupElement] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    const element = document.createElement('div')
    element.style.zIndex = '50'
    return element
  })

  // Built once per editor: the suggestion object is read at plugin-construction time, so it closes
  // over refs rather than over the current render's props.
  const mention = useMemo(
    () =>
      createMentionController({
        candidates: () => mentionablesRef.current,
        containerSelector: `#${wrapperId}`,
        element: popupElement,
        read: () => popupRef.current,
        write: (next) => {
          popupRef.current = next
          setPopup(next)
        },
      }),
    [wrapperId, popupElement],
  )

  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        resolveMentionName: (id) => mentionNamesRef.current?.get(id),
        mentionSuggestion: mention.suggestion,
      }),
    [mention],
  )

  const editor = useEditor({
    extensions,
    content: defaultValue ?? EMPTY_DOC,
    editable,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
        class: 'tiptap',
      },
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON()),
  })

  const isEmpty = useEditorState({
    editor,
    selector: (snapshot) => snapshot.editor?.isEmpty ?? true,
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Set imperatively rather than through `editorProps.attributes`, and that is deliberate: moving
  // the active option dispatches no transaction, so a state-derived attribute would go stale mid
  // navigation. ProseMirror computes the editor's root attributes as an outer node decoration and
  // its patch only removes attributes a previous decoration set, so these three survive a redraw.
  useEffect(() => {
    const dom = editor?.view.dom
    if (dom === undefined) return
    if (popup === null) {
      dom.setAttribute('aria-expanded', 'false')
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
      return
    }
    dom.setAttribute('aria-expanded', 'true')
    dom.setAttribute('aria-controls', listboxId)
    if (popup.items.length === 0) {
      dom.removeAttribute('aria-activedescendant')
    } else {
      dom.setAttribute('aria-activedescendant', mentionOptionId(listboxId, popup.activeIndex))
    }
  }, [editor, popup, listboxId])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleRichTextKeyDown(event, {
      onSubmit: onSubmit && editor ? () => onSubmit(editor.getJSON()) : undefined,
      onCancel,
    })
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts wrap the editable region
    <div
      id={wrapperId}
      className={cn(
        'relative rounded-control border border-border bg-bg transition-colors focus-within:border-border-strong',
        !editable && 'border-transparent bg-transparent',
        className,
      )}
      onKeyDown={onKeyDown}
    >
      {editable && showToolbar ? <Toolbar editor={editor} /> : null}
      <div className="relative px-3 py-2">
        {isEmpty && placeholder ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-3 font-ui text-[13.5px] text-text-3"
          >
            {placeholder}
          </p>
        ) : null}
        <EditorContent editor={editor} className={contentClass} style={{ minHeight }} />
      </div>
      {popupElement !== null && popup !== null
        ? createPortal(
            <MentionList
              id={listboxId}
              items={popup.items}
              query={popup.query}
              activeIndex={popup.activeIndex}
              rejectedCount={popup.rejectedCount}
              loading={popup.loading}
              onSelect={(index) => mention.accept(index)}
              onActiveChange={mention.setActive}
            />,
            popupElement,
          )
        : null}
    </div>
  )
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const active = useEditorState({
    editor,
    selector: (snapshot) => {
      const instance = snapshot.editor
      return {
        bold: instance?.isActive('bold') ?? false,
        italic: instance?.isActive('italic') ?? false,
        strike: instance?.isActive('strike') ?? false,
        code: instance?.isActive('code') ?? false,
        h2: instance?.isActive('heading', { level: 2 }) ?? false,
        h3: instance?.isActive('heading', { level: 3 }) ?? false,
        bullet: instance?.isActive('bulletList') ?? false,
        ordered: instance?.isActive('orderedList') ?? false,
        quote: instance?.isActive('blockquote') ?? false,
      }
    },
  })

  if (!editor || !active) return null

  const items: { key: keyof typeof active; label: string; icon: ReactNode; run: () => void }[] = [
    {
      key: 'bold',
      label: 'Bold',
      icon: <BoldIcon />,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Italic',
      icon: <ItalicIcon />,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'strike',
      label: 'Strikethrough',
      icon: <StrikethroughIcon />,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: 'code',
      label: 'Inline code',
      icon: <CodeIcon />,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      key: 'h2',
      label: 'Heading 2',
      icon: <Heading2Icon />,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      label: 'Heading 3',
      icon: <Heading3Icon />,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bullet',
      label: 'Bullet list',
      icon: <ListIcon />,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      label: 'Numbered list',
      icon: <ListOrderedIcon />,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      label: 'Quote',
      icon: <QuoteIcon />,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
    >
      {items.map((item) => (
        <Button
          key={item.key}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={item.label}
          aria-pressed={active[item.key]}
          className={active[item.key] ? 'bg-accent-soft text-accent-strong' : 'text-text-2'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={item.run}
        >
          {item.icon}
        </Button>
      ))}
    </div>
  )
}

export function RichTextRenderer({
  value,
  mentionNames,
  className,
}: {
  value: JSONContent | null | undefined
  mentionNames?: MentionNameLookup
  className?: string
}) {
  const extensions = useMemo(
    () => createRichTextExtensions({ resolveMentionName: (id) => mentionNames?.get(id) }),
    [mentionNames],
  )

  // `mentionNames` is a dependency because a rename has to reach every already-rendered document:
  // the name is resolved during `renderHTML`, so the read-only editor is rebuilt when the lookup
  // changes. Callers memoise the map, so this is a rare rebuild of a document that holds no draft.
  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_DOC,
      editable: false,
      editorProps: { attributes: { class: 'tiptap' } },
    },
    [value, extensions],
  )

  return <EditorContent editor={editor} className={cn(contentClass, className)} />
}
