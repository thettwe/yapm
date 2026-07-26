import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@yapm/ui/components/button'
import { cn } from '@yapm/ui/lib/utils'
import { BellIcon } from 'lucide-react'
import { formatUnreadCount, inboxBadgeLabel } from '@/notifications/model'
import { useInbox } from '@/notifications/use-inbox'

// The shell's unread badge: a link, not a button, so it is in the tab order and reachable with
// no pointer. It reads the SAME `notifications.mine` subscription the inbox list reads (design
// D18) — the count and the list can never disagree, and Zero dedupes the two into one query.
//
// It wears the button styling rather than being a `Button`: Base UI's button assumes a native
// <button> and says so on the console when handed an anchor, and forcing `nativeButton={false}`
// would answer that by giving a navigation control the button role. A link that looks like a
// button is the honest shape.
export function InboxBadge() {
  const { unread } = useInbox()

  return (
    <Link
      to="/inbox"
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative')}
      aria-label={inboxBadgeLabel(unread)}
      data-testid="inbox-badge"
      data-unread={String(unread)}
    >
      <BellIcon />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-pill bg-accent px-1 font-mono text-[10px] leading-4 font-medium tabular-nums text-on-accent"
        >
          {formatUnreadCount(unread)}
        </span>
      ) : null}
    </Link>
  )
}
