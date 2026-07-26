# notifications — implementation tasks

**Big-feature rule (PROCESS.md §3): all three tiers.** This change touches **4 of 4** of {synced
entity/schema, mutator, permission surface, signature UI} — a new synced `notification` table plus a
`user_preference` column; five server-mutator fan-out sites and three new shared mutators; a
self-scoped query whose *whole point* is that it has no admin bypass; and a new `/inbox` route with
a shell badge and palette entries. The threshold is ≥2, so E2E is required rather than reflexive,
and it earns its place: the falsifiable check's supporting half is a **two-browser-context** test
that one client's assignment lights another client's badge *without a reload*, which no unit or
integration tier can express.

Groups are ordered so the app boots and runs after every one. The in-app inbox (groups 1–7) is
complete and useful before any mail code exists (groups 8–12); email is additive on top of it.

## 1. Schema: the notification table and its natural key

- [x] 1.1 Write `packages/schema/src/migrations/0013_notifications.ts`: create `notification` with
      `recipient_id text not null`, `actor_id text not null`, `kind text not null`,
      `team_id uuid not null references team(id) on delete cascade`, `subject_type text not null`,
      `subject_id uuid not null`, `subject_key text`, `subject_title text not null`,
      `event_key text not null`, `read_at timestamptz`, `email_sent_at timestamptz`,
      `created_at timestamptz not null default now()`, and the **composite primary key
      `(recipient_id, kind, subject_id, event_key)`**. No generated id column. **No CHECK on `kind`**
      — carry the design-D2 reason as a comment on the column, since its absence is the one thing a
      reviewer will flag. No FK on `subject_id` (polymorphic by `subject_type`), none on
      `recipient_id`/`actor_id` (the `user` table is better-auth's, matching `retro.facilitator_id`).
      Add the partial index `(recipient_id, created_at desc) where read_at is null`, and an index
      supporting the delivery sweep's `(read_at, email_sent_at, created_at)` predicate.
- [x] 1.2 In the same migration add `user_preference.email_notifications text not null default
      'assigned_only'` **with** a CHECK on `('all','assigned_only','none')` — the deliberate contrast
      with 1.1's absent CHECK; note both reasons in the migration header.
- [x] 1.3 Register `0013_notifications` in `packages/schema/src/migrations/index.ts`.
- [x] 1.4 Extend the hand-written Kysely `DB` interface in `packages/schema/src/db/types.ts` with
      `NotificationTable` (+ `Notification`/`NewNotification`/`NotificationUpdate`) and the new
      `user_preference` column; export the types from `packages/schema/src/db/index.ts`.
- [x] 1.5 Extend `packages/schema/src/db/schema-drift.test.ts`: add `notification` to `KYSELY_DB`
      with the new `user_preference` column, and assert the **compound primary key** matches (the
      test already introspects `pg_index`; make sure the four-column key is asserted in order).
- [x] 1.6 **Test**: `pnpm --filter @yapm/schema test` with `DATABASE_URL` set — migrations test and
      drift test green against a live database.

## 2. Zero schema, kinds, and the self-scoped query

- [x] 2.1 Add to `packages/schema/src/zero/context.ts`: `NOTIFICATION_KINDS`
      (`issue_assigned | issue_commented`) + `NotificationKind`, `NOTIFICATION_SUBJECT_TYPES`
      (`issue`) + `NotificationSubjectType`, `EMAIL_NOTIFICATION_MODES`
      (`all | assigned_only | none`) + `EmailNotificationMode`, and
      `ACTIONABLE_NOTIFICATION_KINDS` (design D13 — the set `assigned_only` emails; `mentions` adds
      one entry here and nothing else).
- [x] 2.2 Add the `notification` table to `packages/schema/src/zero/schema.ts` with
      `.primaryKey('recipientId', 'kind', 'subjectId', 'eventKey')` and column `.from()` mappings;
      add an `actor` → `user` relationship and a `team` → `team` relationship. **No `issue`
      relationship** (design D3). Register the table and its relationships in `createSchema`. Add
      `emailNotifications` to the `user_preference` table.
- [x] 2.3 Add `queries.notifications.mine` to `packages/schema/src/zero/queries.ts`, modelled on
      `retroDrafts.mine` (`queries.ts:238`) — bare `ctx.userID` filter, `isMember` gate,
      `denyAll` otherwise, **no `teamScoped`, no admin bypass**, `.related('actor')`,
      `.orderBy('createdAt','desc')`, `.limit(100)`. Export
      `NOTIFICATIONS_MINE_QUERY_NAME`. Carry the design-D4 reason as a comment.
- [x] 2.4 **Test**: unit coverage in `packages/schema/src/zero/queries.test.ts` for the new query's
      gating; `pnpm turbo typecheck` green.

## 3. Shared mutators: read state and the email preference

- [x] 3.1 Add `markNotificationReadArgs` (`{kind, subjectId, eventKey, readAt: number | null}`) and
      `notification.markRead` to `packages/schema/src/zero/mutators.ts`: gate on `isAuthenticated`,
      then `tx.mutate.notification.update({recipientId: ctx.userID, ...})` — recipient from the
      verified context, never args, which is what makes it structurally self-scoped (design D1).
- [x] 3.2 Add `markAllNotificationsReadArgs` (`{readAt: number}`) and
      `notification.markAllRead`: gate, then loop the caller's unread rows via `tx.run`, bounded by
      the same limit the query uses.
- [x] 3.3 Extend `setPreferenceArgs` with an optional `emailNotifications` and have `setPreference`
      write it on both insert and update, defaulting to `assigned_only` on first insert.
- [x] 3.4 Register `notification: {markRead, markAllRead}` in the `mutators` registry and export the
      mutator-name constants beside the existing ones.
- [x] 3.5 **Test**: `packages/schema/src/zero/mutators.test.ts` — `markRead` rejects an
      unauthenticated caller; a caller's args cannot address another recipient (the written row's
      recipient is always `ctx.userID`); `setPreference` round-trips the new field and rejects an
      invalid mode.

