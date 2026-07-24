import { PRIORITY, type PriorityKind, PriorityMark } from './priority-mark'
import { PresetGrid } from './story-presets'

export default {
  title: 'Priority mark',
}

const PRIORITIES = Object.keys(PRIORITY) as PriorityKind[]

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex flex-wrap gap-4">
        {PRIORITIES.map((priority) => (
          <span key={priority} className="flex items-center gap-2 text-sm text-text-2">
            <PriorityMark priority={priority} />
            {PRIORITY[priority]}
          </span>
        ))}
      </div>
    </PresetGrid>
  )
}
