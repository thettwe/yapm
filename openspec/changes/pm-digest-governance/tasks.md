## 1. Configuration

- [x] 1.1 Add `AI_DISCLOSURE_RETENTION_DAYS` (`z.coerce.number().int().min(1).max(3650).default(365)`)
      and `AI_DISCLOSURE_RETENTION_CRON` (`cronExpression.default('23 3 * * *')`) to the Zod env
      schema, with the `NOTIFICATION_RETENTION_*` entries as the shape to copy.
- [x] 1.2 Add `AI_PM_DIGEST_READY_EMAIL` (`'true' | 'false'`, default `'false'`) beside
      `AI_PM_DIGEST`, and extend the existing cross-field refinement so
      `AI_PM_DIGEST_READY_EMAIL=true` with `AI_PM_DIGEST=false` fails at boot naming **both**
      variables (design D7, on change 20's I1 precedent).
- [x] 1.3 Add the three variables to the env-var description map used by the fail-fast reporter, and
      to `.env.example` in the AI block, each with the sentence that says why the default is what it
      is.

## 2. Retention sweep for the disclosure audit log

- [x] 2.1 `deleteDisclosureAuditOlderThan(db, before)` in `packages/schema/src/db/pm-disclosure.ts`,
      deleting from `ai_disclosure_audit` only and returning the row count — the shape of
      `deleteNotificationsOlderThan`.
- [x] 2.2 `AI_DISCLOSURE_RETENTION_QUEUE` and `runDisclosureRetention` in a new
      `apps/server/src/jobs/disclosure.ts`, copying `runNotificationRetention` (a `SweepLogger`, a
      `now`, a log line only when it deleted something).
- [x] 2.3 Register it in `startScheduler` as an independent block on the **shared** boss —
      `createQueue` / `work` / `schedule` / one log line — with its own try/catch so a registration
      failure cannot take the other blocks with it. No second `PgBoss`, no second `boss.start()`.
- [x] 2.4 Wire it in `apps/server/src/index.ts` unconditionally (it is not gated on AI, on the
      disclosure switches or on a mailer — design D3).

## 3. The publish-time ready notice

- [x] 3.1 Add `'pm_digest_published'` to `NOTIFICATION_KINDS` and `'pm_digest'` to
      `NOTIFICATION_SUBJECT_TYPES` in `zero/context.ts`, and decide its membership of
      `ACTIONABLE_NOTIFICATION_KINDS` explicitly (it is addressed at a named person, so it is
      actionable) with the reasoning in the comment.
- [x] 3.2 Extend `notificationCopy` with an actor-free branch: title "A cycle digest was shared with
      you", summary from the yapm-computed team and cycle names. No actor label, no content.
- [x] 3.3 In the `pmDigest.publish` server override, after the release is stamped, fan out one
      `notification` row per member of the team's resolved audience — `actor_id` =
      `SYSTEM_ACTOR_ID` (design D5), `subject_type` = `'pm_digest'`, `subject_id` = the digest id,
      `event_key` = `String(args.publishedAt)`, `subject_title` = the baked team/cycle label.
      Server-only, in the same transaction, `on conflict do nothing` by the natural primary key.
- [x] 3.4 Add the `pm_digest` case to the inbox's `open()` navigation (`/digests`) so the row is not
      a dead end, keeping the existing `subjectType` switch exhaustive.

## 4. Ready-email delivery

- [x] 4.1 `packages/email/src/pm-digest-ready.tsx`: `renderPmDigestReady({ publicUrl, teamName,
      cycleName })` — a `Layout`, a single `Button` to `/digests`, a subject line, and **no field in
      the input type capable of carrying content**. Export it from `packages/email/src/index.ts`.
- [x] 4.2 Narrow `pendingNotificationEmails` with `subject_type = 'issue'`, commented as the clause
      that makes the two selections disjoint. It removes no row today.
- [x] 4.3 `pendingPmDigestReadyEmails` beside it in `db/notification.ts`: `subject_type =
      'pm_digest'`, unread, unstamped, within the debounce and recency windows, the same
      `email_notifications` predicate in the same SQL position, and **no access predicate at all** —
      with the comment saying entitlement is re-resolved in TypeScript instead.
- [x] 4.4 `AI_PM_DIGEST_READY_QUEUE` and `runPmDigestReadyEmailSweep` in `jobs/disclosure.ts`: per
      recipient, re-resolve `resolvePmAudienceTeamIds` and drop anyone whose resolved set no longer
      contains the notice's team; render; send; stamp with `stampNotificationsEmailed`. Contain every
      transport failure inside the sweep exactly as the notification sweep does.
- [x] 4.5 Register it on the shared boss only when a mailer, a public URL and
      `AI_PM_DIGEST_READY_EMAIL=true` are all present, reusing `NOTIFICATION_EMAIL_CRON`; wire it in
      `index.ts`.

## 5. The admin audit view

- [x] 5.1 `disclosureAuditLogForWorkspace(db, workspaceId)` in `db/pm-disclosure.ts`, modelled on
      `retroVerdictLogForWorkspace`: per-team totals plus the recent events, each with time, event,
      team name, actor display name and the recorded `detail`. Bounded by an explicit limit. It
      SHALL have no actor-keyed aggregate.
- [x] 5.2 `GET /api/v1/ai/disclosures` in `ai/admin-routes.ts` behind the existing `requireAdmin`,
      beside `/verdicts`, with the comment saying it refuses before any read and that there is no
      companion write.
- [x] 5.3 Client types and `fetchAiDisclosureLog()` in `apps/web/src/settings/ai.ts`, mirroring the
      verdict-log pair.
- [x] 5.4 A read-only `DisclosureAuditSection` on the AI settings page: per-team totals, the recent
      events, tokens-only styling, correct in all three themes light and dark, AA contrast, fully
      keyboard-operable. Rendered only when the log is non-empty (design D9).
- [x] 5.5 Section copy states what the view is and is not, in the product's own words: what was
      disclosed and to how many readers; no read is recorded anywhere; retraction stops further
      reads but does not un-read (change 20's exact formulation).

## 6. Tests

- [x] 6.1 `packages/schema/src/db/pm-disclosure-retention.pg.test.ts`: a record older than the window
      is deleted, one inside it is not, a second run deletes nothing, and `pm_digest` and
      `cycle_digest` rows for the same cycle are untouched.
- [x] 6.2 `packages/email/src/pm-digest-ready.test.tsx`: render the notice for a digest whose content
      carries distinctive summary, highlight and evidence-label strings; assert the rendered HTML and
      text contain the `/digests` URL and **no substring of any of them**. Asserted against the
      rendered output, never the template source.
- [x] 6.3 Sweep unit tests: with `mailer: null` the ready sweep is a total no-op and throws nothing;
      a transport failure leaves the notice unstamped and does not throw; a recipient whose resolved
      audience no longer contains the team is dropped before any send.
- [x] 6.4 Scheduler topology test: the disclosure retention queue is registered on the shared boss
      with the configured cron, is registered with AI and the mailer both absent, and the ready queue
      is registered only when the mailer and the switch are both present.
- [x] 6.5 Admin-route tests: a member and a viewer are refused before any read, and the refusal in a
      workspace that has used disclosure is byte-identical to one that never has; an admin gets the
      totals and events; the response body contains no reader identity, no read event and no audience
      list.
- [x] 6.6 `apps/web/src/settings/ai-disclosure-log.test.tsx`: the section renders totals and events,
      renders nothing when the log is empty, and exposes no per-person aggregate.
- [x] 6.7 `apps/server/src/config/env-example.test.ts`: the `.env.example` key set equals the Zod
      schema key set modulo the two declared, commented exception lists (design D10).
- [x] 6.8 Notification disjointness: `pendingNotificationEmails` selects no `pm_digest`-subject row
      and `pendingPmDigestReadyEmails` selects no issue row, asserted against seeded rows of both
      kinds — including a recipient who is a workspace admin **and** a named reader, who must be
      mailed once.
- [x] 6.9 Extend `apps/web/e2e/pm-digest.spec.ts` with the inbox half: after a publication, the named
      reader's inbox holds the notice, it names no publisher, and its rendered text contains no
      substring of the digest content.

## 7. Documentation

- [x] 7.1 New `apps/docs/src/content/docs/self-hosting/ai-disclosure.md` — the disclosure model end
      to end: the four switches, what generation costs, what the audit log records and what it
      deliberately does not (no reads, ever), the retention window and why 365, the ready email and
      why it carries a link only, and retraction in change 20's exact words.
- [x] 7.2 Update `features/pm-digest.md` for the governance half, now using "auditable" and
      "retention-bounded" accurately and saying what each actually means.
- [x] 7.3 Update `self-hosting/ai-setup.md` and `self-hosting/email.md` with the three new variables
      and the second sweep.
- [x] 7.4 Update `README.md`: move governance out of "What's next" into shipped, and sweep the
      paragraphs change 20 wrote around the two forbidden words.
- [x] 7.5 Update `ROADMAP.md` row 23 to built, and check the "Where v1 actually stands" narrative
      tells the truth now that the AI-features family is complete.
- [x] 7.6 Update `VISION.md` where it describes the AI posture, and `.env.example`.
- [x] 7.7 Update `PROCESS.md` §2 so its mechanical-check claim points at the check that now exists.

## 8. Verification

- [x] 8.1 `pnpm turbo lint typecheck test build` clean.
- [x] 8.2 `node scripts/check-boundaries.mjs` clean (packages never import apps).
- [x] 8.3 The pg suites run against a live Postgres, and the compose smoke test passes.
