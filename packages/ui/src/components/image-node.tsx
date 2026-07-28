import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { cn } from '@yapm/ui/lib/utils'
import { ImageOffIcon } from 'lucide-react'
import { useState } from 'react'

export type AttachmentSrcResolver = (attachmentId: string, variant: 'thumb' | 'full') => string

const WIDTH_CLASS: Record<string, string> = {
  small: 'max-w-[240px]',
  medium: 'max-w-[480px]',
  full: 'max-w-full',
}

function attrString(attrs: Record<string, unknown>, key: string): string {
  const value = attrs[key]
  return typeof value === 'string' ? value : ''
}

/**
 * The image node view. The stored node carries an OPAQUE `attachmentId` and no URL — see
 * `createRichTextExtensions` — so the path is computed here, from a resolver the application
 * supplies. With no resolver (Storybook, unit tests, a renderer nobody wired) the node draws its alt
 * text in a bordered placeholder rather than a broken image: an empty `src` makes a browser re-request
 * the current page.
 *
 * The SAME placeholder is what a deleted attachment degrades to. An image node names a row, and
 * removing the file from the Files section deletes the bytes while leaving every document that
 * named them alone — so the fetch 404s, and without this the reader gets the browser's own broken
 * -image glyph and no alt text at all.
 */
export function ImageNodeView({ node, selected, extension }: ReactNodeViewProps) {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const attachmentId = attrString(attrs, 'attachmentId')
  const alt = attrString(attrs, 'alt')
  const width = attrString(attrs, 'width')
  const resolve = (extension.options as { resolveAttachmentSrc?: AttachmentSrcResolver })
    .resolveAttachmentSrc
  const src = attachmentId === '' ? '' : (resolve?.(attachmentId, 'full') ?? '')

  // Keyed by the id rather than a bare boolean, so pointing the node at a different attachment
  // clears the failure with no effect and no stale flag.
  const [failedId, setFailedId] = useState<string | null>(null)
  const failed = failedId !== null && failedId === attachmentId

  // The selected cue is an OUTLINE, never colour alone: a ProseMirror `NodeSelection` is how an
  // image is reached, deleted and given alt text from the keyboard, so it has to be visible to
  // somebody who cannot distinguish the accent hue.
  const selectedClass = selected
    ? 'outline outline-2 outline-offset-2 outline-ring'
    : 'outline-none'

  return (
    <NodeViewWrapper
      as="div"
      className={cn('my-2', WIDTH_CLASS[width] ?? WIDTH_CLASS.full)}
      contentEditable={false}
      role="img"
      aria-label={alt === '' ? 'Image' : `Image: ${alt}`}
      data-testid="rich-text-image"
    >
      {src === '' || failed ? (
        <span
          className={cn(
            'flex items-center gap-2 rounded-control border border-border border-dashed bg-bg-hover px-3 py-2 font-ui text-[13px] text-text-2',
            selectedClass,
          )}
        >
          <ImageOffIcon aria-hidden="true" className="size-4 shrink-0" />
          {alt === '' ? 'Image' : alt}
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedId(attachmentId)}
          className={cn('block h-auto max-w-full rounded-control', selectedClass)}
        />
      )}
    </NodeViewWrapper>
  )
}