## 4. The write seam and the server-authoritative fan-out

- [x] 4.1 Write `packages/schema/src/zero/notifications/recipients.ts` — pure, no DB:
      `assignmentRecipients({assigneeId, actorId})` and
      `commentRecipients({assigneeId, creatorId, priorCommenterIds, actorId})` returning a
      deduplicated, actor-excluded, cap-bounded array; export `NOTIFICATION_RECIPIENT_CAP`.
- [x] 4.2 **Test**: `recipients.test.ts` — excludes the actor, dedupes overlapping
      assignee/creator/commenter, preserves a stable order, enforces the cap, returns empty for a
      self-assignment and for a null assignee.
- [x] 4.3 Write `packages/schema/src/zero/notifications/copy.ts` — pure kind → title/summary copy
      used by both the inbox row and the email template. **No comment-body excerpt anywhere**
      (design/proposal non-goal). Unit-test it.
- [x] 4.4 Write `packages/schema/src/db/notification.ts` (mirroring `db/cycle-digest.ts`):
      the `NotificationEvent` type and **`recordNotifications(db, events)`** — one multi-row
      `insert … on conflict do nothing`, no-op on empty. Add the sweep/retention/deletion accessors
      here too (`markAllNotificationsRead`, `deleteNotificationsForMember`,
      `deleteNotificationsForTeamMember`, `pendingNotificationEmails`, `stampNotificationsEmailed`,
      `deleteNotificationsOlderThan`) so every Kysely statement over the table lives in one file.
      Export from `packages/schema/src/db/index.ts`.
- [x] 4.5 **Re-export `recordNotifications` and `NotificationEvent` from
      `packages/schema/src/zero/server-mutators.ts`**, which is what `@yapm/schema/server` resolves
      to. This is the public seam `mentions` binds to (design D6) — it must exist and be exported
      here even though this change is its only caller.
- [x] 4.6 Add the private `NOTIFICATION_TRIGGERS` map and a `fanOut` helper inside
      `server-mutators.ts`: read `team.key` and the issue's `number` to compose `subject_key`, build
      events, call `recordNotifications` through `serverDb(tx)`.
