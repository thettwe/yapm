import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'

// The deck's left end: workspace mark · org name · `/` · team name · chevron, drawn as `ia.html`
// draws it. The chevron opens the workspace/team switcher — the single workspace plus every
// non-archived team, each a link into its own view, and the current team's roster underneath it.
// Base UI Menu gives arrow-key navigation, Escape and focus return for free.
export function Switcher({ teamName, teamId }: { teamName?: string; teamId?: string }) {
  const [workspace] = useQuery(queries.workspace.current())
  const [teams] = useQuery(queries.teams.all())
  const orgName = workspace?.name ?? 'Workspace'

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Switch workspace or team"
            className="flex h-8 shrink-0 items-center gap-[7px] rounded-control px-1.5 font-ui text-[13px] outline-none hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span
              aria-hidden="true"
              className="flex size-5 items-center justify-center rounded-[6px] bg-accent text-[10.5px] font-bold text-on-accent"
            >
              {orgName.trim().charAt(0).toUpperCase() || 'W'}
            </span>
            <span className="max-w-32 truncate text-text-3">{orgName}</span>
            {teamName === undefined ? null : (
              <>
                <span aria-hidden="true" className="text-text-3">
                  /
                </span>
                <span className="max-w-40 truncate font-semibold text-text-1">{teamName}</span>
              </>
            )}
            <span aria-hidden="true" className="mt-px text-[9px] text-text-3">
              ▾
            </span>
          </button>
        }
      />
      <MenuContent>
        {/* Each label belongs to the group it names: a group label reads its group off context and
            THROWS without one, which takes the whole popup down the moment it opens. */}
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuLinkItem render={<Link to="/">{orgName}</Link>} />
        </MenuGroup>
        {teams.length > 0 ? (
          <>
            <MenuSeparator />
            {/* `exact`, on the deck's precedent: `/teams/$teamId` is a prefix of every team page,
                so without it the router marks this row current — and `MenuLinkItem` now DRAWS what
                it marks — on every sub-route, while activating it goes to team Home. */}
            <MenuGroup>
              <MenuGroupLabel>Teams</MenuGroupLabel>
              {teams.map((team) => (
                <MenuLinkItem
                  key={team.id}
                  render={
                    <Link
                      to="/teams/$teamId"
                      params={{ teamId: team.id }}
                      activeOptions={{ exact: true }}
                    >
                      {team.name}
                    </Link>
                  }
                />
              ))}
            </MenuGroup>
          </>
        ) : null}
        {teamId === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>This team</MenuGroupLabel>
              <MenuLinkItem
                render={
                  <Link to="/teams/$teamId/members" params={{ teamId }}>
                    Members
                  </Link>
                }
              />
            </MenuGroup>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
