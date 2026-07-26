import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type ServerTransaction,
  type Transaction,
} from '@rocicorp/zero'
import { type Kysely, sql } from 'kysely'
import {
  autoSubscribeMentioned,
  deleteSubscriptionsForMember,
  deleteSubscriptionsForTeamMember,
  subscribersOfIssue,
} from '../db/issue-subscription.js'
import {
  deleteNotificationsForMember,
  deleteNotificationsForTeamMember,
  markAllNotificationsRead as markAllNotificationsReadInDb,
  type NotificationEvent,
  recordNotifications,
} from '../db/notification.js'
import type { DB } from '../db/types.js'
import type { AuthContext, NotificationKind, NotificationSubjectType } from './context.js'
import { MutationError, MutationErrorCode } from './errors.js'
import { addedMentionIds } from './mentions/diff.js'
import { eligibleMentionees } from './mentions/eligibility.js'
import {
  assignIssueArgs,
  castRetroVoteArgs,
  convertRetroActionToIssueArgs,
  createCommentArgs,
  createCycleArgs,
  createIssueArgs,
  deleteRetroCardArgs,
  editCommentArgs,
  isRetroFacilitator,
  markAllNotificationsReadArgs,
  mutators,
  removeMemberArgs,
  removeTeamMemberArgs,
  retractRetroVoteArgs,
  routeIssueArgs,
  setRetroPhaseArgs,
  startRetroTimerArgs,
  updateIssueArgs,
} from './mutators.js'
import {
  assignmentRecipients,
  commentRecipients,
  NOTIFICATION_RECIPIENT_CAP,
} from './notifications/recipients.js'
import {
  bumpRetroVoteTally,
  isRetroCardAuthor,
  lockRetroForVote,
  recordRetroCardAuthor,
} from './retro/server-writes.js'
import { zql } from './schema.js'

// THE PUBLIC WRITE SEAMS, both of them. `@yapm/schema/server` resolves to this module, so a
// re-export here is what keeps it the ONE server entry point — Kysely never reaches the client
// bundle, and a later change binds to these rather than reaching into `db/` or into the private
// trigger map below. (Biome sorts these blocks by module path; the two belong together.)
export type { AutoSubscribeRow } from '../db/issue-subscription.js'
export {
  autoSubscribeMentioned,
  deleteSubscriptionsForMember,
  deleteSubscriptionsForTeamMember,
  subscribersOfIssue,
} from '../db/issue-subscription.js'
export type { NotificationEvent } from '../db/notification.js'
export { recordNotifications } from '../db/notification.js'

// Atomically claim the next per-team issue number. The row lock on `issue_sequence`
// serializes concurrent creates within a team; different teams take different rows and never
// contend. On first insert `next_number` starts at 2 and we return 1; each subsequent
// conflict bumps it and returns the prior value — a gapless monotonic sequence per team.
// Takes a bare Kysely executor (the wrapped transaction) so it is directly testable.
export async function claimNextIssueNumber(db: Kysely<DB>, teamId: string): Promise<number> {
  const { rows } = await sql<{ number: number | string }>`
    insert into issue_sequence (team_id, next_number)
    values (${teamId}, 2)
    on conflict (team_id) do update set next_number = issue_sequence.next_number + 1
    returning next_number - 1 as number
  `.execute(db)
  return Number(rows[0]?.number)
}

// The cycle counterpart to `claimNextIssueNumber` — same row-locked, gapless, per-team
// monotonic sequence, over `cycle_sequence`.
export async function claimNextCycleNumber(db: Kysely<DB>, teamId: string): Promise<number> {
  const { rows } = await sql<{ number: number | string }>`
    insert into cycle_sequence (team_id, next_number)
    values (${teamId}, 2)
    on conflict (team_id) do update set next_number = cycle_sequence.next_number + 1
    returning next_number - 1 as number
  `.execute(db)
  return Number(rows[0]?.number)
}

