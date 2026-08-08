import { afterEach, expect, test, vi } from 'vitest'
import {
  ANCHOR_STORAGE_KEY,
  readAnchorTeam,
  resolveAnchorTeam,
  writeAnchorTeam,
} from '@/frame/team-context'

// Which team the deck's six stops point at when the route names none (design §D3). The deck is an
// offer, so it may point somewhere the reader is not — but it may never point at a team the reader
// cannot open, which is the whole reason the remembered id is re-validated against the synced list
// on every read rather than trusted because it was written once.

const ENG = { id: 'team-1', name: 'Engineering', key: 'ENG' }
const OPS = { id: 'team-2', name: 'Operations', key: 'OPS' }

// This suite's jsdom has no `localStorage` at all, which is the disabled-storage case the frame has
// to survive — so the working case is the one that needs a stand-in.
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the route’s team wins over the remembered one', () => {
  expect(resolveAnchorTeam([ENG, OPS], 'team-2', 'team-1')).toBe(OPS)
})

test('off-route the remembered team anchors the stops', () => {
  expect(resolveAnchorTeam([ENG, OPS], undefined, 'team-2')).toBe(OPS)
})

// The case that turns six links into six 404s if it is missed: membership revoked, the workspace
// re-synced, and the remembered id still naming a team that is no longer in the list.
test('a stale remembered team falls back to the first the caller can still see', () => {
  expect(resolveAnchorTeam([ENG, OPS], undefined, 'team-gone')).toBe(ENG)
})

test('a route team that is not in the synced list falls back rather than anchoring on it', () => {
  expect(resolveAnchorTeam([ENG, OPS], 'team-gone', null)).toBe(ENG)
})

// A workspace with no teams drops the stops entirely; there is nothing honest to point at.
test('an empty workspace has no anchor', () => {
  expect(resolveAnchorTeam([], undefined, 'team-1')).toBeNull()
  expect(resolveAnchorTeam([], 'team-1', null)).toBeNull()
})

test('the anchor round-trips through storage', () => {
  const store = stubStorage()
  writeAnchorTeam('team-2')
  expect(store.get(ANCHOR_STORAGE_KEY)).toBe('team-2')
  expect(readAnchorTeam()).toBe('team-2')
  expect(resolveAnchorTeam([ENG, OPS], undefined, readAnchorTeam())).toBe(OPS)
})

// Storage disabled — Safari private browsing, a locked-down enterprise profile — is a frame that
// forgets the anchor, never a frame that fails to draw.
test('a browser that refuses storage still resolves an anchor and never throws', () => {
  expect(readAnchorTeam()).toBeNull()
  expect(() => writeAnchorTeam('team-2')).not.toThrow()
  expect(resolveAnchorTeam([ENG, OPS], undefined, readAnchorTeam())).toBe(ENG)

  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('storage disabled')
    },
    setItem: () => {
      throw new Error('storage disabled')
    },
  })
  expect(readAnchorTeam()).toBeNull()
  expect(() => writeAnchorTeam('team-2')).not.toThrow()
})
