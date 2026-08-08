import { Link } from '@tanstack/react-router'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import { useMembership } from '@/auth/use-membership'
import { useSignOut } from '@/auth/use-sign-out'
import { PmDigestsMenuEntry } from '@/pm-digest/digests-entry'

// The deck's user chip and everything that is a SETTING rather than a destination: appearance, the
// workspace settings an admin may reach, the dev showcase, the conditional product-digests doorway,
// and sign out (design app-frame §D8).
//
// The appearance DIALOG belongs to the frame, not to this menu: the palette offers the same entry,
// and two owners of the same dialog state is two ways to be looking at different truths.
export function UserMenu({
  name,
  email,
  onOpenAppearance,
}: {
  name?: string
  email?: string
  onOpenAppearance: () => void
}) {
  const signOut = useSignOut()
  const { canManage } = useMembership()
  const label = name ?? email ?? 'Account'

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account menu for ${label}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-text-2 font-ui text-[9px] font-semibold text-bg outline-none hover:bg-text-1 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true">{initials(label)}</span>
          </button>
        }
      />
      <MenuContent>
        {/* A group label reads its group off context and THROWS without one, which takes the whole
              popup — every settings entry and Sign out with it — down on open. So every label this
              app renders lives inside its `MenuGroup`. */}
        {email ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>Signed in as {email}</MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem onClick={onOpenAppearance}>Appearance</MenuItem>
        <PmDigestsMenuEntry />
        {canManage ? (
          <>
            <MenuLinkItem render={<Link to="/settings/connectors">Connectors</Link>} />
            <MenuLinkItem render={<Link to="/settings/ai">AI</Link>} />
            <MenuLinkItem render={<Link to="/settings/sso">Single sign-on</Link>} />
          </>
        ) : null}
        {/* A plain anchor, not a typed `Link`: the showcase route is stripped from production
              builds, so the router has no such destination to point a `Link` at there. */}
        {import.meta.env.DEV ? (
          <MenuLinkItem render={<a href="/showcase">Component showcase</a>} />
        ) : null}
        <MenuItem onClick={signOut.signOut} disabled={signOut.busy}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function initials(label: string): string {
  const letters = label
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
  return letters === '' ? '?' : letters
}