function serverDb(tx: Transaction): Kysely<DB> {
  return (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
}

export interface PublishableDraft {
  id: string
  retroId: string
  teamId: string
  columnId: string
  authorId: string
  body: string
  rank: string
  seedRef: ReadonlyJSONValue | null
  createdAt: number
}

// Draft -> card, the one mapping the anonymity guarantee turns on. Pure, so it is unit-testable on
// its own: the card REUSES THE DRAFT'S ID (nothing minted, publish idempotent) and carries an author
// ONLY when the retro is not anonymous.
export function publishedCardFromDraft(
  draft: PublishableDraft,
  retro: { isAnonymous: boolean },
  at: number,
) {
  return {
    id: draft.id,
    retroId: draft.retroId,
    teamId: draft.teamId,
    columnId: draft.columnId,
    groupId: null,
    body: draft.body,
    rank: draft.rank,
    isAnonymous: retro.isAnonymous,
    authorDisplayId: retro.isAnonymous ? null : draft.authorId,
    seedRef: draft.seedRef ?? null,
    createdAt: draft.createdAt,
    updatedAt: at,
  }
}

// The publish step, and the only place the card -> author binding is ever written.
//
// It runs ONLY on the server, because a client's `tx.run` sees only its own drafts and would publish
// a partial board optimistically. Each card REUSES ITS DRAFT'S ID, so nothing is minted inside a
// mutator and a re-run is an idempotent upsert. `author_display_id` is written only when the retro is
// not anonymous — for an anonymous retro the synced row carries no author value at all, and the true
// author goes to `retro_card_author`, which is absent from the Zero schema.
async function publishRetroDrafts(
  tx: Transaction,
  retro: { id: string; isAnonymous: boolean },
  at: number,
): Promise<void> {
  const drafts = (await tx.run(
    zql.retro_draft.where('retroId', retro.id).where('publishedAt', 'IS', null),
  )) as PublishableDraft[]
  const db = serverDb(tx)

  for (const draft of drafts) {
    await tx.mutate.retro_card.upsert(publishedCardFromDraft(draft, retro, at))
    await tx.mutate.retro_draft.update({ id: draft.id, publishedAt: at, updatedAt: at })
    await recordRetroCardAuthor(db, {
      cardId: draft.id,
      retroId: draft.retroId,
      authorId: draft.authorId,
    })
  }
}

// Every case this leaves to the shared mutator (no caller, no card, no retro) is one the shared
// mutator itself rejects with a generic not-authorized, so a card's existence never leaks here either.
async function assertCardDeleteAuthority(
  tx: Transaction,
  cardId: string,
  ctx: AuthContext | undefined,
): Promise<void> {
  if (ctx === undefined) return
  const card = (await tx.run(zql.retro_card.where('id', cardId).one())) as
    | { id: string; retroId: string }
    | undefined
  if (card === undefined) return
  const retro = (await tx.run(zql.retro.where('id', card.retroId).one())) as
    | { id: string; facilitatorId: string | null }
    | undefined
  if (retro === undefined) return
  if (isRetroFacilitator(retro, ctx)) return
  if (await isRetroCardAuthor(serverDb(tx), cardId, ctx.userID)) return
  throw new MutationError(
    'Not authorized to perform this action',
    MutationErrorCode.notAuthorized,
    cardId,
  )
}

interface TriggerRecipientInput {
  readonly actorId: string
  readonly assigneeId: string | null
  readonly creatorId: string | null
  readonly priorCommenterIds: readonly string[]
}

interface NotificationTrigger {
  readonly subjectType: NotificationSubjectType
  readonly recipients: (input: TriggerRecipientInput) => readonly string[]
  // Whether the fan-out needs the issue's comment authors. A bounded read nobody pays for on an
  // assignment.
  readonly needsPriorCommenters: boolean
}

// The kinds whose recipients are computed from SUBJECT INVOLVEMENT — who is assigned, who created
// it, who commented before. Narrower than `NotificationKind` on purpose: `'mention'` is not here,
// because a mention's recipients are a DOCUMENT DIFF and a subscriber's are a STORED EDGE, and
// neither is knowable from the issue row this map's `recipients` functions are handed.
//
// Written as an `Extract` rather than a `Partial<Record<…>>` so the exhaustiveness below keeps
// meaning what it says: a new involvement-driven kind still fails to compile until it is
// registered, while a kind that is deliberately produced elsewhere is excluded STRUCTURALLY rather
// than by a runtime lookup that could return undefined.
type InvolvementNotificationKind = Extract<NotificationKind, 'issue_assigned' | 'issue_commented'>

// PRIVATE to this module, deliberately (design D6). `mentions` does NOT register here: it binds to
// the exported `recordNotifications` instead.
const NOTIFICATION_TRIGGERS: Record<InvolvementNotificationKind, NotificationTrigger> = {
  issue_assigned: {
    subjectType: 'issue',
    recipients: (input) =>
      assignmentRecipients({ assigneeId: input.assigneeId, actorId: input.actorId }),
    needsPriorCommenters: false,
  },
  issue_commented: {
    subjectType: 'issue',
    recipients: (input) =>
      commentRecipients({
        assigneeId: input.assigneeId,
        creatorId: input.creatorId,
        priorCommenterIds: input.priorCommenterIds,
        actorId: input.actorId,
      }),
    needsPriorCommenters: true,
  },
}

interface IssueSubjectRow {
  id: string
  teamId: string
  title: string
  number: number | null
  assigneeId: string | null
  creatorId: string
}

// `ENG-42`, or null rather than a half-formed key: the row still renders from its title alone.
// Read last, after the recipient set is known to be non-empty, so a fan-out that tells nobody costs
// no extra statement inside the triggering transaction.
async function issueSubjectKey(
  tx: Transaction,
  issue: { teamId: string; number: number | null },
): Promise<string | null> {
  const team = (await tx.run(zql.team.where('id', issue.teamId).one())) as
    | { id: string; key: string }
    | undefined
  return team === undefined || issue.number === null ? null : `${team.key}-${issue.number}`
}

interface FanOutInput {
  readonly kind: InvolvementNotificationKind
  readonly issueId: string
  readonly actorId: string
  // Deterministic in the triggering mutation's own args — `String(args.updatedAt)` for an
  // assignment, the comment id for a comment. Together with the recipient, kind and subject it IS
  // the primary key, which is why running the same mutation twice yields one row rather than two.
  readonly eventKey: string
  readonly at: number
  // The assignee the MUTATION set, not whoever the issue happens to carry: `routeIssue` may route a
  // status or a cycle and no assignee at all, and reading the row would then notify the standing
  // assignee about nothing. Omitted for a comment, where the issue's current assignee is right.
  readonly assigneeId?: string | null
  // People this event addresses BY NAME, who therefore must not also receive the ambient row for
  // it. See `comment.create`.
  readonly exclude?: ReadonlySet<string>
}

// The fan-out. Runs on the authoritative pass only — every call site is behind
// `if (tx.location !== 'server') return` — and writes through `serverDb(tx)`, so notification rows
// commit or roll back with the change that caused them.
async function fanOut(tx: Transaction, input: FanOutInput): Promise<void> {
  const issue = (await tx.run(zql.issue.where('id', input.issueId).one())) as
    | IssueSubjectRow
    | undefined
  if (issue === undefined) return

  const trigger = NOTIFICATION_TRIGGERS[input.kind]
  // Bounded by the same constant that caps the recipient set, because this read happens inside the
  // triggering mutation's transaction — an unbounded one would hold locks on a busy issue.
  //
  // NEWEST-first then reversed, not oldest-first: the cap has to fall on the people who stopped
  // participating, never on the people currently in the thread. Read oldest-first, a thread past
  // the cap notifies whoever commented once at the very start forever and silently drops everyone
  // discussing it now. The reverse restores the documented oldest-first ordering WITHIN the
  // selected set, so the row order a test asserts on is unchanged.
  //
  // `commentRecipients` then truncates from the OLDEST end of this list, because the assignee and
  // the creator spend slots out of the same budget — this read alone cannot keep the cap off the
  // live end of the thread.
  //
  // The ACTOR'S OWN comments are excluded from the read rather than filtered out of its result:
  // they can never be recipients, and the comment that triggered this fan-out is by construction
  // the newest one on the issue — so leaving them in spends slots of a bounded window on rows that
  // are certain to be discarded.
  const priorCommenterIds = trigger.needsPriorCommenters
    ? (
        (await tx.run(
          zql.comment
            .where('issueId', input.issueId)
            .where('authorId', '!=', input.actorId)
            .orderBy('createdAt', 'desc')
            .limit(NOTIFICATION_RECIPIENT_CAP),
        )) as { authorId: string }[]
      )
        .map((comment) => comment.authorId)
        .reverse()
    : []

  const exclude = input.exclude ?? new Set<string>()
  const candidates = trigger
    .recipients({
      actorId: input.actorId,
      assigneeId: input.assigneeId === undefined ? issue.assigneeId : input.assigneeId,
      creatorId: issue.creatorId,
      priorCommenterIds,
    })
    .filter((candidate) => !exclude.has(candidate))
  if (candidates.length === 0) return

  // INVOLVEMENT IS NOT MEMBERSHIP. A creator, a standing assignee or a prior commenter can have
  // left the issue's team since, and the row carries that team's issue key and title — so the
  // write-time check has to be the same one the delivery sweep makes at send time: current
  // membership of `issue.team_id`. Without it a workspace member who left the team still syncs
  // `notifications.mine` and reads a key and a title they no longer have access to.
  //
  // Bounded: `candidates` is already capped at NOTIFICATION_RECIPIENT_CAP, and `team_membership` is
  // unique on (team_id, user_id), so this reads at most that many rows inside the open transaction.
  const memberships = (await tx.run(
    zql.team_membership.where('teamId', issue.teamId).where('userId', 'IN', candidates),
  )) as { userId: string }[]
  const members = new Set(memberships.map((membership) => membership.userId))
  const recipients = candidates.filter((candidate) => members.has(candidate))
  if (recipients.length === 0) return

  const subjectKey = await issueSubjectKey(tx, issue)

  const events: NotificationEvent[] = recipients.map((recipientId) => ({
    recipientId,
    actorId: input.actorId,
    kind: input.kind,
    teamId: issue.teamId,
    subjectType: trigger.subjectType,
    subjectId: input.issueId,
    subjectKey,
    subjectTitle: issue.title,
    eventKey: input.eventKey,
    createdAt: input.at,
  }))

  await recordNotifications(serverDb(tx), events)
}

// THE EVENT KEY FOR A DESCRIPTION MENTION, and the reason the "edit adds a mention, re-save adds
// nothing" requirement holds. A constant, deliberately: `String(args.updatedAt)` changes on every
// save, so removing and re-adding a mention would notify a second time — exactly what the
// requirement forbids. With a sentinel, a description is a single lifetime event per person.
//
// It cannot collide with a comment's key: comment ids are UUIDv7, `subject_id` is the issue in both
// cases, and the two key spaces are therefore disjoint by shape.
const ISSUE_DESCRIPTION_EVENT_KEY = 'description'

interface MentionFanOutInput {
  readonly issueId: string
  readonly actorId: string
  readonly eventKey: string
  readonly at: number
  // The document as stored BEFORE this write, read inside the same transaction. Anybody already
  // mentioned there has been told; the diff against `nextDoc` is what makes an edit notify once.
  readonly previousDoc: unknown
  readonly nextDoc: unknown
}

// The mention producer. It binds to the exported `recordNotifications` and NOT to
// `NOTIFICATION_TRIGGERS` (design D6): that map computes recipients from subject involvement, while
// a mention's recipients are a document diff — nothing the issue row could tell it.
//
// Diff -> eligibility -> notify -> subscribe, all inside the caller's transaction and behind the
// caller's `tx.location === 'server'` guard, so the rows commit or roll back with the write that
// caused them.
async function fanOutMentions(tx: Transaction, input: MentionFanOutInput): Promise<void> {
  const added = addedMentionIds(input.previousDoc, input.nextDoc, input.actorId)
  if (added.length === 0) return

  const issue = (await tx.run(zql.issue.where('id', input.issueId).one())) as
    | IssueSubjectRow
    | undefined
  if (issue === undefined) return

  // MENTIONING SOMEBODY WHO CANNOT READ THE ISSUE IS NOT POSSIBLE, and it is enforced here rather
  // than in the typeahead: the document is user-controlled JSON, so a paste, a stale client or an
  // API call would sail straight past a UI-only check.
  const eligible = await eligibleMentionees(tx, issue.teamId, added)
  const recipients = added.filter((id) => eligible.has(id))
  if (recipients.length === 0) return

  const subjectKey = await issueSubjectKey(tx, issue)
  const db = serverDb(tx)

  await recordNotifications(
    db,
    recipients.map((recipientId) => ({
      recipientId,
      actorId: input.actorId,
      kind: 'mention' as const,
      teamId: issue.teamId,
      subjectType: 'issue' as const,
      subjectId: input.issueId,
      subjectKey,
      subjectTitle: issue.title,
      eventKey: input.eventKey,
      createdAt: input.at,
    })),
  )

  // Being mentioned subscribes you to the issue's later activity. Same survivors as the
  // notification, so nobody is subscribed to a thread they were never told about.
  await autoSubscribeMentioned(
    db,
    recipients.map((userId) => ({
      issueId: input.issueId,
      userId,
      teamId: issue.teamId,
      at: input.at,
    })),
  )
}

interface SubscriberFanOutInput {
  readonly issueId: string
  readonly actorId: string
  readonly eventKey: string
  readonly at: number
  // Anybody this comment names by name. They get the `mention` row instead; the ambient one would
  // say strictly less about the same comment.
  readonly exclude?: ReadonlySet<string>
}

// The subscription producer, and the second reason `notifications`' natural-key-as-primary-key
// decision pays rent (design D5). It emits kind `'issue_commented'` with `subjectId: issueId` and
// `eventKey: comment.id` — BYTE-IDENTICAL natural keys to the ones the involvement fan-out produces
// for the same comment — so a subscriber who is also the assignee gets exactly one inbox row and
// the second insert is absorbed by the primary key.
//
// A separate `issue_activity` kind would have been the obvious alternative and is precisely wrong:
// a different kind is a different primary key, so the overlap would double.
async function fanOutToSubscribers(tx: Transaction, input: SubscriberFanOutInput): Promise<void> {
  const db = serverDb(tx)
  const exclude = input.exclude ?? new Set<string>()
  // Bounded by the same constant the recipient set is, for the same reason: this read is inside the
  // triggering mutation's transaction. Past the cap the longest-following are kept.
  const subscribers = (
    await subscribersOfIssue(db, input.issueId, NOTIFICATION_RECIPIENT_CAP)
  ).filter((userId) => userId !== input.actorId && !exclude.has(userId))
  if (subscribers.length === 0) return

  const issue = (await tx.run(zql.issue.where('id', input.issueId).one())) as
    | IssueSubjectRow
    | undefined
  if (issue === undefined) return

  // The same predicate a fresh mention is checked against, so somebody who left the team stops
  // receiving the thread in the window before the membership-removal cleanup runs.
  const eligible = await eligibleMentionees(tx, issue.teamId, subscribers)
  const recipients = subscribers.filter((userId) => eligible.has(userId))
  if (recipients.length === 0) return

  const subjectKey = await issueSubjectKey(tx, issue)

  await recordNotifications(
    db,
    recipients.map((recipientId) => ({
      recipientId,
      actorId: input.actorId,
      kind: 'issue_commented' as const,
      teamId: issue.teamId,
      subjectType: 'issue' as const,
      subjectId: input.issueId,
      subjectKey,
      subjectTitle: issue.title,
      eventKey: input.eventKey,
      createdAt: input.at,
    })),
  )
}

// Server-authoritative overrides layered over the shared client mutators. Each one adds exactly the
// work a client cannot do correctly — claim a gapless per-team number, publish every participant's
// drafts, increment a tally atomically, or stamp the server clock — and nothing else: the
// authorization and phase checks live in the shared mutator so client and server agree.
export function createServerMutators() {
  return defineMutators(mutators, {
    issue: {
      // The fan-out runs AFTER the number is claimed and written, so `subject_key` reads `ENG-42`
      // rather than null on the very notification a new assignee gets.
      create: defineMutator(createIssueArgs, async ({ tx, args, ctx }) => {
        await mutators.issue.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const number = await claimNextIssueNumber(serverDb(tx), args.teamId)
        await tx.mutate.issue.update({ id: args.id, number, updatedAt: args.updatedAt })
        if (ctx === undefined) return
        // A new issue has no prior description, so the whole mention set is newly added.
        await fanOutMentions(tx, {
          issueId: args.id,
          actorId: ctx.userID,
          eventKey: ISSUE_DESCRIPTION_EVENT_KEY,
          at: args.updatedAt,
          previousDoc: null,
          nextDoc: args.description ?? null,
        })
        if (args.assigneeId == null) return
        await fanOut(tx, {
          kind: 'issue_assigned',
          issueId: args.id,
          actorId: ctx.userID,
          eventKey: String(args.updatedAt),
          at: args.updatedAt,
          assigneeId: args.assigneeId,
        })
      }),
      // The description's mention trigger. `before` is read ahead of the shared mutator, in the
      // same transaction, because the shared mutator is what overwrites it — the pattern
      // `retro.setPhase` uses.
      update: defineMutator(updateIssueArgs, async ({ tx, args, ctx }) => {
        const before =
          tx.location === 'server'
            ? ((await tx.run(zql.issue.where('id', args.id).one())) as
                | { id: string; description: unknown }
                | undefined)
            : undefined
        await mutators.issue.update.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (ctx === undefined || args.description === undefined || before === undefined) return
        await fanOutMentions(tx, {
          issueId: args.id,
          actorId: ctx.userID,
          eventKey: ISSUE_DESCRIPTION_EVENT_KEY,
          at: args.updatedAt,
          previousDoc: before.description,
          nextDoc: args.description,
        })
      }),
      assign: defineMutator(assignIssueArgs, async ({ tx, args, ctx }) => {
        await mutators.issue.assign.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (args.assigneeId === null || ctx === undefined) return
        await fanOut(tx, {
          kind: 'issue_assigned',
          issueId: args.id,
          actorId: ctx.userID,
          eventKey: String(args.updatedAt),
          at: args.updatedAt,
          assigneeId: args.assigneeId,
        })
      }),
      // THE DUPLICATED ASSIGNEE PATH, and the one that gets silently missed: `routeIssue`
      // (`export const routeIssue` in mutators.ts) carries its OWN `assigneeId` and sets it
      // directly, never going through `issue.assign`. Being routed to somebody out of triage is an
      // assignment like any other, so it notifies like one. `undefined` means the route did not
      // touch the assignee — nobody is told anything.
      routeIssue: defineMutator(routeIssueArgs, async ({ tx, args, ctx }) => {
        await mutators.issue.routeIssue.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (args.assigneeId == null || ctx === undefined) return
        await fanOut(tx, {
          kind: 'issue_assigned',
          issueId: args.id,
          actorId: ctx.userID,
          eventKey: String(args.updatedAt),
          at: args.updatedAt,
          assigneeId: args.assigneeId,
        })
      }),
    },
    comment: {
      // `event_key` is the comment's own call-site-minted id, so a rebased re-run addresses exactly
      // the same primary key and writes nothing new.
      create: defineMutator(createCommentArgs, async ({ tx, args, ctx }) => {
        await mutators.comment.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (ctx === undefined) return
        // ONE COMMENT, ONE ROW PER PERSON. Whoever this comment names by name gets the `mention`
        // row and NOT the ambient one: the two carry different kinds, so the primary key cannot
        // collapse them, and "Ada mentioned you" already says everything "Ada commented" would.
        // Computed once, from the same diff the mention fan-out runs, and applied to BOTH ambient
        // producers — the involvement one reaches a mentioned assignee, the subscriber one reaches
        // a mentioned person who was already following. Ordering alone only covers the person who
        // is neither.
        const named = new Set(addedMentionIds(null, args.body, ctx.userID))
        await fanOut(tx, {
          kind: 'issue_commented',
          issueId: args.issueId,
          actorId: ctx.userID,
          eventKey: args.id,
          at: args.createdAt,
          exclude: named,
        })
        // SUBSCRIBERS ARE READ BEFORE THE MENTION FAN-OUT SUBSCRIBES ANYONE. Ordered the other way,
        // somebody mentioned by this very comment would be subscribed and then immediately handed
        // an ambient "commented" row for the same comment they were just told about by name.
        await fanOutToSubscribers(tx, {
          issueId: args.issueId,
          actorId: ctx.userID,
          eventKey: args.id,
          at: args.createdAt,
          exclude: named,
        })
        await fanOutMentions(tx, {
          issueId: args.issueId,
          actorId: ctx.userID,
          eventKey: args.id,
          at: args.createdAt,
          previousDoc: null,
          nextDoc: args.body,
        })
      }),
      // `event_key` is the COMMENT'S id here too, not the edit's timestamp, and that is the crux of
      // the change: the key is stable across every edit of one comment, so the previous-vs-next
      // diff decides who is new and the composite primary key absorbs everyone who is not. Editing
      // to add a mention notifies once; re-saving the identical body notifies nobody.
      edit: defineMutator(editCommentArgs, async ({ tx, args, ctx }) => {
        const before =
          tx.location === 'server'
            ? ((await tx.run(zql.comment.where('id', args.id).one())) as
                | { id: string; issueId: string; body: unknown }
                | undefined)
            : undefined
        await mutators.comment.edit.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (ctx === undefined || before === undefined) return
        await fanOutMentions(tx, {
          issueId: before.issueId,
          actorId: ctx.userID,
          eventKey: args.id,
          at: args.updatedAt,
          previousDoc: before.body,
          nextDoc: args.body,
        })
      }),
    },
    notification: {
      // The shared mutator's loop only ever sees the rows the caller synced (design D15), so the
      // rest are stamped in one raw statement here. The shared mutator runs first, which keeps the
      // authorization check in exactly one place.
      markAllRead: defineMutator(markAllNotificationsReadArgs, async ({ tx, args, ctx }) => {
        await mutators.notification.markAllRead.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (ctx === undefined) return
        await markAllNotificationsReadInDb(serverDb(tx), {
          recipientId: ctx.userID,
          readAt: args.readAt,
        })
      }),
    },
    member: {
      // Leaving the WORKSPACE deletes every notification addressed to that person, across every
      // team (design D11, H3). This cannot be a shared mutator: an admin removing somebody else
      // cannot see that person's notification rows, so the optimistic pass has nothing to delete —
      // and `notifications.mine` being the only synced query over the table means the admin's
      // client never learns what was removed either.
      remove: defineMutator(removeMemberArgs, async ({ tx, args, ctx }) => {
        const target =
          tx.location === 'server'
            ? ((await tx.run(zql.workspace_member.where('id', args.id).one())) as
                | { id: string; userId: string }
                | undefined)
            : undefined
        await mutators.member.remove.fn({ tx, args, ctx })
        if (tx.location !== 'server' || target === undefined) return
        await deleteNotificationsForMember(serverDb(tx), target.userId)
        await deleteSubscriptionsForMember(serverDb(tx), target.userId)
      }),
    },
    team: {
      // Leaving ONE TEAM deletes only that person's notifications for that team. Their inbox for
      // every other team is untouched, which is the whole distinction design D11 turns on — and it
      // is sound only because an issue can never change team (D16).
      removeMember: defineMutator(removeTeamMemberArgs, async ({ tx, args, ctx }) => {
        const membership =
          tx.location === 'server'
            ? ((await tx.run(zql.team_membership.where('id', args.id).one())) as
                | { id: string; teamId: string; userId: string }
                | undefined)
            : undefined
        await mutators.team.removeMember.fn({ tx, args, ctx })
        if (tx.location !== 'server' || membership === undefined) return
        await deleteNotificationsForTeamMember(serverDb(tx), {
          recipientId: membership.userId,
          teamId: membership.teamId,
        })
        await deleteSubscriptionsForTeamMember(serverDb(tx), {
          userId: membership.userId,
          teamId: membership.teamId,
        })
      }),
    },
    cycle: {
      create: defineMutator(createCycleArgs, async ({ tx, args, ctx }) => {
        await mutators.cycle.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const number = await claimNextCycleNumber(serverDb(tx), args.teamId)
        await tx.mutate.cycle.update({ id: args.id, number, updatedAt: args.updatedAt })
      }),
    },
    retro: {
      // Advancing forward out of `brainstorm` reveals every participant's cards at once. The phase
      // flip itself stays in the shared mutator, so the interaction is still instant; the rest of the
      // board arrives a sync tick later.
      setPhase: defineMutator(setRetroPhaseArgs, async ({ tx, args, ctx }) => {
        const before = (await tx.run(zql.retro.where('id', args.id).one())) as
          | { id: string; phase: string; isAnonymous: boolean }
          | undefined
        await mutators.retro.setPhase.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (before === undefined) return
        if (before.phase !== 'brainstorm' || args.to !== 'group') return
        await publishRetroDrafts(
          tx,
          { id: args.id, isAnonymous: before.isAnonymous },
          args.updatedAt,
        )
      }),
      // The timer's end is recomputed from the SERVER clock, which is authoritative, so a skewed
      // client cannot shift the moment every other client counts down to.
      startTimer: defineMutator(startRetroTimerArgs, async ({ tx, args, ctx }) => {
        await mutators.retro.startTimer.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        await tx.mutate.retro.update({
          id: args.id,
          timerEndsAt: Date.now() + args.durationS * 1000,
          updatedAt: args.updatedAt,
        })
      }),
      // A converted action's issue claims the same per-team number as any hand-created issue, in the
      // same authoritative pass, so the two are indistinguishable. Skipped when the action was
      // already converted (the shared mutator returned without creating anything).
      //
      // THE FIFTH TRIGGER SITE. The conversion calls the SHARED `issue.create` function directly
      // (mutators.ts), which is the whole point — same authorization, same defaults — but that means
      // it never reaches the `issue.create` OVERRIDE above, where the fan-out lives. An action
      // carrying an owner therefore produced an assigned issue nobody was told about. The fan-out
      // runs here, after the number is claimed, so the notification carries `ENG-42` like any other.
      //
      // NOT a mention trigger site: `retroActionDescription` builds the issue's description from
      // plain strings, so it can never contain a mention node. Verified, and stated here so the
      // next reader does not re-derive it.
      convertActionToIssue: defineMutator(
        convertRetroActionToIssueArgs,
        async ({ tx, args, ctx }) => {
          const before = (await tx.run(zql.retro_action.where('id', args.actionId).one())) as
            | { id: string; issueId: string | null }
            | undefined
          await mutators.retro.convertActionToIssue.fn({ tx, args, ctx })
          if (tx.location !== 'server') return
          if (before === undefined || before.issueId !== null) return
          const issue = (await tx.run(zql.issue.where('id', args.issueId).one())) as
            | { id: string; teamId: string; assigneeId: string | null }
            | undefined
          if (issue === undefined) return
          const number = await claimNextIssueNumber(serverDb(tx), issue.teamId)
          await tx.mutate.issue.update({ id: args.issueId, number, updatedAt: args.updatedAt })
          if (issue.assigneeId === null || ctx === undefined) return
          await fanOut(tx, {
            kind: 'issue_assigned',
            issueId: args.issueId,
            actorId: ctx.userID,
            eventKey: String(args.updatedAt),
            at: args.updatedAt,
            assigneeId: issue.assigneeId,
          })
        },
      ),
    },
    retroCard: {
      // The self-delete path is re-verified against the server-only author table, which is the final
      // authority on who wrote a card (the shared mutator's client-checkable proof is the caller's own
      // retained draft row). The facilitator/admin moderation path needs no author at all. Checked
      // BEFORE the shared mutator, which deletes the row.
      delete: defineMutator(deleteRetroCardArgs, async ({ tx, args, ctx }) => {
        if (tx.location === 'server') await assertCardDeleteAuthority(tx, args.id, ctx)
        await mutators.retroCard.delete.fn({ tx, args, ctx })
      }),
    },
    retroVote: {
      // The tally is incremented in ONE statement rather than read-then-written, because a whole team
      // voting at once would otherwise lose updates. The shared mutator writes the optimistic tally
      // on the client only, so this is the single authoritative write.
      //
      // The retro row is locked FIRST, before the shared mutator counts the caller's dots: that count
      // and the insert that follows it are two statements, and two casts racing under READ COMMITTED
      // would otherwise both read the same pre-insert count and both land, past the budget.
      cast: defineMutator(castRetroVoteArgs, async ({ tx, args, ctx }) => {
        if (tx.location === 'server' && ctx !== undefined) {
          await lockRetroForVote(serverDb(tx), args.retroId)
        }
        await mutators.retroVote.cast.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const vote = (await tx.run(zql.retro_vote.where('id', args.id).one())) as
          | { id: string; teamId: string }
          | undefined
        if (vote === undefined) return
        await bumpRetroVoteTally(serverDb(tx), {
          targetId: args.targetId,
          retroId: args.retroId,
          teamId: vote.teamId,
          targetType: args.targetType,
          delta: 1,
        })
      }),
      retract: defineMutator(retractRetroVoteArgs, async ({ tx, args, ctx }) => {
        const before = (await tx.run(zql.retro_vote.where('id', args.id).one())) as
          | {
              id: string
              retroId: string
              teamId: string
              targetType: 'card' | 'group'
              targetId: string
            }
          | undefined
        await mutators.retroVote.retract.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (before === undefined) return
        await bumpRetroVoteTally(serverDb(tx), {
          targetId: before.targetId,
          retroId: before.retroId,
          teamId: before.teamId,
          targetType: before.targetType,
          delta: -1,
        })
      }),
    },
  })
}
