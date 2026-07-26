import { expect, test } from 'vitest'
import { buildMentionables, mentionNamesFrom, NOT_ON_TEAM_REASON } from './mentionables'

const USERS = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@yapm.dev' },
  { id: 'bo', name: 'Bo Nguyen', email: 'bo@yapm.dev' },
  { id: 'casey', name: 'Casey Stone', email: 'casey@yapm.dev' },
  { id: 'ravi', name: 'Ravi Shah', email: 'ravi@yapm.dev' },
  { id: 'me', name: 'Me Myself', email: 'me@yapm.dev' },
]

const WORKSPACE = [
  { userId: 'ada', role: 'member' as const },
  { userId: 'bo', role: 'member' as const },
  { userId: 'casey', role: 'member' as const },
  { userId: 'ravi', role: 'admin' as const },
  { userId: 'me', role: 'member' as const },
]

function build(selfId: string | null = 'me') {
  return buildMentionables({
    teamMembers: [
      { id: 'ada', name: 'Ada Lovelace' },
      { id: 'bo', name: 'Bo Nguyen' },
      { id: 'me', name: 'Me Myself' },
    ],
    workspaceMembers: WORKSPACE,
    users: USERS,
    selfId,
  })
}

function byId(id: string) {
  return build().find((candidate) => candidate.id === id)
}

test('team members are eligible and offered by default', () => {
  expect(byId('ada')).toMatchObject({
    name: 'Ada Lovelace',
    email: 'ada@yapm.dev',
    eligible: true,
  })
  expect(byId('ada')?.matchOnly).toBeUndefined()
})

test('an admin outside the team is eligible but held back until named', () => {
  expect(byId('ravi')).toMatchObject({ eligible: true, matchOnly: true })
})

test('a workspace member outside the team is ineligible and says why', () => {
  expect(byId('casey')).toMatchObject({ eligible: false, reason: NOT_ON_TEAM_REASON })
  expect(byId('casey')?.matchOnly).toBeUndefined()
})

test('the author is never offered, because a self-mention notifies nobody', () => {
  expect(byId('me')).toBeUndefined()
  expect(build(null).some((candidate) => candidate.id === 'me')).toBe(true)
})

test('a team member is listed once even though they are also a workspace member', () => {
  expect(build().filter((candidate) => candidate.id === 'ada')).toHaveLength(1)
})

test('names resolve from the live user rows, falling back to email then id', () => {
  const names = mentionNamesFrom([
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'bo', name: null, email: 'bo@yapm.dev' },
    { id: 'ghost' },
  ])
  expect(names.get('ada')).toBe('Ada Lovelace')
  expect(names.get('bo')).toBe('bo@yapm.dev')
  expect(names.get('ghost')).toBe('ghost')
  expect(names.get('nobody')).toBeUndefined()
})
