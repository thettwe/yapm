import type { TeamFrameModel } from '@yapm/schema'
import type { ReactNode } from 'react'
import { SyncIndicator } from '@/frame/sync-indicator'
import { useConnectionSummary } from '@/zero/connection'

// Band 3 — the statusline: the team's day in one line, on every page, 32px on `--statusline-bg`,
// `margin-top:auto` in the frame's `min-h-svh` column exactly as the mocks draw it.
//
// Labels only, never sentences (the word diet's CHROME tier). Each of the four team segments folds
// on its own when its fact is absent, and off-team every one of them folds, leaving the workspace
// name — the deck may point at a team, the statusline may only report one (design §D3).

function Divider() {
  return (
    <span aria-hidden="true" className="mx-2.5 text-border-strong">
      ·
    </span>
  )
}

interface Segment {
  readonly id: string
  readonly node: ReactNode | null
}

function Segments({ segments }: { segments: readonly Segment[] }) {
  const shown = segments.filter((segment) => segment.node !== null)
  return (
    <>
      {shown.map((segment, index) => (
        <span key={segment.id} className="flex items-center">
          {index === 0 ? null : <Divider />}
          {segment.node}
        </span>
      ))}
    </>
  )
}

export function Statusline({
  frame,
  workspaceName,
}: {
  frame: TeamFrameModel | null
  // Off-team the line still has one true thing to say about where the reader is (design §D3's
  // second row): the workspace. It is stated only there — with a team in context the deck's
  // switcher names the workspace and band 3 reports the team's day instead.
  workspaceName: string | null
}) {
  const connection = useConnectionSummary()

  return (
    <footer
      data-testid="statusline"
      className="mt-auto flex h-8 min-h-8 shrink-0 items-center overflow-hidden border-t border-border bg-statusline-bg px-5 font-ui text-xs whitespace-nowrap text-text-2"
    >
      <Segments
        segments={[
          {
            id: 'workspace',
            node:
              frame !== null || workspaceName === null ? null : (
                <span data-testid="statusline-workspace">{workspaceName}</span>
              ),
          },
          {
            id: 'cycle',
            node:
              frame?.cycle == null ? null : (
                <span data-testid="statusline-cycle">
                  {frame.cycle.title}, day {frame.cycle.dayIndex} of {frame.cycle.dayCount}
                </span>
              ),
          },
          {
            id: 'shipped',
            node:
              frame?.shipped == null ? null : (
                <span data-testid="statusline-shipped">{frame.shipped} shipped</span>
              ),
          },
          {
            id: 'deploys',
            node:
              frame?.deploysThisWeek == null ? null : (
                <span data-testid="statusline-deploys">
                  {frame.deploysThisWeek} {frame.deploysThisWeek === 1 ? 'deploy' : 'deploys'} this
                  week
                </span>
              ),
          },
          {
            id: 'attention',
            // Absent at zero, not zeroed: a `0` claims four exception classes were evaluated.
            node:
              frame?.attention == null ? null : (
                <span
                  data-testid="statusline-attention"
                  className="font-semibold text-status-urgent-ink"
                >
                  <span data-testid="attention-count">{frame.attention.count}</span>{' '}
                  {frame.attention.count === 1 ? 'needs' : 'need'} attention
                </span>
              ),
          },
        ]}
      />
      <div className="ml-auto pl-4">
        <SyncIndicator connection={connection} />
      </div>
    </footer>
  )
}
