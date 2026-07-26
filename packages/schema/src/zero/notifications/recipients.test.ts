import { describe, expect, it } from 'vitest'
import {
  assignmentRecipients,
  commentRecipients,
  NOTIFICATION_RECIPIENT_CAP,
} from './recipients.js'

const ACTOR = 'user-actor'

describe('assignmentRecipients', () => {
  it('notifies the assignee the mutation set', () => {
    expect(assignmentRecipients({ assigneeId: 'user-b', actorId: ACTOR })).toEqual(['user-b'])
  })

  it('is silent for a self-assignment', () => {
    expect(assignmentRecipients({ assigneeId: ACTOR, actorId: ACTOR })).toEqual([])
  })

  it('is silent when the assignee is cleared or absent', () => {
    expect(assignmentRecipients({ assigneeId: null, actorId: ACTOR })).toEqual([])
    expect(assignmentRecipients({ assigneeId: undefined, actorId: ACTOR })).toEqual([])
  })
})

describe('commentRecipients', () => {
  it('reaches assignee, creator and prior commenters in a stable order', () => {
    expect(
      commentRecipients({
        assigneeId: 'user-b',
        creatorId: 'user-c',
        priorCommenterIds: ['user-d', 'user-e'],
        actorId: ACTOR,
      }),
    ).toEqual(['user-b', 'user-c', 'user-d', 'user-e'])
  })

  it('excludes the actor wherever they appear', () => {
    expect(
      commentRecipients({
        assigneeId: ACTOR,
        creatorId: ACTOR,
        priorCommenterIds: [ACTOR, 'user-b', ACTOR],
        actorId: ACTOR,
      }),
    ).toEqual(['user-b'])
  })

  // One entry per comment arrives, so a repeat commenter appears twice. They belong where their
  // NEWEST comment puts them: keeping the first position would report them as having stopped
  // participating when they are in fact the last person who spoke.
  it('orders a repeat commenter by their most recent comment', () => {
    expect(
      commentRecipients({
        assigneeId: null,
        creatorId: null,
        priorCommenterIds: ['user-d', 'user-e', 'user-d'],
        actorId: ACTOR,
      }),
    ).toEqual(['user-e', 'user-d'])
  })

  it('dedupes a person who is assignee, creator and a prior commenter at once', () => {
    expect(
      commentRecipients({
        assigneeId: 'user-b',
        creatorId: 'user-b',
        priorCommenterIds: ['user-b', 'user-b'],
        actorId: ACTOR,
      }),
    ).toEqual(['user-b'])
  })

  it('tolerates a null assignee and a null creator', () => {
    expect(
      commentRecipients({
        assigneeId: null,
        creatorId: null,
        priorCommenterIds: [],
        actorId: ACTOR,
      }),
    ).toEqual([])
  })

  // The cap is what keeps the fan-out's insert bounded inside the triggering mutation's own
  // transaction, so a pathological issue cannot turn a one-row update into a long lock hold.
  it('enforces the recipient cap', () => {
    const many = Array.from({ length: NOTIFICATION_RECIPIENT_CAP + 20 }, (_, i) => `user-${i}`)
    const recipients = commentRecipients({
      assigneeId: null,
      creatorId: null,
      priorCommenterIds: many,
      actorId: ACTOR,
    })
    expect(recipients).toHaveLength(NOTIFICATION_RECIPIENT_CAP)
    // Truncated from the OLDEST end: the twenty who stopped commenting go, not the twenty talking.
    expect(recipients[0]).toBe('user-20')
    expect(recipients.at(-1)).toBe(`user-${NOTIFICATION_RECIPIENT_CAP + 19}`)
  })

  // The slots the assignee and the creator take come out of the same budget. Capping the union
  // front-to-back down an oldest-first list therefore drops the two NEWEST commenters — the people
  // currently in the thread — which is the exact failure the desc-then-reverse read exists to
  // prevent, reintroduced one layer up.
  it('spends the assignee and creator slots on the least-recent commenters', () => {
    const many = Array.from({ length: NOTIFICATION_RECIPIENT_CAP }, (_, i) => `user-${i}`)
    const recipients = commentRecipients({
      assigneeId: 'user-assignee',
      creatorId: 'user-creator',
      priorCommenterIds: many,
      actorId: ACTOR,
    })
    expect(recipients).toHaveLength(NOTIFICATION_RECIPIENT_CAP)
    expect(recipients.slice(0, 2)).toEqual(['user-assignee', 'user-creator'])
    expect(recipients).not.toContain('user-0')
    expect(recipients).not.toContain('user-1')
    expect(recipients).toContain(`user-${NOTIFICATION_RECIPIENT_CAP - 1}`)
    expect(recipients).toContain(`user-${NOTIFICATION_RECIPIENT_CAP - 2}`)
  })

  // The truncation boundary is where first-seen dedupe does real damage: the earliest commenter on
  // the thread has just commented again, so they are the most recent participant there is, yet
  // first-seen order leaves them pinned at index 0 — the first slot the cap discards.
  it('keeps a repeat commenter whose newest comment crosses the truncation boundary', () => {
    const many = Array.from({ length: NOTIFICATION_RECIPIENT_CAP + 20 }, (_, i) => `user-${i}`)
    const recipients = commentRecipients({
      assigneeId: null,
      creatorId: null,
      priorCommenterIds: [...many, 'user-0'],
      actorId: ACTOR,
    })
    expect(recipients).toHaveLength(NOTIFICATION_RECIPIENT_CAP)
    expect(recipients.at(-1)).toBe('user-0')
    // The twenty dropped shift up by one, because user-0 no longer occupies the oldest slot.
    expect(recipients).not.toContain('user-20')
    expect(recipients[0]).toBe('user-21')
  })
})
