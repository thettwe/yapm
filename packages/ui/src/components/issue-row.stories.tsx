import { DivergenceFlag, IssueRow, RealityStrip } from './issue-row'
import { PresetGrid } from './story-presets'

export default {
  title: 'Issue row',
}

export function RealityStripStates() {
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
            realityStrip={<RealityStrip pr="open" ci="passing" reviewAgeMs={7_200_000} />}
          />
          <IssueRow
            issueKey="ENG-143"
            title="Approved, checks running"
            priority="medium"
            status="in-review"
            date="1h"
            realityStrip={<RealityStrip pr="approved" ci="pending" reviewAgeMs={3_600_000} />}
          />
          <IssueRow
            issueKey="ENG-144"
            title="Merged while still marked in progress"
            priority="high"
            status="in-progress"
            date="10m"
            realityStrip={<RealityStrip pr="merged" ci="passing" reviewAgeMs={600_000} />}
            divergenceFlag={<DivergenceFlag label="PR merged but this issue is not marked done" />}
          />
          <IssueRow
            issueKey="ENG-145"
            title="CI failing on an open PR"
            priority="urgent"
            status="in-progress"
            date="30m"
            realityStrip={<RealityStrip pr="draft" ci="failing" reviewAgeMs={null} />}
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
            divergenceFlag={<DivergenceFlag />}
          />
          <IssueRow
            issueKey="ENG-138"
            title="Row primitive reserves reality-strip slot"
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
