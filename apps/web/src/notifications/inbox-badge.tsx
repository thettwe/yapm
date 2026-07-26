import { Link } from '@tanstack/react-router'
import { Button } from '@yapm/ui/components/button'
import { BellIcon } from 'lucide-react'
import { formatUnreadCount, inboxBadgeLabel } from '@/notifications/model'
import { useInbox } from '@/notifications/use-inbox'

// The shell's unread badge: a link, not a button, so it is in the tab order and reachable with
// no pointer. It reads the SAME `notifications.mine` subscription the inbox list reads (design
// D18) — the count and the list can never disagree, and Zero dedupes the two into one query.
export function InboxBadge() {
  const { unread } = useInbox()

  return (
    <Button
      render={<Link to="/inbox" />}
      variant="ghost"
      size="icon-sm"
      className="relative"
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
    </Button>
  )
}
