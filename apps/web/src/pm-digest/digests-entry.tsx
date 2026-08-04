import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { buttonVariants } from '@yapm/ui/components/button'
import { cn } from '@yapm/ui/lib/utils'
import { MegaphoneIcon } from 'lucide-react'
import { useMemo } from 'react'
import { type PmDigestRowData, readablePmDigests } from '@/pm-digest/model'
import { useSyncSession } from '@/zero/provider'

// The shell's way into `/digests`, and it does not exist for anybody the disclosure policy has not
// named — nor, once named, until a team has actually released something. It reads the same
// sync-session audience the route gates on and then the same query the surface renders, so the entry
// and the surface can never disagree about whether the reader has anything to read.
//
// The audience check comes FIRST and is a separate component, so an unnamed reader constructs no
// query at all: the shell must not ask the server anything on behalf of somebody the policy has
// never heard of.
export function PmDigestsEntry() {
  const { pmAudienceTeamIds } = useSyncSession()
  if (pmAudienceTeamIds.length === 0) return null

  return <PmDigestsEntryLink />
}

// A link rather than a button, on the inbox badge's precedent: it is in the tab order, so the
// surface is reachable with no pointer and without a second global keybinding.
function PmDigestsEntryLink() {
  const [rows] = useQuery(queries.pmDigests.inbox())
  // Memoized because this sits in the shell and runs on every navigation: each row's blob is parsed
  // before it counts, and the inbox is bounded at 50 of them.
  const readable = useMemo(() => readablePmDigests(rows as readonly PmDigestRowData[]), [rows])
  if (readable.length === 0) return null

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
