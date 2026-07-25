import { Link } from '@tanstack/react-router'
import { Button } from '@yapm/ui/components/button'
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import { ChevronDownIcon, UserIcon } from 'lucide-react'
import { useMembership } from '@/auth/use-membership'
import { useSignOut } from '@/auth/use-sign-out'

export function UserMenu({ name, email }: { name?: string; email?: string }) {
  const signOut = useSignOut()
  const { canManage } = useMembership()
  const label = name ?? email ?? 'Account'

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={`Account menu for ${label}`}>
            <UserIcon />
            <span className="max-w-32 truncate">{label}</span>
            <ChevronDownIcon />
          </Button>
        }
      />
      <MenuContent>
        {email ? (
          <>
            <MenuGroupLabel>Signed in as {email}</MenuGroupLabel>
            <MenuSeparator />
          </>
        ) : null}
        {canManage ? (
          <>
            <MenuLinkItem render={<Link to="/settings/connectors">Connectors</Link>} />
            <MenuLinkItem render={<Link to="/settings/ai">AI</Link>} />
          </>
        ) : null}
        <MenuItem onClick={signOut.signOut} disabled={signOut.busy}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
