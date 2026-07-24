import {
  EditorContent,
  type Extensions,
  type JSONContent,
  useEditor,
  useEditorState,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button } from '@yapm/ui/components/button'
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
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect } from 'react'

export type RichTextValue = JSONContent

export const richTextExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
  }),
]

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

export interface RichTextEditorProps {
  defaultValue?: JSONContent | null
  editable?: boolean
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
  minHeight?: string
  showToolbar?: boolean
  className?: string
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
  onChange,
  onSubmit,
  onCancel,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: richTextExtensions,
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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (editor) onSubmit(editor.getJSON())
      return
    }
    if (onCancel && event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts wrap the editable region
    <div
      className={cn(
        'rounded-control border border-border bg-bg transition-colors focus-within:border-border-strong',
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
  className,
}: {
  value: JSONContent | null | undefined
  className?: string
}) {
  const editor = useEditor(
    {
      extensions: richTextExtensions,
      content: value ?? EMPTY_DOC,
      editable: false,
      editorProps: { attributes: { class: 'tiptap' } },
    },
    [value],
  )

  return <EditorContent editor={editor} className={cn(contentClass, className)} />
}
