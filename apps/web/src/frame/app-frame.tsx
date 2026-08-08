import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { cn } from '@yapm/ui/lib/utils'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { AppearanceDialog } from '@/frame/appearance-dialog'
import { useCommandSource } from '@/frame/command-registry'
import { Deck, type DeckStop } from '@/frame/deck'
import { useGoTo } from '@/frame/go-to'
import { Statusline } from '@/frame/statusline'
import { type FrameTeam, useAnchorTeam, useTeamFrame } from '@/frame/team-context'
import { useSyncRecovery } from '@/zero/recovery'

// The frame: band 1 (the deck), the page's `<main>`, band 3 (the statusline). Two of the three
// bands belong to the app and are identical everywhere; band 2 belongs to the page.
//
// The statusline is `margin-top:auto` in a `min-h-svh` column, exactly as the mocks do it, so it
// sits at the bottom of a short page and after the content on a long one.

// `measure` replaces `AppShell`'s `wide` boolean: `full` is an edge-to-edge work surface owning its
// own padding, `wide` is Home's editorial column, `default` is every reading surface.
export type FrameMeasure = 'default' | 'wide' | 'full'

const MEASURE_CLASS: Record<FrameMeasure, string> = {
  default: 'mx-auto w-full max-w-3xl flex-1 gap-8 p-6',
  wide: 'mx-auto w-full max-w-[960px] flex-1 gap-8 p-6',
  full: 'w-full min-h-0 flex-1',
}

export function AppFrame({
  teamId,
  current,
  measure = 'default',
  children,
}: {
  // The route's team, when it has one. Absent on `/`, `/inbox`, `/search`, `/digests` and
  // `/settings/*` — where the deck stays present and useful but the statusline says nothing about
  // a team, because it would be asserting a fact about a team the reader is not on (design §D3).
  teamId?: string
  current?: DeckStop
  measure?: FrameMeasure
  children: ReactNode
}) {
  const anchor = useAnchorTeam(teamId)
  const frame = useTeamFrame(teamId)
  const [workspace] = useQuery(queries.workspace.current())
  // The team the reader is ON, which is the anchor only when the route named it. A route naming a
  // team the caller cannot see resolves to null: the stops still point somewhere useful, and band 3
  // says nothing.
  const routeTeam: FrameTeam | null = teamId !== undefined && anchor?.id === teamId ? anchor : null

  // Appearance is a SETTING, so it lives in the account menu (§D8) — but the palette advertises the
  // same set the frame offers, so the menu item and the palette command must drive one dialog
  // rather than two copies of the same state.
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const openAppearance = useCallback(() => setAppearanceOpen(true), [])

  useGoTo(anchor?.id ?? null)
  useFrameCommands(anchor, openAppearance)

  return (
    <div className="flex min-h-svh flex-col bg-bg">
      <Deck
        anchor={anchor}
        routeTeam={routeTeam}
        attention={frame?.attention ?? null}
        onOpenAppearance={openAppearance}
        {...(current === undefined || routeTeam === null ? {} : { current })}
      />
      <main className={cn('flex flex-col', MEASURE_CLASS[measure])}>{children}</main>
      <Statusline frame={frame} workspaceName={workspace?.name ?? null} />
      {/* Mounted only once asked for: the fields read the theme context, and neither the account
          menu nor the palette may require one to open. */}
      {appearanceOpen ? <AppearanceDialog open onOpenChange={setAppearanceOpen} /> : null}
    </div>
  )
}

// The palette's always-present group: the destinations the deck offers, the two workspace doorways
// in its right cluster, and appearance — the settings entry §D8 folded into the account menu, which
// the palette must still reach or the menu becomes its only home. Registered rather than bound —
// the registry owns ⌘K.
//
// Sync recovery joins the group only while the backoff has stretched far enough to offer a retry:
// band 3 sits at the END of the document, so a keyboard-only reader must not have to Tab a long
// page to reach the one control that gets them writing again.
function useFrameCommands(anchor: FrameTeam | null, openAppearance: () => void): void {
  const navigate = useNavigate()
  const { retryOffered, retryNow } = useSyncRecovery()
  const teamId = anchor?.id ?? null

  const groups = useMemo(() => {
    const commands = [
      {
        id: 'frame:inbox',
        label: 'Go to inbox',
        onSelect: () => void navigate({ to: '/inbox' }),
      },
      {
        id: 'frame:search',
        label: 'Search everything',
        onSelect: () => void navigate({ to: '/search', search: {} }),
      },
      {
        id: 'frame:workspace',
        label: 'Go to workspace overview',
        onSelect: () => void navigate({ to: '/' }),
      },
      {
        id: 'frame:appearance',
        label: 'Appearance',
        onSelect: openAppearance,
      },
      ...(retryOffered
        ? [{ id: 'frame:retry-sync', label: 'Retry sync now', onSelect: retryNow }]
        : []),
    ]
    if (teamId === null) return [{ id: 'frame', heading: 'Go to', commands }]

    return [
      {
        id: 'frame',
        heading: 'Go to',
        commands: [
          {
            id: 'frame:home',
            label: 'Home',
            shortcut: 'g h',
            onSelect: () => void navigate({ to: '/teams/$teamId', params: { teamId } }),
          },
          {
            id: 'frame:issues',
            label: 'Issues',
            shortcut: 'g i',
            onSelect: () =>
              void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: {} }),
          },
          {
            id: 'frame:triage',
            label: 'Triage',
            shortcut: 'g t',
            onSelect: () => void navigate({ to: '/teams/$teamId/triage', params: { teamId } }),
          },
          {
            id: 'frame:cycles',
            label: 'Cycles',
            shortcut: 'g c',
            onSelect: () => void navigate({ to: '/teams/$teamId/cycles', params: { teamId } }),
          },
          {
            id: 'frame:delivery',
            label: 'Delivery',
            shortcut: 'g d',
            onSelect: () =>
              void navigate({
                to: '/teams/$teamId/delivery',
                params: { teamId },
                search: { window: 6 },
              }),
          },
          {
            id: 'frame:retros',
            label: 'Retros',
            shortcut: 'g r',
            onSelect: () => void navigate({ to: '/teams/$teamId/retros', params: { teamId } }),
          },
          {
            id: 'frame:projects',
            label: 'Projects',
            shortcut: 'g p',
            onSelect: () =>
              void navigate({ to: '/teams/$teamId/projects', params: { teamId }, search: {} }),
          },
          {
            id: 'frame:roadmap',
            label: 'Roadmap',
            shortcut: 'g m',
            onSelect: () => void navigate({ to: '/teams/$teamId/roadmap', params: { teamId } }),
          },
          ...commands,
        ],
      },
    ]
  }, [navigate, teamId, openAppearance, retryOffered, retryNow])

  const source = useMemo(() => ({ groups }), [groups])
  useCommandSource('frame', source)
}
