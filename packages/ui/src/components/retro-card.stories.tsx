import { Badge } from './badge'
import { RetroAccentBar, RetroCard, RetroVotePips } from './retro-card'
import { PresetGrid } from './story-presets'

export default {
  title: 'Retro card',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex w-72 flex-col gap-2 rounded-card bg-bg-sidebar p-2">
        <div className="flex items-center gap-2 px-1">
          <RetroAccentBar accent="positive" />
          <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
            Went well
          </span>
        </div>
        <RetroCard
          accent="positive"
          body="Pairing on the sync rebase cut the review round trip in half."
          author={{ name: 'Ada Lovelace' }}
          votes={<RetroVotePips count={4} mine={2} />}
        />
        <RetroCard
          accent="negative"
          body="Review wait was the largest slice of lead time this cycle."
          anonymous
          evidence={<Badge variant="outline">Flow · review wait</Badge>}
          votes={<RetroVotePips count={2} mine={0} />}
        />
        <RetroCard accent="caution" body="Two issues carried for the second cycle running." muted />
        <RetroCard accent="action" body="Rotate a review buddy each cycle." selected />
        <RetroCard accent="neutral" body="Dragging this one." dragging />
      </div>
    </PresetGrid>
  )
}
