import { describe, expect, it } from 'vitest'
import { NOTIFICATION_RECIPIENT_CAP } from '../notifications/recipients.js'
import { addedMentionIds } from './diff.js'

const ACTOR = 'user-actor'

function doc(...ids: readonly string[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: ids.map((id) => ({
          type: 'mention',
          attrs: { id, label: id, mentionSuggestionChar: '@' },
        })),
      },
    ],
  }
}

describe('addedMentionIds', () => {
  it('returns only the ids the write newly introduced', () => {
    expect(addedMentionIds(doc('user-b'), doc('user-b', 'user-c'), ACTOR)).toEqual(['user-c'])
  })

  it('returns nothing when the document is re-saved unchanged', () => {
    expect(addedMentionIds(doc('user-b', 'user-c'), doc('user-b', 'user-c'), ACTOR)).toEqual([])
  })

  it('returns nothing when a mention is only removed', () => {
    expect(addedMentionIds(doc('user-b', 'user-c'), doc('user-b'), ACTOR)).toEqual([])
  })

  it('treats an absent previous document as an empty mention set', () => {
    expect(addedMentionIds(null, doc('user-b'), ACTOR)).toEqual(['user-b'])
    expect(addedMentionIds(undefined, doc('user-b'), ACTOR)).toEqual(['user-b'])
  })

  it('drops the actor — nobody is notified about mentioning themselves', () => {
    expect(addedMentionIds(null, doc(ACTOR, 'user-b'), ACTOR)).toEqual(['user-b'])
  })

  it('keeps document order and deduplicates a repeated mention', () => {
    expect(addedMentionIds(null, doc('user-c', 'user-b', 'user-c'), ACTOR)).toEqual([
      'user-c',
      'user-b',
    ])
  })

  it('truncates from the END, so the notified set is the one the author wrote first', () => {
    const ids = Array.from(
      { length: NOTIFICATION_RECIPIENT_CAP + 10 },
      (_v, index) => `user-${String(index).padStart(3, '0')}`,
    )
    const added = addedMentionIds(null, doc(...ids), ACTOR)

    expect(added).toHaveLength(NOTIFICATION_RECIPIENT_CAP)
    expect(added[0]).toBe(ids[0])
    expect(added.at(-1)).toBe(ids[NOTIFICATION_RECIPIENT_CAP - 1])
    expect(added).not.toContain(ids.at(-1))
  })

  it('is total on a document that is not a document', () => {
    expect(addedMentionIds('not a doc', 42, ACTOR)).toEqual([])
  })
})
