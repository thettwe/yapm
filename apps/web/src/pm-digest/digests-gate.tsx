import { AppShell } from '@/components/app-shell'
import { PmDigestView } from '@/pm-digest/pm-digest-view'
import { useSyncSession } from '@/zero/provider'

// ABSENCE IS THE GRACEFUL DEGRADATION, and this is the deliberate departure from `ai-agent`'s "every
// consumer SHALL provide an AI-off fallback that renders the raw linked evidence": this reader HAS no
// raw evidence to fall back to — every entity behind the prose belongs to a team they are not on. An
// empty state would announce that an artifact exists and that they cannot have it, which says more
// than saying nothing.
//
// NO `useQuery` RUNS ON THIS PATH — not one that returns nothing, not one at all. The audience is
// read from the sync-session state the provider already resolved from the credential, so deciding
// whether the surface exists costs no round trip and issues no disclosure query.
export function PmDigestsGate() {
  const { pmAudienceTeamIds } = useSyncSession()
  if (pmAudienceTeamIds.length === 0) return null

  return (
    <AppShell current="Product digests">
      <PmDigestView />
    </AppShell>
  )
}
