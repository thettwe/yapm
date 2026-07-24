import { DivergenceFlag, IssueRow } from './issue-row'
import { PresetGrid } from './story-presets'

export default {
  title: 'Issue row',
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