- [x] 4.7 Wire the fan-out into `createServerMutators()` at **every** assignee-setting site (D5),
      each behind `if (tx.location !== 'server') return`: `issue.create` (after
      `claimNextIssueNumber`, so `subject_key` has a number), `issue.assign`, **`issue.routeIssue`**
      (the duplicated assignee path in `export const routeIssue` — do not miss it),
      **`retro.convertActionToIssue`** (calls the shared `issue.create` function, so it never
      reaches the override — DI-44), and `comment.create` (bounded prior-commenter read). Intersect
      the recipient set with current team membership before writing (DI-41).
- [x] 4.8 **Test**: `packages/schema/src/zero/server-mutators.test.ts` — the fan-out is skipped for a
      client-location transaction at every one of those sites.

## 5. Membership removal deletes notifications

- [x] 5.1 Add a `member.remove` server override: after the shared mutator, on the server only,
      delete **every** notification whose recipient is the removed user (design D11).
- [x] 5.2 Add a `team.removeMember` server override: delete that user's notifications whose
      `team_id` is the team being left, and **only** those.
- [x] 5.3 **Test**: unit coverage that both overrides are server-guarded and no-op on the client.

## 6. The falsifiable check

- [x] 6.1 Write `packages/schema/src/zero/mutators.notification.pg.test.ts`, gated by
      `describe.skipIf(DATABASE_URL === undefined)`. Seed workspace + team T + admin A + members B
      and C (all in T). Run `issue.assign` **twice with identical args**, then assert the five
      checks from design "How we will know this worked": (1) B sees exactly one row with the right
      shape, (2) C sees zero, (3) **admin A sees zero**, (4) a client-location transaction writes
      zero rows, (5) `markAllRead` as B stamps only B's rows.
- [x] 6.2 Extend the same file: `issue.create` with an assignee, `issue.routeIssue` with an
      assignee, and `comment.create`, each run twice, each asserting exactly one row per event — so
      `routeIssue` cannot be silently missed.
- [x] 6.3 Extend the same file with the leaver cases: removing B from T deletes B's T rows and keeps
      B's rows for a second team; removing B from the workspace deletes all of them.
- [x] 6.4 Add the `team_id` invariant guard test (design D16): assert no mutator mutates
      `issue.team_id`.
- [x] 6.5 **Run it**: `DATABASE_URL=postgres://yapm:yapm@localhost:5443/yapm pnpm --filter
      @yapm/schema test` — all green.

## 7. Web: the inbox, the badge, the palette, the preference

- [x] 7.1 Add `apps/web/src/notifications/model.ts` — pure row-shaping and grouping over the synced
      rows, plus the unread count and its "99+" cap. Unit-test it.
- [x] 7.2 Add `apps/web/src/notifications/inbox-view.tsx`: workspace-wide list, newest first,
      `j`/`k`/Down/Up move focus (the `data-index` model from `triage-view.tsx:88-112`),
      Enter/Right opens the subject and marks read, `e` toggles read. Every colour and font via
      tokens; AA in Warm/Focused/Editorial, light and dark. No body excerpts.
- [x] 7.3 Add the `/inbox` route (`apps/web/src/routes/inbox.tsx`) inside `Authenticated` +
      `AppShell`, matching the cross-team `issues.mine` precedent.
- [x] 7.4 Add the unread badge to `apps/web/src/components/app-shell.tsx`, reading the **same**
      `queries.notifications.mine` subscription the inbox uses (design D18), with the accessible
      name "Inbox, N unread" and a keyboard-reachable link to `/inbox`.
- [x] 7.5 Add the palette rows to `apps/web/src/issues/command.tsx`: "Go to inbox" in the existing
      Navigate group and "Mark all notifications as read" as an action. Do **not** touch the
      existing "Jump to issue" group — the later `search` change owns it.
- [x] 7.6 Add the email-notifications control beside the theme preference
      (`apps/web/src/components/theme-controls.tsx` or its sibling surface), fully keyboard-operable,
      writing through `preference.set`.
- [x] 7.7 **Test**: `apps/web` unit tests for the model and for the badge's accessible name;
      `pnpm turbo lint typecheck test` green.

## 8. Dependencies and `packages/email`

