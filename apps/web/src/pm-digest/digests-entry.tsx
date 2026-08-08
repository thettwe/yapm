import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { MenuLinkItem } from '@yapm/ui/components/menu'
import { useMemo } from 'react'
import { type PmDigestRowData, readablePmDigests } from '@/pm-digest/model'
import { useSyncSession } from '@/zero/provider'

// The frame's way into `/digests`, and it does not exist for anybody the disclosure policy has not
// named — nor, once named, until a team has actually released something. It reads the same
// sync-session audience the route gates on and then the same query the surface renders, so the entry
// and the surface can never disagree about whether the reader has anything to read.
//
// The audience check comes FIRST and is a separate component, so an unnamed reader constructs no
// query at all: the frame must not ask the server anything on behalf of somebody the policy has
// never heard of.
export function PmDigestsMenuEntry() {
  const { pmAudienceTeamIds } = useSyncSession()
  if (pmAudienceTeamIds.length === 0) return null

  return <PmDigestsMenuLink />
}

// A link rather than a button, on the inbox badge's precedent: it is in the tab order, so the
// surface is reachable with no pointer and without a second global keybinding. It sits in the
// account menu because it is a doorway for a named reader, not one of the six destinations.
function PmDigestsMenuLink() {
  const [rows] = useQuery(queries.pmDigests.inbox())
  // Memoized because this sits in the frame and runs on every navigation: each row's blob is parsed
  // before it counts, and the inbox is bounded at 50 of them.
  const readable = useMemo(() => readablePmDigests(rows as readonly PmDigestRowData[]), [rows])
  if (readable.length === 0) return null

  return (
    <MenuLinkItem
      data-testid="pm-digests-entry"
      render={
        <Link to="/digests" aria-label="Product digests shared with you">
          Product digests
        </Link>
      }
    />
  )
}
