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
    expect(recipients[0]).toBe('user-0')
  })
})
