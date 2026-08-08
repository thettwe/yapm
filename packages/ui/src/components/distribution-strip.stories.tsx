import { DistributionStrip } from './distribution-strip'
import { PresetGrid } from './story-presets'

export default {
  title: 'DistributionStrip',
}

const HOURS = [2, 4, 5, 7, 9, 11, 13, 16, 19, 24, 29, 36, 44, 52, 61, 73, 88, 104, 128, 160]
const AXIS = 240

function dots(values: readonly number[], outlierFrom: number, axis = AXIS) {
  return values.map((hours, index) => ({
    id: `change-${index + 1}`,
    position: hours / axis,
    outlier: hours >= outlierFrom,
  }))
}

export function AllPresets() {
  return (
    <PresetGrid>
      <DistributionStrip
        dots={dots([...HOURS, 208, 236], 184)}
        ticks={[0, 48, 96, 144, 192, 240]}
        axisMax={AXIS}
        tickSuffix="h"
        medianPosition={46 / AXIS}
        medianLabel="median 46h"
        notes={[
          { id: 'crowd', kind: 'crowd', position: 46 / AXIS, text: '11 of 22 merged inside 46h' },
          {
            id: 'outlier',
            kind: 'outlier',
            position: 208 / AXIS,
            text: '2 changes waited 208h or more',
          },
        ]}
        label="22 merged changes by hours from open to merged, on a linear axis to 240 hours; one dot is one merged pull request; median 46 hours"
      />
    </PresetGrid>
  )
}

// One merged change is a population of one, and the median falls exactly on it.
export function OneMark() {
  return (
    <PresetGrid>
      <DistributionStrip
        dots={[{ id: 'change-1', position: 0.5, outlier: false }]}
        ticks={[0, 6, 12, 18, 24]}
        axisMax={24}
        tickSuffix="h"
        medianPosition={0.5}
        medianLabel="median 12h"
        notes={[{ id: 'crowd', kind: 'crowd', position: 0.5, text: '1 of 1 merged inside 12h' }]}
        label="1 merged change by hours from open to merged, on a linear axis to 24 hours; one dot is one merged pull request; median 12 hours"
      />
    </PresetGrid>
  )
}

// The mock's own trade-off, drawn: two giants compress the crowd into the left tenth of the axis.
// That IS the reading, which is why the outlier annotation states the count and the fact in words.
export function HeavyOutliers() {
  return (
    <PresetGrid>
      <DistributionStrip
        dots={dots([1, 2, 2, 3, 3, 4, 5, 6, 8, 9, 720, 960], 480, 1008)}
        ticks={[0, 336, 672, 1008]}
        axisMax={1008}
        tickSuffix="h"
        medianPosition={4 / 1008}
        medianLabel="median 4h"
        notes={[
          { id: 'crowd', kind: 'crowd', position: 4 / 1008, text: '6 of 12 merged inside 4h' },
          {
            id: 'outlier',
            kind: 'outlier',
            position: 720 / 1008,
            text: '2 changes waited 720h or more',
          },
        ]}
        label="12 merged changes by hours from open to merged, on a linear axis to 1008 hours; one dot is one merged pull request; median 4 hours"
      />
    </PresetGrid>
  )
}
