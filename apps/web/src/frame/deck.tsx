import { Link } from '@tanstack/react-router'
import type { TeamHomeAttention } from '@yapm/schema'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuLinkItem,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import { cn } from '@yapm/ui/lib/utils'
import { useSession } from '@/auth/client'
import { Switcher } from '@/components/switcher'
import { UserMenu } from '@/components/user-menu'
import type { FrameTeam } from '@/frame/team-context'
import { InboxBadge } from '@/notifications/inbox-badge'

// Band 1 — the deck. 48px, identical on every page, pixel for pixel: nothing in it adapts to the
// page except which stop is current. Workspace mark · org / team · chevron, then the six stops,
// then the ⌘K pill, the attention badge, Inbox and the user chip.
//
// `more▾` is a TRANSIENT, never a destination — so it never carries `aria-current`, and the page it
// leads to marks the item inside it instead. Decisions (`g d` in the mock's open menu) folds away
// entirely: no entity backs it, and a disabled row is chrome promising what the product cannot keep.

export type DeckStop =
  | 'home'
  | 'issues'
  | 'triage'
  | 'cycles'
  | 'delivery'
  | 'retros'
  | 'projects'
  | 'roadmap'

const STOP_CLASS =
  'relative flex h-12 items-center px-[11px] font-ui text-[13px] text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset'
// The active stop: `ia.html` draws accent text plus a 2px accent underline. The underline is the
// accent's; the INK is `--text-1`, because `--accent-strong` on `--bg` lands at ~4.44 in editorial
// light and a current-page marker that misses AA in one theme is not a marker (see
// `packages/ui/src/styles/contrast.test.ts`). Weight and the rule carry the state.
const STOP_ACTIVE =
  'text-text-1 font-semibold after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'

function stopClass(active: boolean): string {
  return cn(STOP_CLASS, active && STOP_ACTIVE)
}

function current(active: boolean): 'page' | undefined {
  return active ? 'page' : undefined
}

export function Deck({
  anchor,
  routeTeam,
  attention,
  current: stop,
}: {
  // Where the six stops point: the route's team, else the remembered one, else the first.
  anchor: FrameTeam | null
  // The team the reader is actually on, or null on a workspace page. Only this names the deck's
  // team half and only this may carry a badge.
  routeTeam: FrameTeam | null
  attention: TeamHomeAttention | null
  current?: DeckStop
}) {
  const { data: session } = useSession()

  return (
    <header
      data-testid="deck"
      className="flex h-12 min-h-12 shrink-0 items-center overflow-hidden border-b border-border bg-bg px-5"
    >
      <Switcher
        {...(routeTeam === null ? {} : { teamName: routeTeam.name, teamId: routeTeam.id })}
      />
      {/* A workspace with no teams at all drops the six stops rather than disabling them: an offer
          that leads nowhere is worse than no offer. */}
      {anchor === null ? null : <Destinations teamId={anchor.id} stop={stop} />}
      <div className="ml-auto flex shrink-0 items-center gap-4 pl-4">
        <SearchEntry />
        <AttentionBadge attention={attention} teamId={routeTeam?.id ?? null} />
        <InboxBadge />
        <UserMenu
          {...(session?.user.name ? { name: session.user.name } : {})}
          {...(session?.user.email ? { email: session.user.email } : {})}
        />
      </div>
    </header>
  )
}

function Destinations({ teamId, stop }: { teamId: string; stop: DeckStop | undefined }) {
  return (
    <nav aria-label="Destinations" className="ml-6 flex h-12 items-stretch">
      {/* `exact`, because the router's own active state ADDS `aria-current="page"` and cannot be
          overridden — and `/teams/$teamId` is a prefix of every other stop, so without it the bar
          would claim two current pages everywhere. Which stop is current is the frame's call: Board
          is a lens on Issues, and an issue detail is a doorway from it. */}
      <Link
        to="/teams/$teamId"
        params={{ teamId }}
        activeOptions={{ exact: true }}
        aria-current={current(stop === 'home')}
        className={stopClass(stop === 'home')}
      >
        Home
      </Link>
      <Link
        to="/teams/$teamId/issues"
        params={{ teamId }}
        search={{}}
        aria-current={current(stop === 'issues')}
        className={stopClass(stop === 'issues')}
      >
        Issues
      </Link>
      <Link
        to="/teams/$teamId/triage"
        params={{ teamId }}
        aria-current={current(stop === 'triage')}
        className={cn(stopClass(stop === 'triage'), 'hidden sm:flex')}
      >
        Triage
      </Link>
      <Link
        to="/teams/$teamId/cycles"
        params={{ teamId }}
        aria-current={current(stop === 'cycles')}
        className={cn(stopClass(stop === 'cycles'), 'hidden md:flex')}
      >
        Cycles
      </Link>
      <Link
        to="/teams/$teamId/delivery"
        params={{ teamId }}
        search={{ window: 6 as const }}
        aria-current={current(stop === 'delivery')}
        className={cn(stopClass(stop === 'delivery'), 'hidden lg:flex')}
      >
        Delivery
      </Link>
      <MoreMenu teamId={teamId} stop={stop} />
    </nav>
  )
}

