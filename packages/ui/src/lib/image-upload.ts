import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { type Editor, Extension } from '@tiptap/react'
import { IMAGE_NODE_TYPE } from '@yapm/schema'

export type ImageUploadResult = { attachmentId: string } | { error: string }

/**
 * What the application does with the bytes. `packages/ui` performs no fetch and knows no API path
 * — packages never import apps — so the editor's whole knowledge of uploading is this function and
 * the opaque id it eventually returns.
 */
export type ImageUploader = (file: File) => Promise<ImageUploadResult>

export const IMAGE_UPLOAD_PLUGIN_KEY = new PluginKey<DecorationSet>('yapm-image-upload')

interface UploadMeta {
  readonly add?: { readonly id: string; readonly pos: number; readonly label: string }
  readonly resolve?: { readonly id: string }
  readonly fail?: { readonly id: string; readonly message: string }
}

interface UploadSpec {
  readonly uploadId: string
  readonly failed: boolean
}

const PENDING_CLASS =
  'mx-0.5 inline-flex items-center gap-1.5 rounded-control border border-border border-dashed bg-bg-hover px-2 py-0.5 align-middle font-ui text-[12px] text-text-2'
const FAILED_CLASS =
  'mx-0.5 inline-flex items-center gap-1.5 rounded-control border border-status-urgent bg-bg-hover px-2 py-0.5 align-middle font-ui text-[12px] text-status-urgent'

function chip(text: string, failed: boolean): HTMLElement {
  const element = document.createElement('span')
  element.className = failed ? FAILED_CLASS : PENDING_CLASS
  element.setAttribute('role', 'status')
  element.setAttribute('contenteditable', 'false')
  element.textContent = text
  return element
}

function widget(pos: number, spec: UploadSpec, text: string): Decoration {
  return Decoration.widget(pos, () => chip(text, spec.failed), { ...spec, side: 1 })
}

function find(set: DecorationSet, id: string): Decoration | undefined {
  return set.find(undefined, undefined, (spec) => (spec as UploadSpec).uploadId === id)[0]
}

/**
 * Upload progress is a DECORATION, never a node.
 *
 * A placeholder node would be a synced node naming an attachment that may never exist: the upload
 * fails, the tab closes, the bytes are refused — and the document is left holding an id that
 * resolves to nothing, on every client, forever. A decoration lives in the editor's plugin state,
 * is invisible to `getJSON()`, and cannot reach `mutators.issue.update` at all. Nothing enters the
 * document until the bytes are stored.
 *
 * A failed upload's chip stays until the next change to the document, so the reason is still on
 * screen when the user looks up, and gone by the time they have typed past it.
 */
export const ImageUploadPlaceholders = Extension.create({
  name: 'imageUploadPlaceholders',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: IMAGE_UPLOAD_PLUGIN_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            let set = value.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(IMAGE_UPLOAD_PLUGIN_KEY) as UploadMeta | undefined

            if (tr.docChanged && meta?.fail === undefined) {
              const stale = set.find(undefined, undefined, (spec) => (spec as UploadSpec).failed)
              if (stale.length > 0) set = set.remove(stale)
            }

            if (meta?.add) {
              const spec: UploadSpec = { uploadId: meta.add.id, failed: false }
              set = set.add(tr.doc, [widget(meta.add.pos, spec, `Uploading ${meta.add.label}…`)])
            }
            if (meta?.resolve) {
              const found = find(set, meta.resolve.id)
              if (found) set = set.remove([found])
            }
            if (meta?.fail) {
              const found = find(set, meta.fail.id)
              const at = found?.from ?? tr.selection.from
              if (found) set = set.remove([found])
              const spec: UploadSpec = { uploadId: meta.fail.id, failed: true }
              set = set.add(tr.doc, [widget(at, spec, meta.fail.message)])
            }
            return set
          },
        },
        props: {
          decorations: (state) => IMAGE_UPLOAD_PLUGIN_KEY.getState(state) ?? DecorationSet.empty,
        },
      }),
    ]
  },
})

// A LOCAL counter, not `newId()`, and the distinction is worth stating: this id names a decoration
// inside one editor's plugin state for the length of one upload. It is never written to a document,
// never sent anywhere, and no mutator rebases over it — so CLAUDE.md #4 has nothing to say here, and
// borrowing a UUIDv7 would imply otherwise.
let uploadSequence = 0

/** The alt text an uploaded image starts with, so it is findable before anybody edits it. */
export function altFromFilename(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return base.slice(0, 120)
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/** Every image file on a clipboard or a drag, in order; empty for a drop that is not the editor's. */
export function imageFilesFrom(transfer: DataTransfer | null): readonly File[] {
  if (transfer === null) return []
  return Array.from(transfer.files ?? []).filter(isImageFile)
}

/**
 * Stores the bytes, then inserts the node — in that order, once, at the position the placeholder
 * has been mapped to by every transaction that happened while the request was in flight.
 */
export async function uploadImageInto(
  editor: Editor,
  file: File,
  upload: ImageUploader,
  at?: number,
): Promise<void> {
  uploadSequence += 1
  const id = `yapm-upload-${uploadSequence}`
  const pos = at ?? editor.state.selection.from
  editor.view.dispatch(
    editor.state.tr.setMeta(IMAGE_UPLOAD_PLUGIN_KEY, {
      add: { id, pos, label: file.name },
    } satisfies UploadMeta),
  )

  let result: ImageUploadResult
  try {
    result = await upload(file)
  } catch {
    // A network failure, an aborted request, a host callback that threw. The document is untouched
    // either way, so there is nothing to roll back — only something to say.
    result = { error: 'Upload failed. Check your connection and try again.' }
  }

  if (editor.isDestroyed) return

  if ('error' in result) {
    editor.view.dispatch(
      editor.state.tr.setMeta(IMAGE_UPLOAD_PLUGIN_KEY, {
        fail: { id, message: result.error },
      } satisfies UploadMeta),
    )
    return
  }

  const set = IMAGE_UPLOAD_PLUGIN_KEY.getState(editor.state) ?? DecorationSet.empty
  const insertAt = find(set, id)?.from ?? editor.state.selection.from
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta(IMAGE_UPLOAD_PLUGIN_KEY, { resolve: { id } } satisfies UploadMeta)
      return true
    })
    .insertContentAt(insertAt, {
      type: IMAGE_NODE_TYPE,
      attrs: { attachmentId: result.attachmentId, alt: altFromFilename(file.name), width: 'full' },
    })
    .run()
}

/**
 * The file picker. A hidden `<input type="file">` clicked programmatically is the only way to open
 * the platform dialog, and the platform dialog is the keyboard-operable one — the insert menu's
 * Enter reaches it exactly as a toolbar button's would.
 */
export function pickImageFile(onPick: (file: File) => void): void {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.remove()
    if (file && isImageFile(file)) onPick(file)
  })
  document.body.append(input)
  input.click()
}
