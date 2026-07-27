import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { SearchTarget } from '@/search/results'

/**
 * The one place a search result turns into a navigation. Both surfaces call it, so opening a hit
 * from Cmd-K and opening the same hit from `/search` land on the same URL — which is what makes
 * the browser back button behave the same way from either.
 *
 * An issue always carries its OWN team, never the surface's: the palette's on-device group reads
 * `issues.mine`, which spans every team the caller belongs to, so a hit from another team must not
 * be opened under the team whose list happens to be behind the dialog.
 */
export function useOpenSearchResult(): (target: SearchTarget) => void {
  const navigate = useNavigate()

  return useCallback(
    (target: SearchTarget) => {
      switch (target.kind) {
        case 'issue':
          void navigate({
            to: '/teams/$teamId/issues',
            params: { teamId: target.teamId },
            search: { open: target.issueId },
          })
          return
        case 'project':
          void navigate({
            to: '/teams/$teamId/projects',
            params: { teamId: target.teamId },
            search: { open: target.projectId },
          })
          return
        case 'cycles':
          void navigate({ to: '/teams/$teamId/cycles', params: { teamId: target.teamId } })
          return
        case 'team':
          void navigate({
            to: '/teams/$teamId/issues',
            params: { teamId: target.teamId },
            search: {},
          })
      }
    },
    [navigate],
  )
}
