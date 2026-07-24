import { Link } from '@tanstack/react-router'
import { cn } from '@yapm/ui/lib/utils'
import { KanbanSquareIcon, ListIcon } from 'lucide-react'

const ACTIVE = 'bg-bg-elevated text-text-1 shadow-sm'
const INACTIVE = 'text-text-3 hover:text-text-1'

// The List ↔ Board toggle: two peer views of the same team-scoped issues. These are route
// navigation links, not an ARIA tab widget (no tabpanel, no roving tabindex), so they use a
// plain <nav> with aria-current marking the active view.
export function ViewSwitch({ teamId, current }: { teamId: string; current: 'list' | 'board' }) {
  return (
    <nav
      aria-label="Issue views"
      className="flex items-center gap-0.5 rounded-control bg-bg-sidebar p-0.5"
    >
      <Link
        to="/teams/$teamId/issues"
        params={{ teamId }}
        aria-current={current === 'list' ? 'page' : undefined}
        className={cn(
          'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'list' ? ACTIVE : INACTIVE,
        )}
      >
        <ListIcon className="size-3.5" />
        List
      </Link>
      <Link
        to="/teams/$teamId/board"
        params={{ teamId }}
        aria-current={current === 'board' ? 'page' : undefined}
        className={cn(
          'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'board' ? ACTIVE : INACTIVE,
        )}
      >
        <KanbanSquareIcon className="size-3.5" />
        Board
      </Link>
    </nav>
  )
}
