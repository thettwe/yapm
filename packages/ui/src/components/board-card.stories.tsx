import { BoardCard } from './board-card'
import {
  buildRealityShape,
  type DeliveryStrip,
  RealityTrack,
  realityTrackLabel,
} from './reality-track'
import { PresetGrid } from './story-presets'

export default {
  title: 'Board card',
}

const DIVERGED: DeliveryStrip = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 600_000,
  deployedAt: null,
}
const IN_REVIEW: DeliveryStrip = {
  pr: 'open',
  ci: 'passing',
  reviewAgeMs: 16 * 3_600_000,
  deployedAt: null,
}

function Track({ strip, diverged = false }: { strip: DeliveryStrip; diverged?: boolean }) {
  const sentence = diverged ? 'PR merged but this issue is not marked done' : null
  return (
    <RealityTrack
      width={86}
      shape={buildRealityShape(strip, diverged ? { divergence: 'status_behind_merge' } : {})}
      label={realityTrackLabel(strip, sentence)}
    />
  )
}

// Every register the board draws, at the board's own measure: the divergent card, the card with a
// phrase and a full track, the quiet card that draws neither, a title that runs long, the hole a
// picked-up card leaves, and the card in flight.
export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex w-64 flex-col gap-2 rounded-card bg-bg-sidebar p-2">
        <BoardCard
          issueKey="ENG-142"
          title="Investigate flaky sync on reconnect"
          priority="urgent"
          status="in-progress"
          labels={[{ name: 'sync' }]}
          assignee={{ name: 'Ada Lovelace' }}
          phrase={
            <span className="truncate font-semibold text-status-urgent-ink">
              Done in git, not on the board
            </span>
          }
          realityTrack={<Track strip={DIVERGED} diverged />}
        />
        <BoardCard
          issueKey="ENG-138"
          title="Card reserves one reality-track slot"
          priority="high"
          status="in-review"
          labels={[{ name: 'graph' }]}
          assignee={{ name: 'Grace Hopper' }}
          phrase={<span className="truncate text-text-2">In review — waiting 16h</span>}
          realityTrack={<Track strip={IN_REVIEW} />}
          selected
        />
        <BoardCard
          issueKey="ENG-129"
          title="Draft: command palette keyboard model"
          priority="low"
          status="todo"
        />
        <BoardCard
          issueKey="ENG-120"
          title="Migrate the legacy coupon codes off the batch importer before the promotion window closes"
          priority="no-priority"
          status="backlog"
          labels={[{ name: 'bug' }, { name: 'importer' }]}
          assignee={{ name: 'Marta Klein' }}
        />
        <BoardCard
          issueKey="ENG-113"
          title="Refund flow for partial orders"
          priority="medium"
          status="in-progress"
          dragging
        />
        <BoardCard
          issueKey="ENG-113"
          title="Refund flow for partial orders"
          priority="medium"
          status="in-progress"
          labels={[{ name: 'feature' }]}
          assignee={{ name: 'Ada Lovelace' }}
          phrase={<span className="truncate text-text-2">In review — waiting 16h</span>}
          realityTrack={<Track strip={IN_REVIEW} />}
          inFlight
          footer={
            <>
              <span>space drop</span>
              <span aria-hidden="true">·</span>
              <span>esc cancel</span>
              <span aria-hidden="true">·</span>
              <span>← → column</span>
            </>
          }
        />
      </div>
    </PresetGrid>
  )
}
