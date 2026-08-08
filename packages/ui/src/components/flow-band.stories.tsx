import { FlowBand } from './flow-band'
import { PresetGrid } from './story-presets'

export default {
  title: 'FlowBand',
}

const BARS = [
  { id: 'c1', label: '6 ago', shipped: 7, added: 2, addedLabel: '+2 added' },
  { id: 'c2', label: '5 ago', shipped: 9, added: 1, addedLabel: '+1 added' },
  { id: 'c3', label: '4 ago', shipped: 9, added: 3, addedLabel: '+3 added' },
  { id: 'c4', label: '3 ago', shipped: 9, added: 2, addedLabel: '+2 added' },
  { id: 'c5', label: '2 ago', shipped: 10, added: 4, addedLabel: '+4 added' },
  { id: 'c6', label: 'last', shipped: 8, added: 2, addedLabel: '+2 added' },
]

export function AllPresets() {
  return (
    <PresetGrid>
      <FlowBand
        bars={BARS}
        carries={[
          { id: 'k1', fromIndex: 0, toIndex: 1, count: 2, label: '2 carried' },
          { id: 'k2', fromIndex: 1, toIndex: 2, count: 1, label: '1' },
          { id: 'k3', fromIndex: 2, toIndex: 3, count: 3, label: '3' },
          { id: 'k4', fromIndex: 3, toIndex: 4, count: 2, label: '2' },
          { id: 'k5', fromIndex: 4, toIndex: 5, count: 4, label: '4' },
        ]}
        label="Shipped per cycle across the last 6 completed cycles: 7, 9, 9, 9, 10, 8; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started"
      />
    </PresetGrid>
  )
}

// Bars but no ribbons and no caps: a window where nothing carried and nothing arrived late still
// has a shape, so it still draws — the sentence above it says what the absence means.
export function NoCarries() {
  return (
    <PresetGrid>
      <FlowBand
        bars={BARS.map((bar) => ({ ...bar, added: 0, addedLabel: null }))}
        carries={[]}
        label="Shipped per cycle across the last 6 completed cycles: 7, 9, 9, 9, 10, 8; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started"
      />
    </PresetGrid>
  )
}

export function OneCycle() {
  return (
    <PresetGrid>
      <FlowBand
        bars={[{ id: 'c1', label: 'last', shipped: 4, added: 1, addedLabel: '+1 added' }]}
        carries={[]}
        label="Shipped per cycle across the last 1 completed cycle: 4; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started"
      />
    </PresetGrid>
  )
}

// A cycle that shipped forty items against neighbours that shipped two: the unit shrinks so the
// tallest bar fits, and every bar and ribbon keeps reading against the same unit.
export function HeavyOutlier() {
  return (
    <PresetGrid>
      <FlowBand
        bars={[
          { id: 'c1', label: '2 ago', shipped: 2, added: 0, addedLabel: null },
          { id: 'c2', label: '1 ago', shipped: 40, added: 6, addedLabel: '+6 added' },
          { id: 'c3', label: 'last', shipped: 3, added: 0, addedLabel: null },
        ]}
        carries={[{ id: 'k1', fromIndex: 1, toIndex: 2, count: 12, label: '12 carried' }]}
        label="Shipped per cycle across the last 3 completed cycles: 2, 40, 3; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started"
      />
    </PresetGrid>
  )
}