- [x] 8.1 Add to the pnpm catalog in `pnpm-workspace.yaml` (**never a direct version in a
      package.json**): `nodemailer` (^9.0.3, MIT-0, zero runtime dependencies),
      `@types/nodemailer`, `@react-email/render`, `@react-email/components`. `react`/`react-dom`
      and `react-email` are already in the catalog. Run `pnpm check:catalog`.
      *Done, minus `@react-email/components`: the whole `@react-email/*` component family is
      deprecated on npm (react-email v6 folded it into the `react-email` package). Only
      `@react-email/render` was added — see design DI-14.*
- [x] 8.2 **Verify before writing templates** (design D8): read the installed
      `node_modules/@react-email/render/**/*.d.ts` and confirm the render signature and the
      plain-text option under TS7 + `moduleResolution: nodenext` + `verbatimModuleSyntax`. If JSX
      proves hostile, fall back to `React.createElement`, then to plain template functions — nothing
      outside this package changes in any case. Record what was found in design.md's decision log.
- [x] 8.3 Scaffold `packages/email` (`@yapm/email`): package.json referencing everything as
      `catalog:`, a tsconfig extending `@yapm/config/tsconfig/node` with the `jsx` (and, if needed,
      `lib`) setting isolated here, and `react-email` as a devDependency for `email dev` preview.
      Add it to the Turborepo pipeline if it needs anything beyond the defaults.
- [x] 8.4 Define `RenderedMessage` (`{subject, html, text}`) and implement
      `renderNotificationDigest(input)` and `renderInvite(input)` — text produced from the **same**
      render call as the HTML. The package imports no transport and reads no environment.
- [x] 8.5 **Test**: `packages/email` unit tests asserting subject, that every link is built from the
      supplied public base URL, that no comment body appears anywhere, and that HTML and text name
      the same subjects. No network, no server.
- [x] 8.6 Copy `packages/email/package.json` in `docker/Dockerfile` beside the other workspace
      manifests, and add `scripts/check-image-manifests.mjs` (wired into CI's `boundary-guard` job
      and `pnpm check:image-manifests`) so a workspace package missing from that hand-maintained
      list fails by name instead of silently producing an image that cannot build — design DI-22.
- [x] 8.7 Add the `specs/monorepo-workspace/spec.md` delta: the current-behaviour spec's package
      list is exhaustive and `packages/email` makes it false — design DI-23.

## 9. Configuration

- [x] 9.1 Extend `apps/server/src/config/env.ts`: `PUBLIC_URL` (optional string URL),
      `EMAIL_FROM` (optional), `RESEND_API_KEY` (optional), `NOTIFICATION_EMAIL_CRON`
      (default `*/2 * * * *`), `NOTIFICATION_RETENTION_DAYS` (default `30`),
      `NOTIFICATION_RETENTION_CRON` (default `7 3 * * *`). Add a `.check()` refinement — the
      `GITHUB_APP_VARS` precedent — requiring `EMAIL_FROM` **and** `PUBLIC_URL` when either
      transport is set, failing boot by name. Add every variable to `EXPECTED_FORMAT`.
- [x] 9.2 Add a `mailEnv(env)` helper mirroring `githubAppEnv`/`aiEnv`: returns the selected
      transport config or `null`, applying the Resend-over-SMTP precedence (design D7).
- [x] 9.3 Sharpen the `WEB_ORIGIN` documentation (design D12) — **do not change the Zod default**;
      correct `.env.example`'s comment to explain that 5173 is the `pnpm dev` SPA origin and 3000 is
      the same-origin compose deployment, and that `PUBLIC_URL` is the variable email uses.
- [x] 9.4 Update `.env.example` with the new variables, each commented, and the `SMTP_URL` comment
      updated now that it is actually consumed.
- [x] 9.5 **Test**: `apps/server/src/config/env.test.ts` — no transport boots clean; a transport
      without `EMAIL_FROM` fails naming it; a transport without `PUBLIC_URL` fails naming it; both
      transports set selects Resend; a malformed `PUBLIC_URL` fails naming it.
