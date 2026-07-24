import { Link } from '@tanstack/react-router'
import { cn } from '@yapm/ui/lib/utils'
import { KanbanSquareIcon, ListIcon } from 'lucide-react'

const ACTIVE = 'bg-bg-elevated text-text-1 shadow-sm'
const INACTIVE = 'text-text-3 hover:text-text-1'

// The List ↔ Board toggle: two peer views of the same team-scoped issues.
export function ViewSwitch({ teamId, current }: { teamId: string; current: 'list' | 'board' }) {
  return (
    <div className="flex items-center gap-0.5 rounded-control bg-bg-sidebar p-0.5" role="tablist">
      <Link
        to="/teams/$teamId/issues"
        params={{ teamId }}
        role="tab"
        aria-selected={current === 'list'}
        className={cn(
          'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'list' ? ACTIVE : INACTIVE,
        )}
      >
        <ListIcon className="size-3.5" />
        List
      </Link>
      <Link
        to="/teams/$teamId/board"
        params={{ teamId }}
        role="tab"
        aria-selected={current === 'board'}
        className={cn(
          'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'board' ? ACTIVE : INACTIVE,
        )}
      >
        <KanbanSquareIcon className="size-3.5" />
        Board
      </Link>
    </div>
  )
}
