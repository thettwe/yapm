## Why

Today you can assign someone an issue and they have no way to find out. Nothing in the repo
matches `notification` — zero files — while ROADMAP's locked v1 scope has said since day one
that notifications are "in-app inbox + email for mentions/assignments". A tracker whose
assignments are silent is a tracker people leave open in a tab and still miss work in.

It is also the change with the highest debt-per-line in the backlog. `SMTP_URL` has shipped in
`apps/server/src/config/env.ts` and `.env.example` since `workspace-auth` with **zero
consumers**, and `openspec/specs/invitations/spec.md` asserts a scenario — "WHEN SMTP is
configured and an admin creates an email invite THEN the invite email is sent" — that nothing
in this repo can satisfy. That spec has been false for nine changes. Building the mailer here
closes it.

It serves VISION **#1 Speed is the feature** (the fan-out rides the authoritative pass, so no
interaction newly waits on the network; the inbox is a synced Zero query, instant and readable
offline; every inbox action is keyboard-first), **#2 Opinionated defaults, real escape hatches**
(one debounced digest per recipient, never-email-what-you-already-read, and a provider-neutral
mailer so a self-hoster on a host that blocks outbound SMTP is not stranded),
**#4 Metrics for teams, never surveillance** (a notification is *routing to one person*, not a
per-person record — and no admin, of any role, can read another user's inbox), **#5 Free means
free** (viewers are notified and emailed like everyone else; no role gate, no seat gate), and
**#6 Deployable in minutes** (still exactly three containers; unconfigured email is cleanly off,
never a boot failure).

## What Changes

