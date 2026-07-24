import { STATUS, StatusGlyph, type StatusKind } from './status-glyph'
import { PresetGrid } from './story-presets'

export default {
  title: 'Status glyph',
}

const STATUSES = Object.keys(STATUS) as StatusKind[]

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex flex-wrap gap-4">
        {STATUSES.map((status) => (
          <span key={status} className="flex items-center gap-2 text-sm text-text-2">
            <StatusGlyph status={status} />
            {STATUS[status].label}
          </span>
        ))}
      </div>
    </PresetGrid>
  )
}