- [x] 9.6 Validate the shape of the transport variables that **have** one, so the
      `email-delivery` scenario "a malformed transport setting fails fast" is actually met and the
      docs stop promising something the schema did not do (design DI-39): `SMTP_URL` must parse as a
      URL on the `smtp:`/`smtps:` scheme — otherwise nodemailer throws an opaque
      `TypeError: Cannot create property 'mailer' on string …` after boot (reference/email.md §3.3)
      — and `EMAIL_FROM` must contain an address. `RESEND_API_KEY` stays unchecked and the docs say
      why. **Test**: both `SMTP_URL` failures and the `EMAIL_FROM` failure name the variable and its
      expected format; `smtps://` and a bare From address are accepted.

## 10. The mailer seam and its two implementations

- [x] 10.1 **Verify before writing** (design D9): typecheck a minimal
      `nodemailer.createTransport(url).sendMail(...)` against the installed `@types/nodemailer`,
      whose major trails nodemailer's. If they are incompatible, write the local `.d.ts` covering
      `createTransport`/`sendMail` and record it in design.md's decision log.
- [x] 10.2 Write `apps/server/src/mail/mailer.ts` — the `Mailer`, `OutboundMessage` and
      `RenderedMessage` types. Transport-neutral by construction: recipients + a rendered message,
      nothing else.
- [x] 10.3 Write `apps/server/src/mail/smtp.ts` — `SmtpMailer` over `SMTP_URL`, constructed with an
      injectable `createTransport` so tests need no server.
- [x] 10.4 Write `apps/server/src/mail/resend.ts` — `ResendMailer`: one authenticated JSON POST to
      `https://api.resend.com/emails` via an injectable `fetch`; non-2xx throws with status and
      body. **No SDK.**
- [x] 10.5 Write `apps/server/src/mail/index.ts` — `createMailer(env)` returning `Mailer | null`
      with the D7 precedence table, one info log when email is disabled, one warn log naming the
      ignored variable when both are set.
- [x] 10.6 **Test**: `apps/server/src/mail/*.test.ts` — both implementations driven through doubles
      assert the same `RenderedMessage` reaches the transport; `createMailer` returns `null` with no
      config; a transport error propagates as a rejected promise the caller can catch. **No real
      network call, no credentials, in CI or locally.**

## 11. One scheduler, two new queues

- [x] 11.1 Refactor `apps/server/src/jobs/scheduler.ts`: `startCycleScheduler` →
      `startScheduler`, `StartCycleSchedulerOptions` → `StartSchedulerOptions` with independently
      gated `cycles?:` and `notifications?:` blocks, extending the shape `digest?:` already uses
      (`scheduler.ts:37`). **Exactly one `PgBoss` instance and one `boss.start()` in the process** —
      do not add a third (design D10).
- [x] 11.2 Update `apps/server/src/index.ts`: start the scheduler when **cycles OR notifications**
      is enabled, so `CYCLE_MAINTENANCE=false` no longer silently disables notification retention.
- [x] 11.3 Add the `notification-email` queue + worker (registered only when a mailer exists):
      select unread + unemailed + past the 2-minute debounce + younger than 24h, **joined to current
      `team_membership`**, to `user_preference` for the mode and `user` for the address; filter by
      the actionable/ambient classification (design D13); group per recipient into one message;
      render via `@yapm/email`; send via the `Mailer`; stamp `email_sent_at` on exactly the rows
      sent. Catch and log transport failures inside the job, leaving rows unstamped.
- [x] 11.4 Add the `notification-retention` queue + worker, **always registered**, bounded delete
      past `NOTIFICATION_RETENTION_DAYS`.
- [x] 11.5 **Test**: `apps/server/src/jobs/*.test.ts` — the sweep with a `null` mailer completes,
      throws nothing and stamps nothing; a recipient who lost team membership between write and
      sweep is excluded; an already-read notification is excluded; several notifications for one
      recipient become one message; a throwing transport leaves rows unstamped and does not throw
      out of the worker; retention registers with no mailer.

## 12. The invite email, through the seam

- [x] 12.1 Wire invite creation to render `renderInvite` and send through the shared `Mailer`,
      building the accept link from `PUBLIC_URL`. With no mailer the invite still succeeds and the
      link is still presented — sending is simply skipped.
