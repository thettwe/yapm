import type { JSONContent } from '@tiptap/react'
import { Button } from './button'
import { CommentCard } from './comment'
import { RichTextRenderer } from './rich-text'
import { PresetGrid } from './story-presets'

export default {
  title: 'Comment',
}

const body: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'I can repro this on ' },
        { type: 'text', marks: [{ type: 'code' }], text: 'main' },
        { type: 'text', text: ' — the queued write never replays.' },
      ],
    },
  ],
}

export function Thread() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-4">
        <CommentCard authorName="Ada Lovelace" timestamp="2h">
          <RichTextRenderer value={body} />
        </CommentCard>
        <CommentCard
          authorName="Grace Hopper"
          timestamp="1h"
          edited
          actions={
            <>
              <Button variant="ghost" size="xs">
                Edit
              </Button>
              <Button variant="ghost" size="xs">
                Delete
              </Button>
            </>
          }
        >
          <RichTextRenderer value={body} />
        </CommentCard>
      </div>
    </PresetGrid>
  )
}
