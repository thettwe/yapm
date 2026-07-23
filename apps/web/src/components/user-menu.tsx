import { Button } from '@yapm/ui/components/button'
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import { ChevronDownIcon, UserIcon } from 'lucide-react'
import { useSignOut } from '@/auth/use-sign-out'

export function UserMenu({ name, email }: { name?: string; email?: string }) {
  const signOut = useSignOut()
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
        <MenuItem onClick={signOut.signOut} disabled={signOut.busy}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