- [x] 12.2 **Test**: an invite with no mailer sends nothing and still returns its link; an invite
      with a mailer double hands the rendered message to the transport. This closes
      `openspec/specs/invitations/spec.md`'s "WHEN SMTP is configured … THEN the invite email is
      sent" scenario, false for nine changes.

## 13. E2E

- [x] 13.1 Write `apps/web/e2e/notifications.spec.ts`: two browser contexts, A and B. A assigns an
      issue to B. With **no reload**, B's header badge reads "Inbox, 1 unread"; B reaches `/inbox`
      by keyboard only (Cmd-K → "Go to inbox"), presses `j` then Enter, lands on the issue, and the
      badge clears.
      *Split across two tests, because the badge lives in `AppShell` and the palette lives in
      `issue-list.tsx` and no route has both — see design DI-32. Test 1 also proves H4 against the
      admin's IndexedDB replica; test 2 adds the comment trigger and the no-body-leak guarantee.*
- [x] 13.2 Run it against the isolated stack (project `yapm-nt`, ports 5443/4851/3003) and confirm
      green.

## 14. Documentation

- [x] 14.1 `apps/docs/src/content/docs/features/notifications.md` — what triggers a notification and
      what deliberately does not, the keyboard map, read/unread and retention, the per-user email
      preference and its actionable-only default, that **no admin can read your inbox**, and that a
      notification shows the issue title **as it was** (design D3 — say it here or it gets reported
      as a bug).
- [x] 14.2 `apps/docs/src/content/docs/self-hosting/email.md` — the two transports and when to pick
      which (including "your host blocks outbound SMTP"), the precedence when both are set, every
      new variable, `PUBLIC_URL` and why it is required, and that unconfigured email is cleanly off.
- [x] 14.3 Add both pages to the Starlight sidebar in `apps/docs/astro.config.mjs` and link from the
      docs home.
- [x] 14.4 Root docs: `README.md` (status + feature list), `ROADMAP.md` (the change row →
      delivered), `TECHSTACK.md` — the Email row rewritten for the two-transport seam, **the
      version-baseline line 75 error "react-email 1.x" corrected**, and `nodemailer` added to the
      baseline. `.env.example` is covered by 9.3–9.4.
- [x] 14.5 `pnpm --filter @yapm/docs build` passes, and the documented configuration matches the Zod
      schema with no drift.

## 15. Verification

- [x] 15.1 `pnpm turbo lint typecheck test build` green — 917 unit/integration tests across six
      packages, run against a live Postgres on a fresh volume.
- [x] 15.2 `pnpm check:catalog` and `pnpm check:boundaries` green — no direct dependency versions,
      no ZQL or mutator definition outside `packages/schema`, no package importing an app.
      `check:image-manifests` green too, which is what catches `packages/email` missing from the
      Dockerfile's pre-install copy list.
- [x] 15.3 The compose smoke test passes against the isolated project/ports, proving zero-cache
      replicates cleanly past the new table with its compound primary key. The full Playwright
      suite (65 tests, this change's two specs plus every prior one) passes against the isolated
      stack, and the three-container production image boots, applies `0013_notifications`, and
      syncs. **The e2e suite requires a fresh database**: re-running it against the volume left by
      a previous run fails eight theme/auth assertions, because the fixed `admin@example.test`
      account's persisted `user_preference` row overwrites the localStorage theme the preset tests
      set. That is a pre-existing property of the suite, unchanged by this change, and matches how
      CI runs it.
- [x] 15.4 Walked every scenario in `specs/notifications/spec.md` and `specs/email-delivery/spec.md`.
      The three that only a live boot can show were observed in the production image: email
      unconfigured logs "Email is disabled …" and boots; retention still schedules with no mailer;
      and `SMTP_URL` without `PUBLIC_URL` fails boot naming `PUBLIC_URL`.
- [x] 15.5 Record anything the specs did not anticipate under
      `## Decisions made during implementation` in `design.md` — what was ambiguous, what was
      chosen, why. (DI-40 records the literal-NUL defect found and fixed in this pass.)
