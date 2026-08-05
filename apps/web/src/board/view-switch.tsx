import { Link } from '@tanstack/react-router'
import { cn } from '@yapm/ui/lib/utils'
import {
  GaugeIcon,
  InboxIcon,
  KanbanSquareIcon,
  ListIcon,
  MapIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  RocketIcon,
} from 'lucide-react'

const ACTIVE = 'bg-bg-elevated text-text-1 shadow-sm'
const INACTIVE = 'text-text-3 hover:text-text-1'

const LINK_CLASS =
  'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-medium transition-colors'

// The List ↔ Board ↔ Cycles ↔ Triage ↔ Retros ↔ Delivery toggle: peer views of the same
// team-scoped work.
// These are route navigation links, not an ARIA tab widget (no tabpanel, no roving tabindex), so
// they use a plain <nav> with aria-current marking the active view.
export function ViewSwitch({
  teamId,
  current,
}: {
  teamId: string
  current: 'list' | 'board' | 'cycles' | 'triage' | 'projects' | 'roadmap' | 'retros' | 'delivery'
}) {
  return (
    <nav
      aria-label="Issue views"
      className="flex items-center gap-0.5 rounded-control bg-bg-sidebar p-0.5"
    >
      <Link
        to="/teams/$teamId/issues"
        params={{ teamId }}
        aria-current={current === 'list' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'list' ? ACTIVE : INACTIVE)}
      >
        <ListIcon className="size-3.5" />
        List
      </Link>
      <Link
        to="/teams/$teamId/board"
        params={{ teamId }}
        aria-current={current === 'board' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'board' ? ACTIVE : INACTIVE)}
      >
        <KanbanSquareIcon className="size-3.5" />
        Board
      </Link>
      <Link
        to="/teams/$teamId/cycles"
        params={{ teamId }}
        aria-current={current === 'cycles' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'cycles' ? ACTIVE : INACTIVE)}
      >
        <RefreshCwIcon className="size-3.5" />
        Cycles
      </Link>
      <Link
        to="/teams/$teamId/triage"
        params={{ teamId }}
        aria-current={current === 'triage' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'triage' ? ACTIVE : INACTIVE)}
      >
        <InboxIcon className="size-3.5" />
        Triage
      </Link>
      <Link
        to="/teams/$teamId/retros"
        params={{ teamId }}
        aria-current={current === 'retros' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'retros' ? ACTIVE : INACTIVE)}
      >
        <MessagesSquareIcon className="size-3.5" />
        Retros
      </Link>
      <Link
        to="/teams/$teamId/delivery"
        params={{ teamId }}
        search={{ window: 6 }}
        aria-current={current === 'delivery' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'delivery' ? ACTIVE : INACTIVE)}
      >
        <GaugeIcon className="size-3.5" />
        Delivery
      </Link>
      <Link
        to="/teams/$teamId/projects"
        params={{ teamId }}
        aria-current={current === 'projects' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'projects' ? ACTIVE : INACTIVE)}
      >
        <RocketIcon className="size-3.5" />
        Projects
      </Link>
      <Link
        to="/teams/$teamId/roadmap"
        params={{ teamId }}
        aria-current={current === 'roadmap' ? 'page' : undefined}
        className={cn(LINK_CLASS, current === 'roadmap' ? ACTIVE : INACTIVE)}
      >
        <MapIcon className="size-3.5" />
        Roadmap
      </Link>
    </nav>
  )
}
