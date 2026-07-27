import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { buttonVariants } from '@yapm/ui/components/button'
import { cn } from '@yapm/ui/lib/utils'
import { SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSession } from '@/auth/client'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { InboxBadge } from '@/notifications/inbox-badge'
import { useConnectionSummary } from '@/zero/connection'

export function AppShell({ current, children }: { current: string; children: ReactNode }) {
  const connection = useConnectionSummary()
  const { data: session } = useSession()
  const [workspace] = useQuery(queries.workspace.current())

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <Switcher current={current} />
        <div className="flex-1" />
        <ConnectionStatus connection={connection} />
        <SearchEntry />
        <InboxBadge />
        <ThemeControls />
        <UserMenu
          {...(session?.user.name ? { name: session.user.name } : {})}
          {...(session?.user.email ? { email: session.user.email } : {})}
        />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
        {workspace ? null : (
          <p className="text-muted-foreground text-sm" role="status">
            Loading workspace…
          </p>
        )}
        {children}
      </main>
    </div>
  )
}

// The route's entry point in the shell, a LINK for the same reason the inbox badge is one: it is
// in the tab order, so `/search` is reachable with no pointer and without a second keybinding.
// Cmd-K stays the product's only global shortcut, and its "search everything" row is the other way
// in — one question, two depths, one binding.
function SearchEntry() {
  return (
    <Link
      to="/search"
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
      aria-label="Search"
      data-testid="search-entry"
    >
      <SearchIcon />
    </Link>
  )
}