// Below the deck's comfortable width the stops fold into this menu from the RIGHT — Delivery first,
// then Cycles, then Triage — and the band never wraps to a second row. Its 48px height is a rule.
function MoreMenu({ teamId, stop }: { teamId: string; stop: DeckStop | undefined }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button type="button" className={cn(STOP_CLASS, 'shrink-0')}>
            more
            <span aria-hidden="true" className="mt-px ml-1 text-[9px] text-text-3">
              ▾
            </span>
          </button>
        }
      />
      <MenuContent>
        <MenuGroup className="lg:hidden">
          <MenuGroupLabel>Team</MenuGroupLabel>
          <MenuLinkItem
            className="sm:hidden"
            render={
              <Link to="/teams/$teamId/triage" params={{ teamId }}>
                Triage
                <Kbd>g t</Kbd>
              </Link>
            }
          />
          <MenuLinkItem
            className="md:hidden"
            render={
              <Link to="/teams/$teamId/cycles" params={{ teamId }}>
                Cycles
                <Kbd>g c</Kbd>
              </Link>
            }
          />
          <MenuLinkItem
            render={
              <Link
                to="/teams/$teamId/delivery"
                params={{ teamId }}
                search={{ window: 6 as const }}
              >
                Delivery
                <Kbd>g d</Kbd>
              </Link>
            }
          />
        </MenuGroup>
        <MenuGroup>
          <MenuGroupLabel>More</MenuGroupLabel>
          <MenuLinkItem
            render={
              <Link
                to="/teams/$teamId/retros"
                params={{ teamId }}
                aria-current={current(stop === 'retros')}
              >
                Retros
                <Kbd>g r</Kbd>
              </Link>
            }
          />
          <MenuLinkItem
            render={
              <Link
                to="/teams/$teamId/projects"
                params={{ teamId }}
                search={{}}
                aria-current={current(stop === 'projects')}
              >
                Projects
                <Kbd>g p</Kbd>
              </Link>
            }
          />
          <MenuLinkItem
            render={
              <Link
                to="/teams/$teamId/roadmap"
                params={{ teamId }}
                aria-current={current(stop === 'roadmap')}
              >
                Roadmap
                <Kbd>g m</Kbd>
              </Link>
            }
          />
        </MenuGroup>
      </MenuContent>
    </Menu>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <span className="ml-auto rounded border border-border-strong px-1 font-mono text-[10px] text-text-3">
      {children}
    </span>
  )
}

// A LINK, for the same reason the inbox badge is one: it is in the tab order, so `/search` is
// reachable with no pointer and without a second keybinding. ⌘K stays the product's only global
// shortcut, and its "search everything" row is the other way in — one question, two depths, one
// binding.
function SearchEntry() {
  return (
    <Link
      to="/search"
      search={{}}
      aria-label="Search"
      data-testid="search-entry"
      className="flex h-7 items-center gap-1.5 rounded-control border border-border px-2 font-ui text-[13.5px] text-text-3 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span aria-hidden="true">⌕</span>
      <span
        aria-hidden="true"
        className="rounded border border-border-strong px-1 font-mono text-[10px]"
      >
        ⌘K
      </span>
    </Link>
  )
}

// ABSENT at zero, never a zeroed badge: `0` would be a claim that four exception classes were
// evaluated and all came back empty, which off-team and pre-sync is exactly what is not known.
export function AttentionBadge({
  attention,
  teamId,
}: {
  attention: TeamHomeAttention | null
  teamId: string | null
}) {
  if (attention === null || teamId === null) return null

  return (
    <Link
      to="/teams/$teamId"
      params={{ teamId }}
      data-testid="attention-badge"
      aria-label={`${attention.count} ${attention.count === 1 ? 'issue needs' : 'issues need'} attention`}
      className="flex h-6 items-center gap-1.5 rounded-pill bg-urgent-soft px-2.5 font-ui text-xs font-semibold text-status-urgent-ink outline-none hover:bg-urgent-soft focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-status-urgent" />
      <span aria-hidden="true" data-testid="attention-count">
        {attention.count}
      </span>
    </Link>
  )
}
