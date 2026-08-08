import { ReviewRhythm } from './review-rhythm'
import { PresetGrid } from './story-presets'

export default {
  title: 'ReviewRhythm',
}

const AXIS = 96

function row(id: string, span: number, first: number | null, reviews: readonly number[]) {
  return {
    id,
    spanHours: span,
    firstReviewHours: first,
    reviewOffsetsHours: reviews,
    overAxis: span > AXIS,
    spanLabel: `${span}h`,
  }
}

export function AllPresets() {
  return (
    <PresetGrid>
      <ReviewRhythm
        rows={[
          row('a', 9, 3, [3]),
          row('b', 12, 4, [4]),
          row('c', 7, 2, [2]),
          row('d', 22, 8, [8, 13]),
          row('e', 27, 13, [13, 18]),
          row('f', 11, 4, [4]),
          row('g', 38, 17, [17, 24]),
          row('h', 18, 5, [5, 10]),
          row('i', 26, 10, [10]),
          row('j', 47, 20, [20, 27, 34]),
          row('k', 17, 7, [7]),
          row('l', 35, 15, [15, 22]),
        ]}
        axisMaxHours={AXIS}
        label="Review rhythm for 12 of 12 merged changes in the last 6 completed cycles; one row is one merged pull request from open to merge, with a mark for each review that came back"
      />
    </PresetGrid>
  )
}

export function OneMark() {
  return (
    <PresetGrid>
      <ReviewRhythm
        rows={[row('a', 14, 5, [5])]}
        axisMaxHours={AXIS}
        label="Review rhythm for 1 of 1 merged change in the last 6 completed cycles; one row is one merged pull request from open to merge, with a mark for each review that came back"
      />
    </PresetGrid>
  )
}

// A change that never got a review still opened and still merged: the row draws the wait and no
// review mark, rather than inventing a first look that did not happen.
export function NoReviews() {
  return (
    <PresetGrid>
      <ReviewRhythm
        rows={[row('a', 14, null, []), row('b', 30, null, []), row('c', 6, 2, [2])]}
        axisMaxHours={AXIS}
        label="Review rhythm for 3 of 3 merged changes in the last 6 completed cycles; one row is one merged pull request from open to merge, with a mark for each review that came back"
      />
    </PresetGrid>
  )
}

// Two changes ran past the axis. They state their own duration in text instead of being clipped
// into a shorter one — the fact survives the drawing that cannot hold it.
export function OverAxis() {
  return (
    <PresetGrid>
      <ReviewRhythm
        rows={[
          row('a', 9, 3, [3]),
          row('b', 208, 64, [64, 150]),
          row('c', 12, 4, [4]),
          row('d', 236, 82, [82, 190]),
        ]}
        axisMaxHours={AXIS}
        label="Review rhythm for 4 of 4 merged changes in the last 6 completed cycles; one row is one merged pull request from open to merge, with a mark for each review that came back"
      />
    </PresetGrid>
  )
}
