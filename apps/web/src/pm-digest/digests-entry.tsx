import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@yapm/ui/components/button'
import { cn } from '@yapm/ui/lib/utils'
import { MegaphoneIcon } from 'lucide-react'
import { useSyncSession } from '@/zero/provider'

// The shell's way into `/digests`, and it does not exist for anybody the disclosure policy has not
// named. It reads the same sync-session audience the route gates on — one fact, one decision, so the
// entry and the surface can never disagree about whether the reader has anything to read.
//
// A link rather than a button, on the inbox badge's precedent: it is in the tab order, so the
// surface is reachable with no pointer and without a second global keybinding.
export function PmDigestsEntry() {
  const { pmAudienceTeamIds } = useSyncSession()
  if (pmAudienceTeamIds.length === 0) return null

  return (
    <Link
      to="/digests"
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
      aria-label="Product digests shared with you"
      data-testid="pm-digests-entry"
    >
      <MegaphoneIcon />
    </Link>
  )
}
