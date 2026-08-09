import { Badge } from './badge'
import { AnonymityMark, DraftMark, RetroMark } from './drawn'
import { RetroAccentBar, RetroCard, RetroVotePips } from './retro-card'
import { PresetGrid } from './story-presets'

export default {
  title: 'Retro card',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex w-72 flex-col gap-3 bg-bg-sidebar p-3">
        <div className="flex items-center gap-2">
          <RetroAccentBar accent="positive" className="h-[7px] w-[7px] rounded-full" />
          <span className="text-[13px] font-semibold tracking-[-0.006em] text-text-1">
            Went well
          </span>
          <span className="font-mono text-[11px] text-text-2">5</span>
        </div>
        <RetroCard
          accent="positive"
          body="Pairing on the sync rebase cut the review round trip in half."
          author={{ name: 'Ada Lovelace' }}
          votes={<RetroVotePips count={4} mine={2} />}
        />
        {/* The zero case beside the non-zero one: same reserved measure, no ink at all. */}
        <RetroCard
          accent="negative"
          body="Review wait was the largest slice of lead time this cycle."
          anonymous
          evidence={<Badge variant="outline">Flow · review wait</Badge>}
          votes={<RetroVotePips count={0} mine={0} />}
        />
        {/* A group is the vote target, so the notes inside it carry no pips of their own. */}
        <div className="flex flex-col gap-2 rounded-[7px] border-[1.5px] border-dashed border-accent-line p-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11.5px] font-semibold text-accent-strong">
              Waiting on review
            </span>
            <span className="font-mono text-[10.5px] text-text-2">2 cards</span>
            <span className="ml-auto">
              <RetroVotePips count={5} mine={1} />
            </span>
          </div>
          <RetroCard
            accent="negative"
            body="A change sat a full day because it was nobody's turn."
          />
          <RetroCard accent="negative" body="Review pings land in chat and drown by lunch." />
        </div>
        <RetroCard accent="caution" body="Two issues carried for the second cycle running." muted />
        <RetroCard accent="action" body="Rotate a review buddy each cycle." selected />
        <RetroCard accent="neutral" body="Dragging this one." dragging />
        <div className="flex items-center gap-3 text-text-2">
          <AnonymityMark />
          <RetroMark />
          <DraftMark />
        </div>
      </div>
    </PresetGrid>
  )
}
