import {
  CYCLE_STATUS,
  CycleGlyph,
  type CycleGlyphKind,
  STATUS,
  StatusGlyph,
  type StatusKind,
} from './status-glyph'
import { PresetGrid } from './story-presets'

export default {
  title: 'Status glyph',
}

const STATUSES = Object.keys(STATUS) as StatusKind[]
const CYCLE_KINDS = Object.keys(CYCLE_STATUS) as CycleGlyphKind[]

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

// The cycle's three positions, on the same grid and stroke as the six above — the register's row
// glyph beside the vocabulary it borrows from, so a drift is visible rather than argued about.
export function CyclePresets() {
  return (
    <PresetGrid>
      <div className="flex flex-wrap gap-4">
        {CYCLE_KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-2 text-sm text-text-2">
            <CycleGlyph kind={kind} />
            {CYCLE_STATUS[kind].label}
          </span>
        ))}
      </div>
    </PresetGrid>
  )
}
