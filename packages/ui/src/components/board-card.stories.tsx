import { BoardCard } from './board-card'
import { DivergenceFlag } from './issue-row'
import { PresetGrid } from './story-presets'

export default {
  title: 'Board card',
}

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
          divergenceFlag={<DivergenceFlag />}
        />
        <BoardCard
          issueKey="ENG-138"
          title="Row primitive reserves reality-strip slot"
          priority="high"
          status="in-review"
          labels={[{ name: 'graph' }]}
          assignee={{ name: 'Grace Hopper' }}
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
          title="Backlog grooming for github-sync"
          priority="no-priority"
          status="backlog"
          dragging
        />
      </div>
    </PresetGrid>
  )
}
