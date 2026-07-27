import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { CODE_LANGUAGES, canonicalCodeLanguage } from '@yapm/ui/lib/code-languages'

/**
 * The code block's node view. The language control is a NATIVE `<select>` — it is a list of sixteen
 * strings, and a native select is both the keyboard-correct and the screen-reader-correct control
 * for that. Tab inside a code block inserts a tab character, which is what a code block is for, so
 * the selector is reached by tabbing to it from outside the block rather than from within.
 *
 * It lists only REGISTERED grammars, so it never offers a language this bundle cannot highlight.
 */
export function CodeBlockNodeView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  // The CANONICAL name, not the stored one: a ```ts block is a TypeScript block, and a select whose
  // value matches no option renders blank.
  const language = canonicalCodeLanguage((node.attrs as { language?: unknown }).language)

  return (
    <NodeViewWrapper as="div" className="relative" data-testid="rich-text-code-block">
      {editor.isEditable ? (
        <select
          contentEditable={false}
          aria-label="Code language"
          value={language}
          onChange={(event) => updateAttributes({ language: event.target.value })}
          className="absolute top-1.5 right-1.5 rounded-control border border-border bg-bg px-1.5 py-0.5 font-ui text-[11px] text-text-2"
        >
          {CODE_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}
