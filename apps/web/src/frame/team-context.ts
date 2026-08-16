import { useQuery } from '@rocicorp/zero/react'
import {
  buildTeamFrame,
  queries,
  type TeamFrameModel,
  type TeamHomeCycleRow,
  type TeamHomeDeploymentRow,
  type TeamHomeIssueRow,
  type TeamHomeTriageRow,
  type WorkspaceRole,
} from '@yapm/schema'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

// Which team the deck points at, and what band 3 is allowed to say about it.
//
// The northstar assumes one team ("Acme / Engineering"); yapm is one workspace of many teams, and
// six routes are workspace-level. The rule this file encodes (design §D3): the deck MAY point at a
// team — navigation is an offer, and an offer can be wrong without lying — but the statusline may
// only report the team the reader is actually on. So the anchor drives the six stops everywhere,
// while the frame model is built only from a team in the route.

export const ANCHOR_STORAGE_KEY = 'yapm.frame.team'

export interface FrameTeam {
  readonly id: string
  readonly name: string
  readonly key: string
}

// Guarded on `theme.ts`'s pattern: a browser with storage disabled still gets a working frame.
export function readAnchorTeam(): string | null {
  try {
    return localStorage.getItem(ANCHOR_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeAnchorTeam(teamId: string): void {
  try {
    localStorage.setItem(ANCHOR_STORAGE_KEY, teamId)
  } catch {
    // Ignore quota / disabled-storage failures; the anchor falls back to the first team.
  }
}

// The route wins, then the remembered team, then the first team the caller can see. The remembered
// id is validated against the SYNCED list on every read: a team the caller has lost access to would
// otherwise leave six links pointing at a 404.
export function resolveAnchorTeam(
  teams: readonly FrameTeam[],
  routeTeamId: string | undefined,
  remembered: string | null,
): FrameTeam | null {
  const fromRoute = routeTeamId === undefined ? undefined : teams.find((t) => t.id === routeTeamId)
  if (fromRoute !== undefined) return fromRoute
  const fromMemory = remembered === null ? undefined : teams.find((t) => t.id === remembered)
  if (fromMemory !== undefined) return fromMemory
  return teams[0] ?? null
}

// The team a caller is SENT to after signing in, which is a stricter test than the anchor above.
//
// `queries.teams.all()` returns every non-archived team in the workspace to any member, so
// `resolveAnchorTeam`'s `teams[0]` may name a team the caller has no membership in — and
// `teamScoped` grants row access only to workspace admins and to members of the team, so that
// team's Home would render an empty digest of strangers' work. The deck may point there: an offer
// can be wrong without lying, and the header comment above argues that case. A redirect cannot —
// it is the product choosing on the reader's behalf. Hence two resolvers, and hence this one does
// not touch the other.
//
// `members` rides on the row the deck already syncs, so this costs no new query.
export interface LandingTeam extends FrameTeam {
  readonly members?: readonly { readonly userId: string }[]
}

export interface LandingViewer {
  readonly userID: string | null
  readonly role: WorkspaceRole | null
}

function canRead(team: LandingTeam, viewer: LandingViewer): boolean {
  // Mirrors `teamScoped`'s own bypass: a workspace admin reads every team's rows.
  if (viewer.role === 'admin') return true
  if (viewer.userID === null) return false
  return (team.members ?? []).some((member) => member.userId === viewer.userID)
}

export function resolveLandingTeam(
  teams: readonly LandingTeam[],
  remembered: string | null,
  viewer: LandingViewer,
): LandingTeam | null {
  const fromMemory = remembered === null ? undefined : teams.find((t) => t.id === remembered)
  if (fromMemory !== undefined && canRead(fromMemory, viewer)) return fromMemory
  return teams.find((team) => canRead(team, viewer)) ?? null
}

export function useAnchorTeam(routeTeamId: string | undefined): FrameTeam | null {
  const [teams] = useQuery(queries.teams.all())
  const [remembered, setRemembered] = useState<string | null>(() => readAnchorTeam())

  const anchor = useMemo(
    () => resolveAnchorTeam(teams as readonly FrameTeam[], routeTeamId, remembered),
    [teams, routeTeamId, remembered],
  )

  useEffect(() => {
    if (routeTeamId === undefined || anchor?.id !== routeTeamId) return
    setRemembered(routeTeamId)
    writeAnchorTeam(routeTeamId)
  }, [routeTeamId, anchor])

  return anchor
}

// Ages tick at minute granularity — fine enough for the cycle day and for "41m", coarse enough that
// the memoized folds are not rebuilt per render.
//
// ONE ticker for the whole app, on the same reasoning as one attention derivation: the frame and the
// Home digest fold the same age-sensitive rows, and two independent 60s timers would let the
// statusline and the NEEDS ATTENTION band read a PR as 24h old and 23h old in the same second.
let tickerNow = Date.now()
let tickerHandle: ReturnType<typeof setInterval> | null = null
const tickerSubscribers = new Set<() => void>()

function subscribeToMinute(onChange: () => void): () => void {
  tickerSubscribers.add(onChange)
  if (tickerHandle === null) {
    // A tab that has had no subscriber for a while left `tickerNow` behind; the first one back
    // reads the clock rather than the last tick.
    tickerNow = Date.now()
    tickerHandle = setInterval(() => {
      tickerNow = Date.now()
      for (const notify of tickerSubscribers) notify()
    }, 60_000)
  }
  return () => {
    tickerSubscribers.delete(onChange)
    if (tickerSubscribers.size === 0 && tickerHandle !== null) {
      clearInterval(tickerHandle)
      tickerHandle = null
    }
  }
}

export function useMinuteNow(): number {
  return useSyncExternalStore(
    subscribeToMinute,
    () => tickerNow,
    () => tickerNow,
  )
}

// Band 3's facts, from the five team-scoped queries the page mostly holds already. Zero de-dupes
// the subscriptions, and the fold is pure — nothing in the frame waits on the network.
//
// `teamId` is the ROUTE's team, never the anchor: off-team this returns null and the statusline
// says only what is true.
export function useTeamFrame(teamId: string | undefined): TeamFrameModel | null {
  const now = useMinuteNow()
  const [teams] = useQuery(queries.teams.all())
  const [cyclesRaw] = useQuery(teamId === undefined ? undefined : queries.cycles.byTeam({ teamId }))
  const [issuesRaw] = useQuery(teamId === undefined ? undefined : queries.issues.byTeam({ teamId }))
  const [triageRaw] = useQuery(teamId === undefined ? undefined : queries.triage.inbox({ teamId }))
  const [deploymentsRaw] = useQuery(
    teamId === undefined ? undefined : queries.deployments.byTeam({ teamId }),
  )

  const team = teamId === undefined ? undefined : teams.find((candidate) => candidate.id === teamId)

  return useMemo(
    () =>
      team === undefined
        ? null
        : buildTeamFrame(
            {
              team: { id: team.id, key: team.key, name: team.name },
              cycles: (cyclesRaw ?? []) as readonly TeamHomeCycleRow[],
              issues: (issuesRaw ?? []) as unknown as readonly TeamHomeIssueRow[],
              triage: (triageRaw ?? []) as readonly TeamHomeTriageRow[],
              deployments: (deploymentsRaw ?? []) as readonly TeamHomeDeploymentRow[],
            },
            now,
          ),
    [team, cyclesRaw, issuesRaw, triageRaw, deploymentsRaw, now],
  )
}
