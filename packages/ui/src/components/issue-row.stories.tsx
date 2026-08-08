import { restPhrase } from '@yapm/schema'
import { IssueRow } from './issue-row'
import { buildRealityShape, RealityTrack, realityTrackLabel } from './reality-track'
import { RestPhraseText } from './rest-phrase'
import { PresetGrid } from './story-presets'

export default {
  title: 'Issue row',
}

const OPEN_GREEN = {
  pr: 'open',
  ci: 'passing',
  reviewAgeMs: 7_200_000,
  deployedAt: null,
} as const
const APPROVED_RUNNING = {
  pr: 'approved',
  ci: 'pending',
  reviewAgeMs: 3_600_000,
  deployedAt: null,
} as const
const SHIPPED = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 600_000,
  deployedAt: 1_759_000_000_000,
} as const
const DIVERGED = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 600_000,
  deployedAt: null,
} as const
const DRAFT_RED = { pr: 'draft', ci: 'failing', reviewAgeMs: null, deployedAt: null } as const

function Track({
  strip,
  divergence,
  sentence,
}: {
  strip: Parameters<typeof buildRealityShape>[0]
  divergence?: Parameters<typeof buildRealityShape>[1]
  sentence?: string
}) {
  return (
    <RealityTrack
      shape={buildRealityShape(strip, divergence ?? {})}
      label={realityTrackLabel(strip, sentence ?? null)}
    />
  )
}

export function RealityTrackStates() {
  return (
    <PresetGrid>
      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="divide-y divide-border">
          <IssueRow
            issueKey="ENG-142"
            title="Open PR, awaiting review, CI green"
            priority="high"
            status="in-review"
            date="2h"
            realityTrack={<Track strip={OPEN_GREEN} />}
          />
          <IssueRow
            issueKey="ENG-143"
            title="Approved, checks running"
            priority="medium"
            status="in-review"
            date="1h"
            realityTrack={<Track strip={APPROVED_RUNNING} />}
          />
          <IssueRow
            issueKey="ENG-144"
            title="Merged and deployed, still marked in progress"
            priority="high"
            status="in-progress"
            date="10m"
            realityTrack={<Track strip={SHIPPED} />}
          />
          <IssueRow
            issueKey="ENG-147"
            title="Merged a day ago, the board never followed"
            priority="high"
            status="in-progress"
            date="1d"
            realityTrack={
              <Track
                strip={DIVERGED}
                divergence={{ divergence: 'status_behind_merge' }}
                sentence="PR merged but this issue is not marked done"
              />
            }
          />
          <IssueRow
            issueKey="ENG-145"
            title="CI failing on a draft PR"
            priority="urgent"
            status="in-progress"
            date="30m"
            realityTrack={<Track strip={DRAFT_RED} />}
          />
          <IssueRow
            issueKey="ENG-146"
            title="No linked delivery yet"
            priority="low"
            status="todo"
            date="1w"
          />
        </div>
      </div>
    </PresetGrid>
  )
}

