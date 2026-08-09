import { describe, expect, it } from 'vitest'
import { NOTIFICATION_KINDS } from '../context.js'
import { notificationCopy } from './copy.js'

describe('notificationCopy', () => {
  it('names the actor and the issue key for an assignment', () => {
    expect(
      notificationCopy({
        kind: 'issue_assigned',
        actorName: 'Dana',
        subjectKey: 'ENG-42',
        subjectTitle: 'Flaky login redirect',
      }),
    ).toEqual({
      title: 'Dana assigned you ENG-42',
      summary: 'Flaky login redirect',
      phrase: 'Dana assigned you',
    })
  })

  it('names the actor and the issue key for a comment', () => {
    expect(
      notificationCopy({
        kind: 'issue_commented',
        actorName: 'Dana',
        subjectKey: 'ENG-42',
        subjectTitle: 'Flaky login redirect',
      }).title,
    ).toBe('Dana commented on ENG-42')
  })

  it('names the actor and the issue key for a mention', () => {
    expect(
      notificationCopy({
        kind: 'mention',
        actorName: 'Dana',
        subjectKey: 'ENG-42',
        subjectTitle: 'Flaky login redirect',
      }),
    ).toEqual({
      title: 'Dana mentioned you in ENG-42',
      summary: 'Flaky login redirect',
      phrase: 'Dana mentioned you',
    })
  })

  it('falls back to a generic subject when the issue has no number yet', () => {
    expect(
      notificationCopy({
        kind: 'issue_assigned',
        actorName: 'Dana',
        subjectKey: null,
        subjectTitle: 'Flaky login redirect',
      }),
    ).toEqual({
      title: 'Dana assigned you an issue',
      summary: 'Flaky login redirect',
      // The phrase interpolates no subject, so a subject with no key yet costs it nothing.
      phrase: 'Dana assigned you',
    })
  })

  it('falls back to a generic actor rather than rendering an empty name', () => {
    for (const actorName of [null, '', '   ']) {
      expect(
        notificationCopy({
          kind: 'issue_commented',
          actorName,
          subjectKey: 'ENG-1',
          subjectTitle: 'Title',
        }).title,
      ).toBe('Someone commented on ENG-1')
    }
  })

  it('produces copy for every kind, so a new kind cannot render blank', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const copy = notificationCopy({
        kind,
        actorName: 'Dana',
        subjectKey: 'ENG-1',
        subjectTitle: 'Title',
      })
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.summary).toBe('Title')
      expect(copy.phrase.length).toBeGreaterThan(0)
      // The phrase is for a row that draws the subject in its own columns; a subject inside it
      // would be the same fact twice on one line.
      expect(copy.phrase).not.toContain('ENG-1')
      expect(copy.phrase).not.toContain('Title')
    }
  })

  // The email seam, asserted rather than assumed: the digest template and the delivery sweep read
  // `title` and `summary`, and adding a third string must leave both byte-identical.
  it('leaves the mailed strings untouched for every kind', () => {
    const mailed = NOTIFICATION_KINDS.map((kind) => {
      const copy = notificationCopy({
        kind,
        actorName: 'Dana',
        subjectKey: 'ENG-42',
        subjectTitle: 'Flaky login redirect',
      })
      return { title: copy.title, summary: copy.summary }
    })

    expect(mailed).toEqual([
      { title: 'Dana assigned you ENG-42', summary: 'Flaky login redirect' },
      { title: 'Dana commented on ENG-42', summary: 'Flaky login redirect' },
      { title: 'Dana mentioned you in ENG-42', summary: 'Flaky login redirect' },
      { title: 'A cycle digest was shared with you', summary: 'Flaky login redirect' },
    ])
  })

  it('states the actor and the verb with no subject, one phrase per kind', () => {
    const phrases = NOTIFICATION_KINDS.map(
      (kind) =>
        notificationCopy({
          kind,
          actorName: 'Dana',
          subjectKey: 'ENG-42',
          subjectTitle: 'Flaky login redirect',
        }).phrase,
    )

    expect(phrases).toEqual([
      'Dana assigned you',
      'Dana commented',
      'Dana mentioned you',
      'Shared with you',
    ])
  })

  // The digest names no actor by design, so the unknown-actor fallback is structurally unreachable
  // for it — the three actor kinds fall back, the digest cannot.
  it('reaches the unknown-actor fallback for the actor kinds and never for the digest', () => {
    for (const actorName of [null, '', '   ']) {
      expect(
        notificationCopy({
          kind: 'mention',
          actorName,
          subjectKey: 'ENG-1',
          subjectTitle: 'Title',
        }).phrase,
      ).toBe('Someone mentioned you')

      expect(
        notificationCopy({
          kind: 'pm_digest_published',
          actorName,
          subjectKey: null,
          subjectTitle: 'Engineering · Cycle 2',
        }).phrase,
      ).toBe('Shared with you')
    }
  })

  // The non-goal, asserted rather than merely written down: the copy layer takes no comment body,
  // so an excerpt cannot appear in an inbox row or an email by accident.
  it('has no input a comment body could be passed through', () => {
    const input = {
      kind: 'issue_commented',
      actorName: 'Dana',
      subjectKey: 'ENG-1',
      subjectTitle: 'Title',
    } as const
    expect(Object.keys(input)).toEqual(['kind', 'actorName', 'subjectKey', 'subjectTitle'])
    expect(JSON.stringify(notificationCopy(input))).not.toContain('body')
  })
})
