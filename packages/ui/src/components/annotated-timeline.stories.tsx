import { AnnotatedTimeline } from './annotated-timeline'
import { PresetGrid } from './story-presets'

export default {
  title: 'AnnotatedTimeline',
}

const DEPLOYS = [0.02, 0.09, 0.17, 0.17, 0.25, 0.4, 0.49, 0.57].map((position, index) => ({
  id: `deploy-${index + 1}`,
  position,
}))

export function AllPresets() {
  return (
    <PresetGrid>
      <AnnotatedTimeline
        startLabel="Jul 30"
        endLabel="Aug 12"
        deploys={DEPLOYS}
        retros={[
          {
            id: 'retro-1',
            position: 0,
            title: 'Cycle 1 retrospective',
            detail: '0 before Jul 30 · 8 after',
          },
        ]}
        callout={{
          position: 0.4,
          headline: 'checkout-v2 went out here',
          subline: 'Aug 4 · first of 3 that week',
        }}
        todayPosition={0.61}
        todayLabel="today · day 9 of 14"
        daysLeftLabel="5 days left"
        label="Cycle 2, Jul 30 to Aug 12: 8 deployments reached production and 1 retrospective closed; one dot is one deployment; today is day 9 of 14"
      />
    </PresetGrid>
  )
}

// A cycle in progress that has shipped nothing yet: the track, the caret and the days left are all
// still true, and nothing invents a mark that did not happen.
export function Empty() {
  return (
    <PresetGrid>
      <AnnotatedTimeline
        startLabel="Aug 13"
        endLabel="Aug 26"
        deploys={[]}
        retros={[]}
        callout={null}
        todayPosition={0.08}
        todayLabel="today · day 2 of 14"
        daysLeftLabel="12 days left"
        label="Cycle 3, Aug 13 to Aug 26: 0 deployments reached production and 0 retrospectives closed; one dot is one deployment; today is day 2 of 14"
      />
    </PresetGrid>
  )
}

export function OneMark() {
  return (
    <PresetGrid>
      <AnnotatedTimeline
        startLabel="Aug 13"
        endLabel="Aug 26"
        deploys={[{ id: 'deploy-1', position: 0.34 }]}
        retros={[]}
        callout={{
          position: 0.34,
          headline: 'A deployment went out here',
          subline: 'Aug 17 · first of 1 that week',
        }}
        todayPosition={0.5}
        todayLabel="today · day 8 of 14"
        daysLeftLabel="6 days left"
        label="Cycle 3, Aug 13 to Aug 26: 1 deployment reached production and 0 retrospectives closed; one dot is one deployment; today is day 8 of 14"
      />
    </PresetGrid>
  )
}

// Everything on one day: the marks stack rather than one dot standing in for eleven.
export function HeavyCluster() {
  return (
    <PresetGrid>
      <AnnotatedTimeline
        startLabel="Aug 13"
        endLabel="Aug 26"
        deploys={Array.from({ length: 11 }, (_, index) => ({
          id: `deploy-${index + 1}`,
          position: 0.45 + index * 0.0005,
        }))}
        retros={[
          {
            id: 'retro-1',
            position: 0.1,
            title: 'Cycle 2 retrospective',
            detail: '0 before · 11 after',
          },
          { id: 'retro-2', position: 0.7, title: 'Incident review', detail: '11 before · 0 after' },
        ]}
        callout={{
          position: 0.45,
          headline: 'release-42 went out here',
          subline: 'Aug 19 · first of 11 that week',
        }}
        todayPosition={0.9}
        todayLabel="today · day 13 of 14"
        daysLeftLabel="1 day left"
        label="Cycle 3, Aug 13 to Aug 26: 11 deployments reached production and 2 retrospectives closed; one dot is one deployment; today is day 13 of 14"
      />
    </PresetGrid>
  )
}