export function VerticalRail() {
  const shape = {
    stations: [
      { id: 'idea', node: 'done' as const, label: 'Idea — planned into Cycle 2', fact: '9d ago' },
      {
        id: 'designed',
        node: 'done' as const,
        label: 'Designed — approved in crit',
        fact: 'payment-sheet-v3 · 2 comments',
      },
      {
        id: 'opened',
        node: 'done' as const,
        label: 'Change opened',
        fact: 'PR #188 · apple-pay → main',
      },
      {
        id: 'reviewed',
        node: 'done' as const,
        label: 'Reviewed — approved',
        fact: '2 rounds · changes requested, then approved',
      },
      {
        id: 'merged',
        node: 'done' as const,
        label: 'Merged, checks green',
        fact: '8f21c4a on main · 14/14 checks passed',
      },
      { id: 'live', node: 'empty-urgent' as const, label: 'Not live yet' },
    ],
    segments: ['solid', 'solid', 'solid', 'solid', 'broken'] as const,
  }
  return (
    <PresetGrid>
      <div className="rounded-card border border-border bg-bg p-4">
        <RealityTrack orientation="vertical" shape={shape} label="Delivery for ENG-188" />
      </div>
    </PresetGrid>
  )
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="divide-y divide-border">
          <IssueRow
            issueKey="ENG-142"
            title="Investigate flaky sync on reconnect"
            priority="urgent"
            status="in-progress"
            labels={[{ name: 'sync', tone: 'accent' }]}
            cycle="C-24"
            date="3d"
            assignee={{ name: 'Ada Lovelace' }}
            realityTrack={
              <Track
                strip={DIVERGED}
                divergence={{ divergence: 'status_behind_merge' }}
                sentence="PR merged but this issue is not marked done"
              />
            }
          />
          <IssueRow
            issueKey="ENG-138"
            title="Row primitive reserves one reality-track slot"
            priority="high"
            status="in-review"
            labels={[{ name: 'graph', tone: 'in-review' }]}
            cycle="C-24"
            date="1d"
            assignee={{ name: 'Grace Hopper' }}
            selected
          />
          <IssueRow
            issueKey="ENG-131"
            title="Token layer passes WCAG AA in both modes"
            priority="medium"
            status="done"
            labels={[{ name: 'a11y', tone: 'done' }]}
            date="5d"
            assignee={{ name: 'Alan Turing' }}
          />
          <IssueRow
            issueKey="ENG-129"
            title="Draft: command palette keyboard model"
            priority="low"
            status="todo"
            date="1w"
          />
          <IssueRow
            issueKey="ENG-120"
            title="Backlog grooming for github-sync"
            priority="no-priority"
            status="backlog"
            date="2w"
          />
        </div>
      </div>
    </PresetGrid>
  )
}

// The mock's four phrase cases, a quiet row, and the selected divergent row that carries its
// phrase AND its broken track at once. Every string comes from the shared dictionary — a story
// that typed its own would be the second vocabulary the dictionary exists to prevent.
function say(key: Parameters<typeof restPhrase>[0], reviewAgeMs?: number) {
  return (
    <RestPhraseText phrase={restPhrase(key, 'neutral', { reviewAgeMs: reviewAgeMs ?? null })} />
  )
}

export function PhrasesAtRest() {
  return (
    <PresetGrid>
      <div className="overflow-hidden rounded-card border border-border bg-bg">
        <div className="divide-y divide-border">
          <IssueRow
            issueKey="ENG-115"
            title="Address autocomplete on shipping step"
            priority="low"
            status="todo"
            labels={[{ name: 'feature', tone: 'in-review' }]}
            date="7h"
            phrase={say('checks_failing')}
            realityTrack={<Track strip={DRAFT_RED} />}
          />
          <IssueRow
            issueKey="ENG-116"
            title="Apple Pay in the payment sheet"
            priority="high"
            status="in-progress"
            labels={[{ name: 'feature', tone: 'in-review' }]}
            date="11h"
            selected
            phrase={say('diverged_behind_merge')}
            realityTrack={
              <Track
                strip={DIVERGED}
                divergence={{ divergence: 'status_behind_merge' }}
                sentence="PR merged but this issue is not marked done"
              />
            }
          />
          <IssueRow
            issueKey="ENG-119"
            title="Persist cart across sessions"
            priority="high"
            status="in-progress"
            labels={[{ name: 'feature', tone: 'in-progress' }]}
            date="1d"
            assignee={{ name: 'Ada Lovelace' }}
            phrase={say('merged_not_deployed')}
            realityTrack={<Track strip={DIVERGED} />}
          />
          <IssueRow
            issueKey="ENG-113"
            title="Refund flow for partial orders"
            priority="low"
            status="in-progress"
            labels={[{ name: 'feature', tone: 'in-review' }]}
            date="15h"
            assignee={{ name: 'Grace Hopper' }}
            phrase={say('review_unreviewed', 16 * 60 * 60 * 1000)}
            realityTrack={<Track strip={OPEN_GREEN} />}
          />
          {/* Quiet: the slot is reserved and genuinely blank. */}
          <IssueRow
            issueKey="ENG-1"
            title="Focus lost after closing the palette"
            priority="high"
            status="in-progress"
            labels={[{ name: 'bug', tone: 'urgent' }]}
            date="2m"
            assignee={{ name: 'Alan Turing' }}
          />
        </div>
      </div>
    </PresetGrid>
  )
}
