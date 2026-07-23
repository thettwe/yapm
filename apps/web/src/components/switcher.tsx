import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import { ChevronsUpDownIcon } from 'lucide-react'

// The workspace/team switcher: the single workspace plus every non-archived team, each a
// link into its own view. Base UI Menu gives arrow-key navigation and focus return for free.
export function Switcher({ current }: { current: string }) {
  const [workspace] = useQuery(queries.workspace.current())
  const [teams] = useQuery(queries.teams.all())

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Switch workspace or team">
            <span className="max-w-40 truncate">{current}</span>
            <ChevronsUpDownIcon />
          </Button>
        }
      />
      <MenuContent>
        <MenuGroupLabel>Workspace</MenuGroupLabel>
        <MenuLinkItem render={<Link to="/">{workspace?.name ?? 'Workspace'}</Link>} />
        {teams.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroupLabel>Teams</MenuGroupLabel>
            {teams.map((team) => (
              <MenuLinkItem
                key={team.id}
                render={
                  <Link to="/teams/$teamId" params={{ teamId: team.id }}>
                    {team.name}
                  </Link>
                }
              />
            ))}
          </>
        ) : null}
      </MenuContent>
    </Menu>
  )
}