- **A `notification` entity**, per-recipient, synced, whose **primary key is its natural key**:
  `(recipient_id, kind, subject_id, event_key)`. This is the crux. A notification fans out to N
  rows and **mutators re-run during rebase** (CLAUDE.md #4), so a fan-out that re-runs could
  duplicate rows or re-send email. Making the natural key the PK means **no id is minted
  anywhere in this change**, constraint #4 is never engaged, `on conflict do nothing` needs no
  separate unique index, and the idempotency test proves itself instead of proving a side
  constraint. Compound primary keys are supported by Zero and used in production by zbugs.
- **Two kinds, fanned out only on the server-authoritative pass**, behind
  `if (tx.location !== 'server') return`: `issue_assigned` (from `issue.create` carrying an
  assignee, `issue.assign`, **and `issue.routeIssue`, which carries its own duplicated assignee
  path** — a fourth trigger site, in scope, not an oversight) and `issue_commented` (from
  `comment.create`; recipients = assignee ∪ creator ∪ prior commenters, deduped, minus the
  actor, capped).
- **`recordNotifications(db, events)` exported from `@yapm/schema/server`** as the public write
  seam — one multi-row `insert … on conflict do nothing` inside the caller's transaction. The
  `NOTIFICATION_TRIGGERS` kind→recipients/copy map stays **private to this change**. The later
  `mentions` change adds a `kind` through the seam without reopening this one; that is why
  `notification.kind` gets **no Postgres CHECK constraint**, a deliberate deviation from the
  house style `0012_retro` established.
- **A self-scoped `notifications.mine` synced query with NO workspace-admin bypass** — the
  `retroDrafts.mine` shape, not `teamScoped`. An admin can read every issue in the workspace and
  **still cannot read anyone's inbox**, enforced in the permission model with a test that proves
  it.
- **Shared `notification.markRead` / `markAllRead` mutators**, optimistic and instant. Because
  `recipient_id` is part of the primary key and is taken from the verified `ctx.userID`, a
  caller is *structurally* unable to address another person's row.
- **A provider-neutral `Mailer` seam with TWO implementations** — the same
  framework-plus-implementations shape TECHSTACK documents for connectors. **`SmtpMailer`**
  (`SMTP_URL`) already reaches Mailgun, Resend, Mailjet, Postmark, SendGrid and SES, all of
  which issue SMTP relay credentials. **`ResendMailer`** (HTTPS, a single authenticated `fetch`
  POST — no SDK) exists because **some hosts block outbound SMTP ports entirely**, and on those
  an HTTPS sender is the only path out. The interface is shaped around "send this rendered
  message to these recipients", not around SMTP with HTTP bolted on; react-email renders once
  and both transports send the same output.
- **Templates rendered with react-email**, honouring TECHSTACK rather than hand-written HTML
  strings, in a new `packages/email` workspace package (see design D8 — the catalog's
  `react-email` entry is the dev **CLI**; the runtime renderer is `@react-email/render` +
  `@react-email/components`). TECHSTACK's own inconsistency is fixed here: line 46 commits to
  react-email, line 75 says "react-email 1.x", the catalog pins `^6.9.0`.
- **Two cron queues on the EXISTING scheduler** — `notification-email` (sweep unread, unemailed,
  past the debounce; **join current team membership at delivery time**; group per recipient; one
  digest message; stamp `email_sent_at`) and `notification-retention`. `startCycleScheduler`
  becomes `startScheduler` taking optional feature blocks, extending the shape `digest?:`
  already uses. **No third `PgBoss` instance** — three `boss.start()` calls against one `pgboss`
  schema in one process is a boot race on a fresh volume, invisible in dev and ugly exactly once,
  on a self-hoster's first `docker compose up`.
- **The invite email wired through the new seam**, closing `invitations`' unmet scenario.
- **`user_preference.email_notifications`** (`all | assigned_only | none`, default
  `assigned_only`): email for things *addressed at a person* — assignment now, mention once
  `mentions` lands — everything else in-app only.
- **Web**: an `/inbox` route (workspace-wide, matching the cross-team `issues.mine` precedent)
  with `j`/`k`/arrows, Enter/→ to open-and-mark-read, `e` to toggle read; an unread badge in
  `AppShell` reading the **same** `useQuery` as the inbox (Zero dedupes active queries); palette
  action rows; an email-notifications control beside the existing theme preference.
- **`PUBLIC_URL`**, required when an email transport is configured (an email full of `localhost`
  links is a silent, embarrassing failure no test catches), and the existing `WEB_ORIGIN`
  default-vs-example disagreement documented and reconciled.

## Capabilities

### New Capabilities

- `notifications`: the per-recipient `notification` entity and its natural-key identity; the
  server-authoritative fan-out across four trigger sites and its idempotency guarantee; the
  `recordNotifications` write seam; the self-scoped inbox query with no admin bypass; read/unread
  mutators; the keyboard-first `/inbox` surface, unread badge and palette entries; the
  per-user email preference; batched, debounced, read-suppressed email delivery with a
  delivery-time membership re-check; retention; and what happens to a person's notifications when
  they leave a team or the workspace.
- `email-delivery`: the provider-neutral `Mailer` interface, its two implementations
  (`SmtpMailer` over `SMTP_URL`, `ResendMailer` over HTTPS), transport selection and precedence,
  react-email rendering shared by both transports, `PUBLIC_URL` deep links, and the rule that no
  transport configured means email is cleanly disabled — never a boot failure, never a crash on
  send, never a job that retries forever.

### Modified Capabilities

- `invitations`: email delivery becomes transport-neutral (SMTP **or** the HTTPS sender) and is
  actually implemented — the invite email now goes through the shared `Mailer`, so the existing
  "WHEN SMTP is configured … THEN the invite email is sent" scenario is satisfied for the first
  time instead of being aspirational.
- `local-first-sync`: `notification` replicates under a **self-scoped** query filtered on the
  verified `ctx.userID` with **no workspace-admin bypass**; it is the first synced table whose
  primary key is a compound natural key rather than a client-minted UUIDv7, and the first whose
  rows are written *only* by the server; the drift test covers the new table, its compound PK and
  the new `user_preference` column.
- `self-host-deploy`: configuration validation extends to the email transport
  (`SMTP_URL` / `RESEND_API_KEY` / `EMAIL_FROM` / `PUBLIC_URL`) and the notification crons;
  `PUBLIC_URL` is required **only** when a transport is configured, and no transport configured
  boots cleanly with email disabled. Still exactly three containers — a mailer is an outbound
  client, not a service.
- `command-palette`: the palette reaches the inbox and can mark everything read, by keyboard
  alone.
- `workspace-membership`: removing a member (or a member leaving) **deletes** every notification
  addressed to them, workspace-wide.
- `teams`: removing a team member (or a member leaving a team) **deletes** that person's
  notifications for that team's subjects, and leaves their notifications for other teams intact.

## Impact

- **Schema** (`packages/schema`): forward-only migration `0013_notifications` — the `notification`
  table with its four-column primary key and a partial unread index, plus
  `user_preference.email_notifications`; the hand-written Kysely `DB` interface and the
  hand-written Zero schema extended in lockstep; the drift test extended; `notifications.mine`;
  `notification.markRead`/`markAllRead`; the fan-out overrides on `issue.create`, `issue.assign`,
  `issue.routeIssue` and `comment.create`; membership-removal overrides on `member.remove` and
  `team.removeMember`; pure `notifications/recipients.ts` and `notifications/copy.ts`; a Kysely
  accessor `db/notification.ts` mirroring `db/cycle-digest.ts` that exports `recordNotifications`,
  re-exported from `@yapm/schema/server`.
- **Server** (`apps/server`): `src/mail/` — the `Mailer` interface, `SmtpMailer`, `ResendMailer`
  and the selection logic; `startCycleScheduler` → `startScheduler` with `cycles?:` and
  `notifications?:` blocks and the two new queues; the email sweep and retention jobs; the invite
  email wired through the seam; env additions.
- **Email** (`packages/email`, new): react-email templates and a `render()` that returns
  `{subject, html, text}`, with zero knowledge of any transport.
- **Web** (`apps/web`): `/inbox`, the `AppShell` unread badge, the palette action rows, and the
  email-notifications control in the preference surface. Tokenized, AA in all three presets,
  light and dark, fully keyboard-operable.
- **Dependencies**: `nodemailer` + `@types/nodemailer` (SMTP transport — MIT-0, **zero runtime
  dependencies**), `@react-email/components` + `@react-email/render`, and `react`/`react-dom`
  for `packages/email`. All added to the pnpm catalog and referenced as `catalog:` — never a
  direct version in a package.json. **No SDK for Resend**: one authenticated JSON POST via
  `fetch`; a dependency not added is a dependency not maintained.
- **Docs**: a user-facing **Notifications** page
  (`apps/docs/src/content/docs/features/notifications.md`) and a self-hoster **Email delivery**
  page (`apps/docs/src/content/docs/self-hosting/email.md`), both added to the Starlight sidebar;
  `pnpm --filter @yapm/docs build` passes. Root docs updated: `README.md` (status + feature list),
  `ROADMAP.md` (change row), `TECHSTACK.md` (the Email row, the `react-email 1.x` version-baseline
  error, and `nodemailer` in the baseline), `.env.example` (the new variables and the `WEB_ORIGIN`
  clarification), and `openspec/SCOPE-v1-gaps.md` is left as-is (it is a scoping record, not a
  live doc). Behavior is specified in `openspec/specs/notifications` and
  `openspec/specs/email-delivery`.

## Non-goals

- **Mentions.** The next change. This one guarantees only the seam (`recordNotifications`, an
  unconstrained `kind`) and builds **no** mention support.
- **Comment-body excerpts** in the inbox row or the email. Cut deliberately: it removes a content
  leak at send time — issue text in an email escapes the permission boundary minutes after the
  write, when membership may have changed — and it drops a dependency on a rich-text-to-plaintext
  walker that the later `mentions` change owns.
- **Any team broadcast**: triage routing into your team, cycle rollover, cycle closed, retro
  opened. Each multiplies fan-out by team size for signal the triage inbox / cycles view / retros
  list already carries.
- **Status-change notifications.** Every board drag would notify; that is how inboxes get muted.
- **Connector-derived notifications** (your PR merged, CI failed) — Phase 2, different write path
  (`applyWorkGraphMutation`).
- **Anything aggregatable into a per-person scorecard**: no per-person activity table, no
  read-receipt signal, no "who reads their notifications", no count or view of notifications
  across people, no surface visible to anyone but the recipient. A per-user inbox is routing, not
  surveillance, and this change must not drift into becoming the latter.
- **Archive, snooze, threading, per-kind/per-project subscriptions, "subscribe to this issue"** —
  read/unread and retention only.
- **Signed unsubscribe links or `List-Unsubscribe` headers** — the email links to the in-app
  preference page. Web push, desktop notifications, Slack/webhook delivery, and notifications in
  the public REST API are all out.
- **Merging the two existing pg-boss instances.** The rule here is only "do not add a third".
- **An email SDK.** `fetch` serves the one HTTPS request Resend needs.
