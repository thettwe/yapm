import { Link } from '@tanstack/react-router'
import { cn } from '@yapm/ui/lib/utils'

// Board is a LENS on Issues, not a peer destination (design app-frame §D5, per `issues.html`): both
// `/teams/$teamId/issues` and `/teams/$teamId/board` keep the Issues bar stop current, and the
// toggle says which lens is on with `aria-pressed` rather than letting the bar claim two current
// pages. `issues.html` draws a third lens, Gallery; it folds away — no entity backs it.
const LENS =
  'rounded-control px-2 py-0.5 font-ui text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent'

export function IssuesLens({ teamId, current }: { teamId: string; current: 'list' | 'board' }) {
  return (
    <div className="flex items-center gap-0.5 rounded-control bg-bg-sidebar p-0.5">
      <Link
        to="/teams/$teamId/issues"
        params={{ teamId }}
        search={{}}
        aria-pressed={current === 'list'}
        className={cn(
          LENS,
          current === 'list' ? 'bg-bg-elevated text-text-1 shadow-sm' : 'text-text-3',
        )}
      >
        List
      </Link>
      <Link
        to="/teams/$teamId/board"
        params={{ teamId }}
        aria-pressed={current === 'board'}
        className={cn(
          LENS,
          current === 'board' ? 'bg-bg-elevated text-text-1 shadow-sm' : 'text-text-3',
        )}
      >
        Board
      </Link>
    </div>
  )
}
