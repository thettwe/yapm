import { Door } from './door'
import { How } from './how'
import { PresetGrid } from './story-presets'

export default {
  title: 'How',
}

// The number is a fact and stays; the derivation is a footnote and folds. The dotted `Door` under
// the number is the same affordance the peek's trigger wears — dotted means openable, everywhere.
export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex min-h-[190px] items-start gap-8">
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-text-1">
          <Door hot>46</Door>
          <span className="text-[15px] font-semibold text-text-2">h</span>
          <span className="mt-[7px] block">
            <How
              label="open to merged"
              constraint="linear scale · giants included · team-level only"
            >
              Median of the last 26 merged changes, opened → merged, drawn where it falls — not
              quoted from a summary.
            </How>
          </span>
        </span>
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-text-1">
          <Door>7</Door>
          <span className="text-[15px] font-semibold text-text-2">d</span>
          <span className="mt-[7px] block">
            <How label="red for">
              Time since the newest failing check was last updated. GitHub sends no start or finish
              time for a check, so how long the run took is not knowable and is never drawn.
            </How>
          </span>
        </span>
      </div>
    </PresetGrid>
  )
}
