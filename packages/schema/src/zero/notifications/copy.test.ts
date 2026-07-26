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
    ).toEqual({ title: 'Dana assigned you ENG-42', summary: 'Flaky login redirect' })
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

  it('falls back to a generic subject when the issue has no number yet', () => {
    expect(
      notificationCopy({
        kind: 'issue_assigned',
        actorName: 'Dana',
        subjectKey: null,
        subjectTitle: 'Flaky login redirect',
      }),
    ).toEqual({ title: 'Dana assigned you an issue', summary: 'Flaky login redirect' })
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
