import { extractMentionIds } from '../../rich-text/plaintext.js'
import { NOTIFICATION_RECIPIENT_CAP } from '../notifications/recipients.js'

// Who a document write newly mentions, as a pure function of the two documents. Pure so the rule is
// testable without a database, and array-shaped in and out so one trigger can fan out to many
// recipients — the seam a later group mention (`@team`, `@here`) expands into without touching the
// callers.
//
// ADDED-ONLY is what makes an edit notify once. `previous` is the document as stored before this
// write; anybody already mentioned there has been told, and re-saving a body whose mention set did
// not change produces an empty array and therefore zero statements. The composite primary key on
// `notification` is the second half of that guarantee (design D7): removing and re-adding a mention
// yields a non-empty diff, and the insert it produces is absorbed by the key it already wrote.
export function addedMentionIds(previous: unknown, next: unknown, actorId: string): string[] {
  const before = new Set(extractMentionIds(previous))
  const added = extractMentionIds(next).filter((id) => !before.has(id) && id !== actorId)
  // TRUNCATED FROM THE END, so the notified set is the one the author wrote FIRST. The cap exists
  // because the fan-out runs inside the triggering mutation's Postgres transaction (see
  // `NOTIFICATION_RECIPIENT_CAP`), and past it the excess are simply not notified — no error, no
  // partial rollback, and the document still saves with every mention node intact and rendering
  // normally.
  return added.slice(0, NOTIFICATION_RECIPIENT_CAP)
}
