# v1 gap scoping — notifications, mentions, search

Scoped 2026-07-26. Three surfaces the locked v1 scope names but never built: `notifications`
(ROADMAP "opinionated defaults: notifications = in-app inbox + email for mentions/assignments"),
`mentions` (same line), and `search` (ROADMAP "Surfaces: … search/filtering").

This document is the **mission input for three build flows**. It is not an OpenSpec proposal —
proposals are written just-in-time by the build flow (ROADMAP §"Change sequence"). It exists so
each proposal is cheap to write and correct on the first pass, and so three changes that were
scoped blind to each other do not ship two designs for the same seam.

Read this **with** the change's own `design.md`, not instead of it. Where this document contradicts
the original independent scope it supersedes it, and the reason is given.

---

## 0. Sequence, and why

**`notifications` → `mentions` → `search`.** Strictly ordered; each depends on the one before it in
substance, not just in convenience.

**`notifications` first** because it owns three things the other two consume and neither should
invent: the `notification` table, the server-write seam (`recordNotifications`), and the mailer.
It is also the only one of the three that pays down existing debt — `SMTP_URL` has shipped in
`apps/server/src/config/env.ts:98` and `.env.example:89` since `workspace-auth` with **zero
consumers**, and `openspec/specs/invitations/spec.md` carries a scenario ("WHEN SMTP is configured
and an admin creates an email invite THEN the invite email is sent") that is currently unmet
because nothing in the repo can send mail. Building the mailer for notifications closes that
scenario as a side effect. Highest debt-per-line of the three.

**`mentions` second, and only second.** Its entire value proposition is "a new `kind` through an
existing seam, plus a TipTap extension". Built before `notifications` it has to invent a write path
that then gets reconciled; built after, the *mention* half ships with no migration at all —
verified: `issue.description` is `json().optional()` and `comment.body` is `json()`
(`packages/schema/src/zero/schema.ts:104`, `:175`), so a mention is a node inside a document that
already syncs under the existing `teamScoped` predicate.

> **SUPERSEDED, 2026-07-25 — the maintainer answered H7 (§6) "yes".** A mention **auto-subscribes**
> the mentioned person to the issue's later activity, and that cannot be derived from `notification`
> rows: they carry `NOTIFICATION_RETENTION_DAYS` (30) retention, so a derived subscription would
> expire silently. `mentions` therefore ships a durable `issue_subscription` table, a forward-only
> migration, a Zero schema change and a sticky unfollow. The "cheapest big feature in the backlog"
> conclusion no longer holds; the *ordering* argument does, and is unaffected. Re-derived from
> scratch in `openspec/changes/archive/2026-08-04-mentions/design.md`.

**`search` last**, for two reasons that are not "it is the biggest".

1. Its plaintext extractor must be mention-aware. A mention node is a person's name embedded in
   `issue.description` / `comment.body`. If `search` lands first, its walker silently drops mention
   nodes and `mentions` has to change already-shipped ranking behaviour to fix it. Landing after,
   it is written correct once.
2. `search` is the only one whose central design risk — write amplification on the issue-write path
   versus index staleness, and whether zero-cache replicates cleanly past a table carrying a large
   GIN expression index — **cannot be measured until it exists**. Putting it last means the two
   changes that must not be blocked on a measurement are not.

Rejected alternative: `search` first, on the grounds that it is the most-used feature and the
palette work is independent. Rejected because of (1) — the cost lands as a behavioural change to
shipped code rather than as an ordering choice.

Migration numbers are assigned here so two flows do not both claim the same number:
**`0013_notifications`**, **`0014_mentions`**, **`0015_search`**.

> **Renumbered, 2026-07-25.** This originally read "`0014_search`; `mentions` ships no migration".
> The H7 answer gave `mentions` a migration, and it built first, so it took `0014` and `search`
> moves to `0015`. Two changes claiming `0014` is a collision at boot, which is why the number
> lives here rather than in either change.

---

## 1. Overlaps resolved

Three scopers worked blind to each other. Every seam found, and who owns it.

### 1.1 The notification write seam — `notifications` owns it, `mentions` consumes it

`notifications` proposed an internal `NOTIFICATION_TRIGGERS` map; `mentions` assumed an exported
`recordNotifications(db, events)`. These are the same thing at different altitudes and shipping both
means two write paths.

**Resolution.** `notifications` ships **both**, with a clear public/private line:

- **Public, exported from `@yapm/schema/server`:** `recordNotifications(db: Kysely<DB>, events:
  NotificationEvent[]): Promise<void>` — one multi-row `insert … on conflict do nothing` inside the
  caller's transaction. This is the contract `mentions` binds to. It must exist and be exported in
  the `notifications` change even though `notifications` is its only caller at that point.
- **Private to `notifications`:** the `NOTIFICATION_TRIGGERS` kind → `{recipients, copy}` map, which
  is how `notifications` computes its own two kinds' events. `mentions` does **not** register in
  this map — its recipient computation is a doc diff, not a subject-involvement rule, and forcing it
  through the map buys nothing.

**Consequence that must not be dropped:** `notification.kind` gets **no Postgres CHECK constraint**.
This is a deliberate deviation from the house style — `0012_retro.ts` uses CHECK constraints for
every other enum-shaped column, and a reviewer will flag its absence. Write the reason in
`design.md`: adding the `'mention'` kind must cost a TypeScript union member and a copy string, not
a forward-only migration in a different change. `kind` is validated as a TS union in `context.ts`.

### 1.2 Plaintext extraction — `search` owns it, `mentions` extends it, `notifications` needs none

All three scopes wanted a TipTap-JSON → plaintext walker, and two of them proposed shipping it.

**Resolution, and a scope cut to `notifications`.** `notifications` does **not** carry comment-body
excerpts — not in the inbox row, not in the email. A notification reads "Dana commented on ENG-42",
full stop. This removes the walker from `notifications` entirely, and it removes a real hazard:
issue content in an email is content that escapes the permission boundary at *send* time, minutes
after the write, when membership may have changed. Cutting excerpts is a simplification and a
security improvement in the same stroke.

The walker therefore lands in **`search`**, as `packages/schema/src/rich-text/plaintext.ts` —
pure recursion over the doc JSON, **no TipTap import**, so the "`packages/schema` has zero UI
dependencies" boundary (`scripts/check-boundaries.mjs`) holds.

Because `mentions` lands *before* `search`, `mentions` ships this file first — with only the mention
branch it needs (`{type:'mention'}` → `@` + resolved name) plus the plain-text node walk. `search`
then extends the same file for its own needs. One file, one owner at a time, no retrofit.
`mentions` also ships `extractMentionIds(doc): string[]` beside it.

> **Shipped in change 12.** `packages/schema/src/rich-text/plaintext.ts` exports
> `richTextToPlainText(doc, options?)`, `extractMentionIds(doc)` and `sanitizeRichText(doc)`, with
> unit tests over nested lists, blockquotes, duplicate and malformed mentions. It imports nothing.
> `richTextToPlainText` takes a `mentions: 'label' | 'strip'` mode — see §1.9 for why `'strip'` is
> mandatory on any model-facing path. `search` extends this file rather than adding a second one.

### 1.3 The command palette — `search` owns results, `notifications` owns actions

`command.tsx:472` currently has a **"Jump to issue"** group: a title-only match over already-synced
issues. `search`'s scope proposed adding "Results" and "From the server" groups without noticing it.

**Resolution.** `search` **replaces** the "Jump to issue" group; it does not sit beside it. Two
title-only matchers in one palette is two mental models for one question. This is a rename-and-
extend of existing code, not a new surface.

`notifications` adds only **action rows** ("Go to inbox", "Mark all notifications as read") in the
existing root/Navigate groups. No conflict — but stated here so the `search` implementer does not
find a "Jump to issue" group that `notifications` left untouched and assume it is load-bearing.

`search`'s local pass must reuse and extend `filter.ts`'s `matchesText` semantics
(`packages/schema/src/zero/filter.ts:71` — currently title + issue key, substring, lowercased) rather
than forking them, so the list's text filter and the palette agree about what "matches" means.

### 1.4 pg-boss instance count — amended for all three, uniformly

`notifications` proposed "a third independently-gated `PgBoss({db: fromKysely(db), schema:
'pgboss'})`, precedent: the GitHub service and the cycle scheduler each already own one".
`search` proposed a `search-index` queue plus folding its reconcile sweep into the existing
cycle-maintenance cron — the right instinct, applied inconsistently between the two.

**Amendment (this overrides `notifications`' scope).** No third `PgBoss` instance. Three
`boss.start()` calls against the same `pgboss` schema in the same process are three connection-pool
consumers and three concurrent schema installs on a fresh volume — a boot race that is invisible in
dev and ugly exactly once, on a self-hoster's first `docker compose up`.

`notifications` instead **extends the existing scheduler** (`apps/server/src/jobs/scheduler.ts`)
from `startCycleScheduler` into a `startScheduler` taking optional feature blocks — the same shape
the `digest?: DigestSchedulerOptions` block already uses (`scheduler.ts:37`). Its two queues
(`notification-email`, `notification-retention`) register there, independently gated. `search`
registers `search-index` the same way.

This is **not** the drive-by refactor `notifications` correctly ruled out. That was "merge the two
existing instances". This is "do not add a third", which is a smaller and more defensible change,
and it makes `search`'s already-correct instinct the uniform rule.

### 1.5 `team_id` denormalisation invariant — one invariant, `notifications` writes it down

`notification.team_id` and `search_document.team_id` are both denormalised copies of the owning
issue's team, and both are only sound because **an issue can never change team**. Verified:
`routeIssue` refuses it explicitly (the doc comment on `export const routeIssue` in
`packages/schema/src/zero/mutators.ts` — "Team
reassignment is deliberately not routable (it collides with the per-team number and the team-scoped
sync scope)").

**Resolution.** `notifications`, as the first to land, owns the guard: a comment on the column and
an integration test asserting no mutator mutates `issue.team_id`. `search` cites it rather than
duplicating it. If a future change makes issues movable, that change must move every derived row —
notification rows and every one of the issue's comments' documents — or it silently leaks to the old
team.

### 1.6 `issue.routeIssue` — resolved, no longer an open question

`notifications` listed as open: "does `routeIssue` fire an assignment notification, and is its
assignee path shared with `issue.assign` or duplicated?"

**Answered by reading the code: it is duplicated.** `routeIssueArgs` carries its own `assigneeId`
and `export const routeIssue` sets it directly, independent of `assignIssue` — all three in
`packages/schema/src/zero/mutators.ts`. So `notifications` has more fan-out sites than the three it
first named, with `routeIssue`'s assignee path routed through the same `issue_assigned` trigger
entry. In scope, not an open question. The authoritative site list is the D5 trigger table in
`openspec/changes/archive/2026-07-26-notifications/design.md` — it is the one place that counts them.

### 1.7 Delivery-time membership re-check — `notifications` owns it, and it changes its own answer

`mentions` specified "a second eligibility check at delivery time in the notifications email job —
membership can change between the write and the send". Correct, and it can only be honest if the
sweep joins current membership. **`notifications`' sweep must therefore join current team membership
for every team-scoped kind from day one**, not just for mentions.

This has a consequence `notifications` did not see: with a delivery-time membership join, the
"denormalised issue title outliving the membership that authorised it" leak is closed *for email*
regardless of what happens to the stored row. That **downgrades `notifications`' human question #3**
(delete vs. retain on membership removal) from a security trade to a data-retention preference, and
makes **retain-but-redact** (blank `subject_title`, keep the row) the clearly better option —
non-destructive, and the leak is already closed. Still a human call; see §6.

### 1.8 Preferences — `notifications` owns the one column; `mentions` adds none

`user_preference` gains exactly one column, `email_notifications`, owned by `notifications`.
`mentions` must not add a per-mention preference and must not add "subscribe to this issue".
`search` adds none.

### 1.9 The AI-substrate contamination check — `mentions` owns it, as a pre-flight, not a risk

`mentions` flagged this as a risk. It is stronger than that: `mentions` **creates** the hazard, so it
owns a blocking verification before it writes a line.

The `ai` change's safety property is that the narrowed team-scoped query structurally cannot name a
person. Mention nodes put person names inside `issue.description` and `comment.body`. **Pre-flight:
verify `packages/schema/src/zero/digest.ts`, `ai-tools.ts`, and `cycle-facts.ts` never read those
two fields.** If any does, that is a blocker to be resolved in the `mentions` change, not a note.
Either way `mentions` writes the rule down: any future feature that feeds description or comment
text to a model must strip mention nodes first.

This also constrains `search`: `search_document.body` contains those same names. `search` must never
be a data source for an AI path.

> **Run, and clean, 2026-07-25 (change 12).** `packages/schema/src/zero/{digest,cycle-facts,
> ai-tools}.ts` and `packages/schema/src/db/cycle-facts.ts` read **neither** `issue.description` nor
> `comment.body`. The only hits in `apps/server/src/ai/*` are an HTTP request `body` and the word
> "description" inside a tool-description string handed to the model — neither is a document read.
> No blocker; the hazard is created and the rule now ships with it.
>
> **The rule, in its enforceable form.** `packages/schema/src/rich-text/plaintext.ts` exposes
> `richTextToPlainText(doc, { mentions: 'strip' })`. **Any caller that feeds document text to a
> language model MUST use `'strip'`** — the default `'label'` mode resolves names and would put a
> colleague inside the model's context. Carried as a comment on the option, as a scenario in the
> `mentions` capability spec ("Model-facing reads must strip mention nodes"), and inherited by
> `search` and by every later AI change.

### 1.10 Not overlaps, checked and cleared

No duplicated tables. No two designs for one read path. No contradictory permission story —
`notifications` and `search` both scope by team membership with the admin bypass mirroring
`teamScoped`, except `notifications.mine`, which deliberately has **no** admin bypass (§2.1). Both
palette-touching changes touch disjoint groups. `mentions`' popup and `search`'s popup both add
`[role="listbox"]`, which `POPUP_SELECTOR` (`apps/web/src/lib/keyboard.ts:17`) already recognises.

---

## 2. Per-change scope

### 2.1 `notifications`

**One-line thesis.** Per-recipient notifications for assignment and comments, fanned out **only in
the authoritative server mutator pass**, read from a self-scoped keyboard-first inbox, and delivered
as one batched email per recipient via pg-boss — cleanly disabled when SMTP is unset.

**Depends on:** `issue-core`, `workspace-auth`, `design-system`, `triage`.
**Big-feature rule:** yes — synced entity + mutator + permission surface + signature UI. All three
test tiers.

#### In scope

- **Migration `0013_notifications`**: the `notification` table (§3.1) and a
  `user_preference.email_notifications` column (`'all' | 'assigned_only' | 'none'`, default per §6).
- **Zero schema**: the `notification` table plus an `actor` → `user` relationship. `kind` is a TS
  union in `context.ts` with **no Postgres CHECK constraint** (§1.1). Drift-test map updated.
- **`queries.notifications.mine`**: self-scoped on the verified `ctx.userID`, **no workspace-admin
  bypass**, denied by empty query for a non-member, `.limit(100)` ordered `createdAt desc`.
- **Two kinds**: `issue_assigned` (from `issue.assign`, `issue.create` carrying an assignee, and
  `issue.routeIssue` setting one — §1.6) and `issue_commented` (from `comment.create`). Comment
  recipients = assignee ∪ creator ∪ prior commenters, deduped, minus the actor, **capped**. The
  recipient computation is a pure exported function with unit tests.
- **Fan-out** in `createServerMutators()` overrides, behind `if (tx.location !== 'server') return`,
  writing through `serverDb(tx)` via `recordNotifications` (§1.1) in the mutation's own transaction.
- **Shared client mutators** `notification.markRead` / `markAllRead`, self-scoped (a caller may only
  touch rows whose recipient is their own `ctx.userID`), optimistic and instant. `markAllRead` gets a
  server override doing one raw `update … where recipient_id = $1 and read_at is null` —
  `reference/zero.md` §5.8 is verbatim this example — because the client pass only sees rows its
  active query synced.
- **`apps/server/src/mail/`**: a nodemailer transport over `SMTP_URL`, constructed as `null` when
  unset. **This is a shared module, not a notifications-private one** — it also wires the existing
  unmet invite-email scenario (§0), which this change closes.
- **Two cron queues on the existing scheduler** (§1.4): `notification-email` (sweep unread,
  unemailed, past the debounce, younger than 24h; **join current team membership** per §1.7; join
  `user_preference` for mode and `user` for address; group per recipient; one digest message; stamp
  `email_sent_at`) and `notification-retention` (delete past `NOTIFICATION_RETENTION_DAYS`, running
  whether or not a mailer exists).
- **Web**: an `/inbox` route (workspace-wide, matching the cross-team `issues.mine` precedent) with
  `j`/`k`/arrows, Enter/→ to open and mark read, `e` to toggle read; an unread badge in `AppShell`
  with an accessible name ("Inbox, 3 unread"; "99+" past the query limit); palette entries; an
  email-notifications control beside the existing theme preference. Tokenized, AA in all three
  presets, light and dark.
- **`team.removeMember` handling** per §1.7 — retain-but-redact recommended, pending §6.
- **Guard test** for the no-team-reassignment invariant (§1.5).
- **Docs**: `apps/docs/src/content/docs/features/notifications.md`, a `self-hosting/email.md`;
  `.env.example`, README, ROADMAP, TECHSTACK (its Email row names react-email — see §6) updated in
  the same change.

#### Non-goals

Mentions (next change; this one guarantees only the seam). **Any team broadcast** — triage routing
into your team, cycle rollover, cycle closed, retro opened; each multiplies fan-out by team size for
signal the triage inbox / cycles view / retros list already carries. Connector-derived notifications
(your PR merged, CI failed) — Phase 2, different write path (`applyWorkGraphMutation`).
Status-change notifications — every board drag would notify, which is how inboxes get muted.
**Comment-body excerpts in the row or the email** (§1.2). Archive/snooze/threading; read-unread and
retention only. Per-kind or per-project subscriptions, and "subscribe to this issue". Signed
unsubscribe links / list-unsubscribe headers — the email links to the in-app preference page.
Web push, desktop notifications, Slack/webhook delivery, notifications in the public REST API.
Merging the two existing pg-boss instances (§1.4 requires only "do not add a third"). Any count or
view of notifications aggregated across people, or visible to anyone but the recipient.

#### Schema

One new synced table, one new column, **no server-only table**.

**`notification`** — see §3.1 for the identity decision, which is the one thing to get right.
Columns: `recipient_id`, `actor_id`, `kind` (text, unconstrained), `team_id`, `subject_type`
(`'issue'`), `subject_id`, `subject_key` (`'ENG-42'`), `subject_title`, `event_key`, `read_at`,
`email_sent_at`, `created_at`. Partial index on `(recipient_id, created_at desc) where read_at is
null`.

It syncs because the inbox must be instant and offline-readable — but only ever to its recipient.
`team_id` is not a sync scope here; it exists for the membership cleanup and for indexing.

`subject_key` and `subject_title` are **denormalised snapshots, not joins**. Joining the issue
through a relationship off a self-scoped query would need `.related('issue', i => teamScoped(i,
ctx))` to avoid widening reads past the team boundary (the trap `projects.all` already handles at
`queries.ts:150`), and a notification whose issue fell out of scope would then render blank. A
snapshot renders in one query with no permission subtlety; the cost is that a renamed issue shows
its old title, which is correct for a log of what happened. **Say this in the feature docs** — it
will otherwise be reported as a bug.

`email_sent_at` lives on the synced row rather than a server-only `notification_delivery` table.
That alternative was considered and rejected: it buys a non-syncing `last_error`/`attempts` at the
cost of a table, a drift-map entry, a join in the sweep, and a second lifecycle. pg-boss already
owns retry and the sweep bounds itself with `created_at > now() - 24h`. The churn is one row-update
to one client — the recipient's own.

**`user_preference.email_notifications`** reuses the existing per-user synced entity rather than
adding a preferences table; `preference.set` (`mutators.ts:485-505`) grows one optional arg.

**Server-only:** nothing new. The sweep reads `user.email` (better-auth's table, already in the read
surface) at send time; no email address is ever copied onto a notification row.

#### Architecture

**Three containers unchanged.** The mailer is an outbound SMTP client inside `app`, not a service;
the sweep is pg-boss on the existing Postgres.

**Where the ZQL lives.** `packages/schema/src/zero/`: the table in `schema.ts`,
`notifications.mine` in `queries.ts`, `notification.markRead`/`markAllRead` in `mutators.ts`, the
fan-out overrides in `server-mutators.ts`, plus pure `notifications/recipients.ts` and
`notifications/copy.ts`. A Kysely accessor `db/notification.ts` mirrors `db/cycle-digest.ts` for
the sweep's reads and the `email_sent_at` stamp, and exports `recordNotifications` (§1.1).
`apps/server` imports; nothing in `packages/schema` imports an app.

**The fan-out — the crux.** It runs **only** in the server-authoritative pass, guarded by
`if (tx.location !== 'server') return` — exactly the pattern already carrying `issue.create`'s
per-team number (`server-mutators.ts:159-164`) and `retroVote.cast`'s tally (`:242-259`), and
exactly what zbugs does for its own notifications (`reference/zero.md` §5.7). Three properties make
it safe:

1. *The client never runs it.* Client mutators re-run up to twice during rebase; the guard puts the
   fan-out outside that path. There is no optimistic notification to corrupt — the recipient is a
   different client, and the actor has no use for a notification about their own action.
2. *The server runs it exactly once, atomically.* `handleMutateRequest` applies each mutation ID
   once (lastMutationID is persisted in the same transaction, so a retried push is a no-op), and the
   inserts go through `serverDb(tx)` — the same wrapped Kysely transaction — so the notification
   rows and the change that caused them commit or roll back together.
3. *It is idempotent anyway.* Every input is deterministic in the mutation's args, all minted at the
   call site: `event_key` is the comment id for `issue_commented` and `String(args.updatedAt)` for
   `issue_assigned`. Any re-run is `on conflict do nothing`. **This is what makes the design provable
   rather than merely argued**, and it is what §3.1 turns into the row's identity.

**Sub-100ms.** The actor's interaction is the optimistic client mutation, untouched. The extra work
— one bounded ZQL read of the issue's commenters plus one multi-row insert — happens on the
authoritative pass, which the UI never waits on. The recipient's inbox arrives a sync tick later.
Marking read is a local optimistic write.

**Email disabled cleanly.** `SMTP_URL` unset → `createMailer()` returns `null` → send is a no-op and
boot logs once that email is disabled; retention still runs. `SMTP_URL` present but malformed → Zod
rejects at startup naming the variable (absent means disabled; invalid means say so). A transport
error is caught inside the job, logged with the recipient count, rows left unstamped for the next
window; the worker never throws and never disturbs the cycle or connector jobs sharing the process.

**Not surveillance — say it in the proposal**, because the constraint is adjacent and a reviewer
will ask. A notification is addressed to exactly one person and readable by exactly that person; the
query has **no admin bypass**, so not even a workspace admin can read someone's inbox. It aggregates
nothing, ranks nobody, exposes no read receipts, and produces no per-person view. "Team-level
metrics only" forbids scorecards, not routing; this is routing. Viewers are notified and emailed
like anyone else — no role gate, no seat gate.

**AppShell badge — resolved, not open.** `notifications.mine` is the same query the inbox uses;
Zero dedupes active queries, so mounting it in `AppShell` costs one bounded subscription per client,
not one per route. Approved — with the requirement that badge and inbox read from **one**
`useQuery`.

#### The falsifiable check

**Primary — integration against live Postgres**
(`packages/schema/src/zero/mutators.notification.pg.test.ts`, gated by
`describe.skipIf(DATABASE_URL === undefined)` like the other `.pg.test.ts` files).

Seed a workspace with team T, admin A, members B and C (B and C in T). Run
`createServerMutators().issue.assign.fn({tx, args: {id: I, assigneeId: B, updatedAt: 1000}, ctx: A})`
**twice with identical args**, then assert:

1. `queries.notifications.mine` with `ctx = B` returns **exactly one** row — `kind:
   'issue_assigned'`, `subjectId: I`, `readAt: null`, `actorId: A`. Twice-run yields one row,
   proving natural-key idempotency.
2. The same query with `ctx = C` returns **zero** rows.
3. The same query with `ctx = A`, a workspace **admin**, returns **zero** rows — the
   no-admin-bypass deviation, which is the one assertion a copy-paste of `teamScoped` breaks
   silently.
4. Running the same mutator with a **client-location** transaction writes **zero** notification
   rows — the rebase path can neither duplicate nor fabricate.
5. `notification.markAllRead` as B stamps every unread row of B's and none of anyone else's.

On current `main` this does not compile: there is no `notification` table, no
`queries.notifications`, no fan-out. It passes only when the fan-out is in the authoritative pass,
the natural key is unique, and the query is self-scoped without an admin bypass.

**Supporting — E2E** (`apps/web/e2e/notifications.spec.ts`): two browser contexts, A and B. A
assigns an issue to B. With **no reload**, B's header badge reads "Inbox, 1 unread"; B reaches
`/inbox` by keyboard only (Cmd-K → "Go to inbox"), presses `j` then `Enter`, lands on the issue, and
the badge clears.

**Supporting — unit, no DB**: the recipient-set function excludes the actor, dedupes
assignee/creator/prior-commenters, and caps; `createMailer(undefined)` returns null and the sweep
with a null mailer completes without throwing and stamps nothing.

#### Risks

- **The fan-out lengthens every assign and comment transaction.** It runs inside the mutation's own
  Postgres transaction on the authoritative path, so a pathological issue — hundreds of distinct
  prior commenters — turns a one-row update into a long transaction holding locks. Mitigations must
  be *in* the change, not added later: cap the commenter query with a bounded `limit`, dedupe before
  insert, emit a **single** multi-row insert rather than N statements, and index the natural key so
  the conflict check is not a scan. Most likely to be invisible in dev and painful in production.
- **Email storms.** The failure mode is a self-hoster's relay blacklisting them. Four independent
  defences: the unique natural key, the debounce window, per-recipient batching, and **never
  emailing a notification already read in-app**. The `read_at is null` predicate is the single most
  effective piece of noise suppression in the design. If any one defence is dropped during
  implementation as "an optimisation", the risk returns.
- **Email configuration taking the app down.** "Absent means cleanly disabled" is the easy half.
  "Present but broken means degraded, never down" is the half that gets missed: no unhandled
  rejection, no crashed scheduler, no effect on the cycle or connector jobs sharing the process.
- **Sync volume.** A monotonically growing per-user synced table is a hydration cost on every client
  forever. The `.limit(100)` and the retention sweep are load-bearing, not hygiene.
- **Permission copy-paste.** `notifications.mine` must be the `retroDrafts.mine` shape
  (`queries.ts:238-249` — bare ctx filter, no admin bypass), not `teamScoped`, which grants
  workspace admins everything (`queries.ts:21`). Right for work data, catastrophic for an inbox.
  Check 3 exists precisely because this is a one-line mistake no ordinary test catches.
- **Scope creep into broadcasts.** "While we're here, notify the team when a retro opens" is one line
  and a permanent doubling of the fan-out surface. The non-goals make it a conversation, not a commit.
- **Stale title snapshots read as a bug.** Correct behaviour; document it.

#### Open questions

- **Debounce window and cron interval.** A 2-minute debounce on a `*/2 * * * *` sweep gives ~4 min
  worst case from assignment to email. Longer batches better and feels less responsive. Intuition,
  not data — and the right answer may be "longer than you think", given the read-first-in-app
  suppression already removes most of the noise.
- **Retention default.** 30 days keeps the synced set small; 90 makes the inbox a usable record.
  Interacts with `.limit(100)`: if the limit is what actually bounds hydration, retention can be
  generous. Recommendation: retention is the primary bound, the limit is the safety net.
- **`isMember` or `isAuthenticated` on `notifications.mine`?** `isMember` proposed, matching
  `issues.mine`. A user demoted out of membership then loses their inbox outright rather than
  watching it drain — probably fine, possibly surprising.

---

### 2.2 `mentions`

**One-line thesis.** `@`-mention teammates inside TipTap descriptions and comments — a keyboard-first
typeahead over **already-synced** users (zero network), stored as an id reference that survives
renames, with "can this person read this issue?" enforced server-side before any mention event
reaches the inbox.

**Depends on:** `notifications` (hard — the `recordNotifications` seam and the unconstrained `kind`).
**Big-feature rule:** yes — mutator + permission surface + signature UI. All three tiers.

#### Pre-flight, before writing a line

1. Read `notifications`' shipped `design.md` and confirm `recordNotifications` exists with the
   signature in §1.1 and that `kind` carries no CHECK constraint. If either is absent, fix it *in
   `notifications`' spec* rather than inventing a second write path here.
2. Run the AI-substrate contamination check in §1.9. Blocking.

#### In scope

- Add `@tiptap/extension-mention` and `@tiptap/suggestion` at **exactly 3.28.0** to the pnpm catalog
  (both peer-require `@tiptap/core`/`@tiptap/pm` at the same exact pin — the catalog already carries
  `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit` at `^3.28.0`) and to `packages/ui`.
- Register the `mention` node in `richTextExtensions`
  (`packages/ui/src/components/rich-text.tsx:26`) so **both** `RichTextEditor` and
  `RichTextRenderer` parse and render it — a doc round-tripping through the read-only renderer must
  not lose or mangle mention nodes.
- A bespoke `MentionList` in `packages/ui` — **not cmdk**, whose `Command.Input` steals focus, and
  focus must stay in the editor. Rendered via `ReactRenderer`, mounted with suggestion 3.28's managed
  `props.mount(element)` and `container` set to the editor wrapper so Floating UI anchors it **and**
  `aria-activedescendant` has a valid same-subtree IDREF.
- **Keyboard contract**: ↑/↓ move, Home/End jump, Enter and Tab select, Escape closes **only** the
  popup. Concretely — `RichTextEditor`'s wrapper `onKeyDown` (`rich-text.tsx:120-129`) currently
  fires `onCancel` on Escape and `onSubmit` on Cmd/Ctrl+Enter **unconditionally**. Without a guard,
  Escape inside an open mention popup destroys the comment draft and closes the detail Sheet.
  **Verified against the current file; this is a real collision, not a hypothetical.**
  > **The prescribed fix was wrong — corrected during the build, see
  > `openspec/changes/archive/2026-08-04-mentions/design.md` I26/I27.** This said "skip both branches when
  > `event.defaultPrevented` is set". `prosemirror-view@1.42`'s `captureKeyDown` returns true for
  > keyCode 13 and 27 **unconditionally**, so that flag is set on every Enter and every Escape
  > inside any editor and the guard is *always* taken — silently disabling `onCancel` and
  > `onSubmit` on every rich-text surface in the app. What shipped answers "did an inner surface
  > act on this key?" by **native-event identity**, and also calls `stopPropagation()`, because
  > Base UI's `useDismiss` checks neither `defaultPrevented` nor the event's origin.
- **ARIA**: editor gets `aria-expanded`/`aria-controls`/`aria-activedescendant`; popup is
  `role="listbox"` with `role="option"` children; a polite live region announces match count and the
  empty state. Tokenized, AA in all three presets, light and dark.
- **Client candidate source**: a pure synchronous filter over rows Zero has already synced —
  `queries.users.all` (`queries.ts:53`) ∩ `queries.teams.all().related('members')` (`:59`) for the
  issue's team, ∪ workspace admins from `queries.members.all` (`:47`). No fetch, no `items()`
  promise. This is the whole sub-100ms story.
- A deterministic, unit-tested matcher in `packages/ui`: case- and diacritic-insensitive
  prefix-then-substring over display name and email local-part, **team members ranked above
  admins-by-role**, stable tiebreak by name (§1 amendment, below).
- Suggestion config avoiding false triggers: `allowedPrefixes` so `foo@bar.com` never opens the
  popup, and an `allow` predicate rejecting `codeBlock`/inline `code`.
- **Storage**: the TipTap node's own JSON, `{type:'mention', attrs:{id, label,
  mentionSuggestionChar}}`, inside the existing `issue.description` / `comment.body` jsonb. `id` is
  authoritative; `label` is a fallback only. Rendering **always** resolves the name from the live
  synced `user` row by id, so a rename propagates and a hand-crafted `label` cannot spoof.
- A **sanitizer in the shared mutator path** (`issue.create`/`issue.update`/`comment.create`/
  `comment.edit`): mention nodes normalised to `{id, label}` with `id` a non-empty string, unknown
  attrs dropped, `label` length-capped. Shared, so client and server agree.
- `packages/schema/src/rich-text/plaintext.ts` (§1.2) with `richTextToPlainText` and
  `extractMentionIds` — pure JSON recursion, **no TipTap import**.
- **The permission answer, server-side and authoritative**: `canUserReadIssue(db, userId, issueId)`
  in `@yapm/schema/server` mirroring `teamScoped` exactly — workspace admin **or** member of the
  issue's team, checked in that order, auth before existence, denying by returning false, never by
  leaking a 404-vs-403 distinction. A mention of anyone failing it produces **no** event, no email,
  no inbox row.
- Server-mutator overrides on the four write sites that (a) run only under `tx.location ===
  'server'`, (b) **diff previous mention ids against next** so an edit notifies only newly-added
  mentions, (c) drop self-mentions, (d) filter through `canUserReadIssue`, (e) hand survivors to
  `recordNotifications` in the same Kysely transaction.
- **Rendering of an ineligible or unresolvable mention**: plain, unlinked `@Name` text, no chip
  styling, no notification. This is the paste / stale-membership path and it must be visibly inert
  rather than silently broken.
- Docs: a users-facing mentions page, plus updates to the notification/permission pages
  `notifications` created.

#### Amendments to the original `mentions` scope

- **Eligibility vs candidacy, split.** The original said workspace admins appear in every team's
  mention list because they genuinely can read the issue. Keep that as the *server-side eligibility*
  rule — it is a permission fact and must not be softened. But **candidacy** (what the typeahead
  offers) is team members only by default; an admin surfaces only when the typed query matches their
  name or email prefix, ranked last. This separates a permission question from a UI question and
  defuses the surveillance-adjacency without lying about who can read.
- **The "3 more in this workspace aren't on this team" footer** is allowed **only** because
  `queries.users.all` already syncs the entire `user` table to every workspace member
  (`queries.ts:53-58`), so it reveals nothing new. It must not name anyone, and it must not render
  for a non-member. If it drifts toward naming people it becomes a membership oracle and must be cut.
- **No `richTextToPlainText` ownership dispute** — `mentions` ships it (§1.2), `search` extends it.
  The original scope's open question is closed.
- **The email-template question is moot**: `notifications` carries no comment-body excerpt (§1.2), so
  there is no "render a mention as bold `@Name` in the email". Cut from scope.

#### Non-goals

No `#123` issue mentions or backlinks, no `@team`/`@here` group mentions, no label or project
triggers — the extension's `suggestions: []` array holds more trigger chars later, but exactly one
ships. No mentions in issue titles, retro cards, or project descriptions (plain-text `string()`
columns; a different change). No "invite/add this person to the team" from the popup — mentioning
someone never grants access. ~~No mention-based subscribe/follow.~~ (**Reversed by the H7 answer:**
auto-subscribe, a durable `issue_subscription` entity and a sticky unfollow are all in scope.)
**No `mention` table, no synced
mention edge, no "issues that mention me" filter** — the inbox is `notifications`' surface and
duplicating it creates a second source of truth for something derivable from the doc. No
autocomplete over deactivated accounts or bots. No hovercard, no user profile route. No
un-mention/retraction when a mention is deleted — sent is sent. No Yjs interaction.

#### Schema

> **SUPERSEDED by the H7 answer (§6).** The paragraph below is true of the *mention* itself and
> false of the change as built. Auto-subscribe added a durable `issue_subscription` table
> (composite primary key `(issue_id, user_id)`, no generated id), migration **`0014_mentions`**, a
> Zero schema change, a self-scoped `subscriptions.mine` query, and drift-test coverage. Everything
> the paragraph says about *the mention node* still holds.

**Zero new tables, zero new columns, no Zero schema change, no migration, and therefore no change
to the CI drift test.** Verified against `packages/schema/src/zero/schema.ts:104` and `:175`. What
syncs is exactly what syncs today: the doc, under `teamScoped`, so a mention is only readable by
someone who can already read the issue. Display names are not newly exposed — `queries.users.all`
already syncs the whole `user` table to every workspace member, which is precisely why the
autocomplete needs no network. The only persisted new row is a `notification`, owned by the previous
change. `canUserReadIssue` is a query over existing `team_membership` / `workspace_member`, exported
from `@yapm/schema/server` so kysely never reaches the client bundle.

#### Architecture

Three containers untouched — no new service, no new store, and critically **no network call on the
hot path**. `SuggestionOptions.items()` returns an array, never a promise, because it filters rows
Zero already replicated to IndexedDB. State that in the proposal as the reason mentions are cheap
here and expensive in a request/response tracker.

**Layering.** `packages/ui` owns the extension and the listbox and stays data-agnostic:
`RichTextEditor` gains a `mentionables: MentionCandidate[]` prop (`{id, name, email?, image?}`)
supplied by `apps/web/src/issues/issue-detail.tsx`, which already builds an equivalent member list
for the assignee menu. `packages/schema` owns the doc walkers as pure JSON recursion with no TipTap
import, preserving the boundary `scripts/check-boundaries.mjs` enforces.

All ZQL and all mutators stay in `packages/schema`. The sanitizer lives in the shared mutators.
Event production lives in `createServerMutators()` following the exact pattern `retro.setPhase`
already uses (`server-mutators.ts:178-191`): read `before`, call `mutators.X.fn(...)`, then
`if (tx.location !== 'server') return`, then the authoritative work over `serverDb(tx)`. The
`tx.location` guard is what makes rebase re-runs produce no duplicate notifications. **No IDs are
minted inside a mutator body** — `recordNotifications` owns identity (§3.1).

**Verified-against-source TipTap facts — do not write these from memory.** The node is
`name:'mention'`, `inline:true`, `atom:true`, `selectable:false`, attrs `{id, label,
mentionSuggestionChar}` mapping to `data-id`/`data-label`/`data-mention-suggestion-char`.
`renderLabel` is **deprecated** and logs a console warning — use `renderText` and `renderHTML`.
`MentionPluginKey` is documented in the JSDoc but is **not exported** by 3.28.0; supply your own
`new PluginKey('yapm-mention')`. `addProseMirrorPlugins` **always** instantiates at least one
Suggestion plugin (with `suggestions: []` it falls back to `[options.suggestion]`), so the read-only
`RichTextRenderer` gets one too — neutralise it with `allow: () => false` rather than expecting to
disable it. Suggestion 3.28 gained managed mounting (`props.mount(el)` returns an unmount to call in
`onExit`), `container`, `placement`, `flip`, `minQueryLength`, `debounce`, `initialItems`, `loading`
— use `mount` + `container`, not the legacy manual `clientRect`/tippy dance every pre-3.28 example
on the internet shows. **Re-verify against the installed `.d.ts` before use** per CLAUDE.md.

Mounting the popup into the editor wrapper via `container` (rather than a `document.body` portal)
puts a `[role="listbox"]` into `POPUP_SELECTOR`'s ancestor chain (`keyboard.ts:17`) and makes
`aria-activedescendant` legal; a body portal breaks both.

#### The falsifiable check

**Integration** (`packages/schema/src/zero/mutators.mentions.pg.test.ts`): team T with members A and
B, non-member C (a workspace `member` not on T), and workspace admin D. A creates a comment on an
issue in T whose body JSON contains mention nodes for B, C, D and A. Assert **exactly two**
notification rows — B and D — **none** for C (cannot read the issue), **none** for A (self-mention).
Then edit that comment adding a mention of B *again* plus one new mention: assert **exactly one** new
row, proving the previous-vs-next diff. Then re-run with `tx.location === 'client'`: assert zero rows.

On current `main` this fails at import — `extractMentionIds` does not exist and no code path
produces a notification from a document — and it fails for the right reason at every subsequent step.

**E2E** (`apps/web/e2e/mentions.spec.ts`): in the issue-detail comment box, type `@`, assert the
listbox appears with `aria-activedescendant` set, press ↓ then Enter, assert a chip is inserted;
then type `@` again, press Escape, and assert the popup closed **while the comment draft text and
the detail Sheet are both still open**. That last assertion catches the `defaultPrevented` bug and is
the reason this needs E2E rather than jsdom. Non-negotiable.

#### Risks

- **The Escape/Enter collision ships silently.** Three handlers for one key, one of them inside
  ProseMirror. Get it wrong and every mention attempt destroys the comment draft — and jsdom will not
  catch it.
- **Screen-reader silence.** A body-portalled popup with `aria-activedescendant` pointing outside the
  editor's subtree is invalid ARIA: announces nothing, looks perfect to a sighted developer.
  Constraint #10 is not satisfied by arrow keys alone.
- **Notification storms.** A description mentioning eight people, edited five times, must produce
  eight emails total, not forty. The previous-vs-next diff is the only thing preventing it, and it
  depends on reading the pre-update row inside the same server transaction — the `before` pattern
  `retro.setPhase` and `retro.convertActionToIssue` already use.
- **Identity spoofing via the stored `label`.** Nothing stops a crafted document storing
  `{id:<attacker>, label:'Alice'}`. Mitigated only by rendering from the live `user` row by id. A
  mistake here is a social-engineering vector inside the team's own tracker.
- **Version skew across the TipTap graph.** Adding the packages without pinning all four through the
  catalog produces a duplicated ProseMirror `model` instance and `RangeError: Adding different
  instances of a keyed plugin` **at runtime, not at typecheck**.
- **Bundle weight on the issue-detail chunk.** Measure against the sub-100ms posture rather than
  assuming it is free.

#### Open questions

- Should the mention chip be focusable/linkable? No user profile route exists in v1, so the
  recommendation is a non-interactive `<span>` with an accessible name — which also avoids injecting
  tab stops into the middle of prose. Confirm no profile route is planned.
- Strip `mentionSuggestionChar` in the sanitizer to keep stored docs minimal, or keep it so a future
  second trigger round-trips old documents? **Leaning keep.**
- Any recency signal in candidate ordering (recent commenters on this issue first), or is
  team-then-admin alphabetical enough for a 2–20 person team? **Leaning enough** — recency is a
  ranking feature dressed as a requirement.
- Does an unresolvable mention (user hard-deleted) need a distinct rendering from an ineligible one,
  or is inert `@Name` acceptable for both?
- Is a per-document mention ceiling worth enforcing, as a storm guard and an anti-abuse measure on a
  public-facing self-hosted instance?

---

### 2.3 `search`

**One-line thesis.** Instant-then-complete search: a local pass over already-synced rows answers on
the keystroke with **zero network**, and a Postgres full-text pass extends it with comment bodies and
other teams' issues under the same team-scoped predicate the synced queries use.

**Depends on:** `issue-core` (the palette, `IssueFilter` text semantics, `saved_view`),
`workspace-auth` (`teamScoped`, the admin bypass, `auth.getSessionUser`), `retro-board` (defines the
anonymity boundary search must not cross), `zero-reconnect` (the connection state the offline
degradation reads), `mentions` (the plaintext walker — §1.2).
**Big-feature rule:** yes. All three tiers.

#### In scope

- **`packages/schema/src/search/`** — the pure, UI-free core shared by both halves: a query
  tokenizer, a local scorer (issue key exact > title prefix > title substring > body substring), and
  a deterministic merge/dedupe. It **consumes** `rich-text/plaintext.ts` from `mentions` (§1.2)
  rather than shipping its own extractor, so the local pass and the server index can never disagree
  about what a document contains.
- **Migration `0015_search`** (renumbered from `0014` — `mentions` took `0014_mentions`, see §0): a server-only `search_document(id, entity_type, team_id, issue_id,
  title text, body text, needs_triage, updated_at)` sidecar with a GIN **expression** index over
  `to_tsvector(<cfg>, setweight(title,'A') || setweight(body,'B'))`, a btree on `team_id`, and a
  btree on `issue_id` for cascade cleanup. Added to the hand-written Kysely `DB` and to `KYSELY_DB`
  in the drift test, and to that test's server-only list beside `issue_sequence`, `cycle_sequence`,
  `connector_*`, `retro_card_author` (`packages/schema/src/db/schema-drift.test.ts:436-451`).
- **`packages/schema/src/db/search.ts`** — the FTS query (`websearch_to_tsquery` + `ts_rank_cd` +
  `ts_headline`) carrying **its own** team-scoping predicate and the workspace-admin bypass that
  mirrors `teamScoped`, plus the document upsert/delete helpers. SQL and permission predicate live
  together, in `packages/schema`, beside `cycle-facts.ts` and `connector.ts`.
- ~~`createServerMutators()` maintains the sidecar for `issue.create` / `issue.update` /
  `comment.create` / `comment.edit` / `comment.delete` — the same wrapper where
  `claimNextIssueNumber` lives, so the document is written inside the same Postgres transaction as
  the row it derives from and cannot half-commit.~~

  > **SUPERSEDED, 2026-07-27 — the maintainer answered H10 (§6) the other way.** Index maintenance
  > is a **pg-boss job**, not the write transaction, and `createServerMutators()` is not touched at
  > all. Editing a title is among the most common interactions in the product and CLAUDE.md #9 is
  > non-negotiable, while search freshness is not a stated promise — so the write path stays exactly
  > as fast as it was and the index runs ~10 s behind. A watermark **tail** on the existing
  > scheduler self-re-arms every `SEARCH_INDEX_INTERVAL_SECONDS` behind a fixed one-minute cron
  > watchdog, and a slower `search-reconcile` does the full diff, the orphan canary and the
  > first-boot backfill — which is also the only thing that heals a row written with an
  > `updated_at` behind the watermark. **One exception, deliberate:** `comment_id` and `issue_id`
  > carry `on delete cascade`, so deleting a comment removes its document inside the deleting
  > transaction; deleted text must never stay findable for five minutes. Derived in full in
  > `openspec/changes/archive/2026-08-04-search/design.md` D4 and D5. Built in change 13.
- A **`search-index` queue on the existing scheduler** (§1.4): an idempotent, bounded, resumable
  backfill (run once when documents are missing, so an upgrade's boot stays fast) that doubles as the
  reconcile/repair path, plus a bounded reconcile sweep folded into the existing cycle-maintenance
  cron.

  > **Corrected in place, 2026-07-27.** Two queues, not one, and the reconcile is **not** folded
  > into `cycle-maintenance`: `search-index` (policy `short`) is the self-re-arming tail and
  > `search-reconcile` (policy `exclusive`) runs on its own `SEARCH_RECONCILE_CRON`. Folding it into
  > the cycle cron would tie search's repair cadence to a feature an operator can switch off
  > (`CYCLE_MAINTENANCE=false`). Still **one** `PgBoss` and one `boss.start()`, per §1.4.
- **`GET /api/v1/search?q=&teamId?=`** on the existing Hono app — session-authenticated via
  `auth.getSessionUser` (the middleware shape the ai/connector admin routes already use), team set
  resolved **server-side**, `LIMIT 50`, a per-request `statement_timeout`, returning ranked hits with
  `ts_headline` snippets. Additive under the existing `/api/v1` contract.
- **Command palette** (`apps/web/src/issues/command.tsx`): an **On this device** group fed entirely
  by the local pass (renders on the keystroke, no fetch in the path) **replacing** the existing
  "Jump to issue" group (§1.3), and a **From the server** group appended below a divider after a
  150 ms debounce + `AbortController`, plus a persistent `Search everything for "q" →` row.

  > **Corrected in place, 2026-07-27 — labels, and the row's position.** This originally read
  > `Results` / `From the server` and `Search everywhere`. `Results` does not *show* a seam, which
  > is the whole point of the H12 answer, and `On this device` makes the offline line
  > (`Offline — on-device results only`) read in the same vocabulary. The escalation row is
  > `Search everything for "q" →` and sits **above** the server group, not pinned below it: server
  > results are appended last, so a row below them would slide out from under the cursor as the
  > answer lands — the same reflow the two-group seam exists to prevent, at the other end of the
  > list. The invariant that buys is the strong one: every append is strictly at the end, and no
  > rendered row ever changes index. See `openspec/changes/archive/2026-08-04-search/design.md` D7, D8 and I23.
- A **`/search?q=`** TanStack route: all results grouped by entity with snippets, fully
  keyboard-operable, tokenized, AA in all three presets light and dark, and an explicit "offline —
  showing local results only" state driven by the existing sync-recovery connection state.
- Local-only search (no index, no route, no permission risk by construction) over entities already
  fully synced under existing permissioned queries: projects, cycles, teams, labels, ~~retros, saved
  views~~ — **title substring only**.

  > **Corrected in place, 2026-07-27 — retros and saved views are out of both passes.** Excluding
  > every `retro_*` table *including the retro's own title* is what turns "no search path can reach
  > `retro_card_author`" from a judgement about which retro column is safe into a one-line grep, and
  > a retro is a handful of rows per team all one click from the cycle view. `saved_view` is a
  > filter, not content; the list's own view picker is its surface. See
  > `openspec/changes/archive/2026-08-04-search/design.md` D6.
- Tests in all three tiers, and docs: an `apps/docs` features/search page, a self-hoster note on
  index maintenance and how to force a reindex, `/api/v1/search` in the API reference, plus
  ROADMAP/README updates.

#### Amendments to the original `search` scope

- **Assert the no-query-logging property, do not assume it.** The scope observed that the request
  logger records `c.req.path`, which in Hono excludes the query string, so `GET ?q=` does not land in
  the log by accident. Correct — and it must be a **test**, because it is one middleware change away
  from being false, and nothing else in the repo would notice.
- **Close the status/timing oracle.** A `statement_timeout` that returns 503 while a miss returns 200
  is an oracle over corpus size. The route must return the same status and the same shape for "no
  match", "out of scope", and "timed out"; if a partial flag is exposed it must be set on a rule that
  never depends on whether any row existed.
- **`needs_triage` must be decided, not deferred.** It is listed as a human question (correctly —
  §6), but the change may not ship a half-answer. Pick one, write it into the spec, and make it
  observable in one place; do not index them and then filter inconsistently between the two passes.
- **`search_document` is never an AI data source** (§1.9). Its `body` column contains person names
  once `mentions` has shipped.

#### Non-goals

Indexing `retro_draft`, `retro_vote`, or anything joinable to `retro_card_author` — **structurally
excluded, permanently**, via an **allowlist** of indexed entity types, never a denylist. Any query
logging, search analytics, "popular searches", or server-stored recent searches — a `search_log`
table would be the first per-person behavioural record in the product; refused on principle, not
deferred. Fuzzy/typo tolerance: no `pg_trgm`, no levenshtein, no synonyms, no per-workspace
dictionary. Semantic/vector search, embeddings, pgvector, or any AI in the search path — search
stays deterministic and works with AI switched off. Saved searches, or unifying the search model
with `IssueFilter`/`saved_view` — they converge later; converging now doubles the change. Searching
people (`user`, `workspace_member`, `invite`) — the palette's assign page already covers picking a
person, and a people index invites directory scraping. Cycle digests, connector payloads, PR/CI
rows, attachment content. Deep pagination or infinite scroll — a hard limit (50 server / 200 local)
and a "refine your query" affordance. Scroll-to-match highlighting after navigating from a comment
hit. A second global keybinding — Cmd-K stays the only entry point, no `/` shortcut.
Search-within-current-filter on the issue list. Column-level result redaction — a document is either
in the caller's team scope or it does not exist to them.

#### Schema

**One server-only table; no change to the Zero schema at all.** `search_document`'s primary key is
the source entity's own id (issue id or comment id), so nothing is minted and every write is an
idempotent upsert.

**What syncs: nothing new.** That is the point of the design — the client's input to search is data
Zero already delivered under existing permissioned queries. `search_document` joins the four existing
entries on the drift test's server-only list: present in Postgres and in the hand-written Kysely
`DB`, absent from the Zero schema, so no synced query can even name it.

**Why a sidecar and not columns on `issue`/`comment`.** The compose stack runs `postgres:18` with
Zero's default `FOR TABLES IN SCHEMA public` publication, and `reference/zero.md` §13 records that
`generated stored` columns **do** sync on PG18. A tsvector column on `issue` would therefore enter
the replication path toward zero-cache's SQLite replica with an exotic type, churn the drift test,
and put an unverified type mapping on the critical sync path. A separate table follows the
four-times-proven in-repo precedent instead, and — decisively — it carries **plain `text` columns
only, with the tsvector computed inside the index expression**. Nothing new or exotic goes near the
replica. The alternative (excluding the table via a custom publication) is rejected:
`ZERO_APP_PUBLICATIONS` changes force a full replica resync, which is an ops event on every
self-hosted upgrade.

**The invariant the code cannot express** is the shared `team_id` one in §1.5 — cite it, do not
restate it.

The migration creates the table and indexes only; the backfill runs as a pg-boss job, not in the
migrator, so an existing instance's boot is not blocked by a full index build.

#### Architecture

**The central question, argued from the constraints, then decided: hybrid, with the seam made
visible rather than hidden.**

Pure client-side over the Zero replica is instant and offline but **structurally cannot** answer the
highest-value search in a tracker: comments are only synced for the currently-open issue
(`issues.detail` relates them at `queries.ts:126`; `issues.byTeam` does not), and ZQL has **no JSON
filters** (`reference/zero.md` §13), so a synced query cannot search a TipTap body even in principle.
Bulk-syncing every comment across every team to every client is exactly the antipattern Zero exists
to avoid.

Pure server-on-every-keystroke is a direct hit on constraint #9. Search-as-you-type in Cmd-K is a
common interaction; making its first frame wait on a round trip is the bug the constraint names.

So the first result must be local and the complete result must be remote. **The discipline:** the
local pass runs synchronously on the keystroke over rows already in memory; the server pass is
debounced 150 ms behind an `AbortController` and **appends** below a divider. It never reorders
anything above the keyboard cursor — the cursor is anchored to a **result id, not an index** —
because constraint #10 makes a list that reflows under an arrow key a defect, not a polish item. If
the server never answers, search still works, degraded, and says so. A **visible seam** ("Results" /
"From the server") is chosen over a merged list precisely because the two passes have different match
semantics — local is substring, server is FTS — and pretending otherwise produces the confusing case
where the server finds something the local pass "should have".

**Is a Postgres FTS server route a violation of "all ZQL and all mutators live in
`packages/schema`"? No — it is outside it.** There is no ZQL anywhere in the search path: no
`defineQuery`, no new synced query, no ZQL text operator. The constraint governs the sync query
language and exists so the sync layer stays swappable; a Kysely statement is not ZQL, and
`packages/schema/src/db/` is already a substantial Kysely layer the server uses (`cycle-facts.ts`,
`connector.ts`, `ai-config.ts`, `cycle-digest.ts`). The discipline that **is** binding by analogy,
and that this change honours: the SQL and its scoping predicate live in
`packages/schema/src/db/search.ts`, not in `apps/server`; ranking, plaintext extraction and merge
live in `packages/schema/src/search/` as pure functions imported by both `apps/web` (local pass) and
`apps/server` (index write); `apps/server` owns only the HTTP route, session auth and serialization.
`packages/schema` keeps zero UI imports.

**Three containers, unchanged.** Postgres FTS is Postgres's own. Background work is the existing
pg-boss on the existing Postgres, on the existing scheduler instance (§1.4).

**How the index is maintained, and what it costs on write.** Not a trigger and not a generated
column — the `createServerMutators()` wrapper, where `claimNextIssueNumber` already does exactly this
kind of server-authoritative side write. Reasons: the plaintext extractor is then a **single**
TypeScript function shared by the local pass and the index write, so the two can never drift (a
plpgsql jsonpath extractor and a TS extractor disagreeing produces the silent "search is broken
sometimes" bug); it is unit-testable without a database; and it runs inside the same transaction as
the row write, so the document cannot half-commit. Every writer of `issue.title` /
`issue.description` / `comment.body` today goes through the shared mutators — connectors ingest
PR/CI/deploy rows and link them but do not author issue text — so the wrapper covers every path.
**The cost is real and must be named:** an issue-title edit becomes two row writes plus GIN index
maintenance in one transaction. GIN's `fastupdate` (on by default) makes that a small append to a
pending list amortized at autovacuum, which is noise at a 2–20 person team's write volume. The
escape hatch, if measurement says otherwise, is to move the document write to the pg-boss job and
accept seconds of index staleness — cheap to reach for, because the job already exists for backfill.
**Design the escape hatch before merging, do not discover it after.**

**How results respect row-level permissions, and never become an existence oracle.** The route
derives the actor from the better-auth session, never from a client-supplied id. It resolves the
actor's team set server-side and every statement filters `team_id = ANY($teams)`, with the
workspace-admin bypass mirroring `teamScoped` exactly. A non-member's team set is the empty array,
which yields zero rows — the deny-by-empty-set analogue of `denyAll`'s empty `or()`. An optional
`teamId` argument can only **intersect** the actor's set, never widen it, exactly as `issues.byTeam`
re-evaluates its membership predicate server-side. A member searching a token that exists only
outside their teams gets a **byte-identical** response to searching a token that exists nowhere:
same status, same shape, no counts, no "N more results you can't see". `ts_headline` snippets are
generated in the same statement, **after** the scoping filter, never over a pre-filter CTE. Auth is
checked before existence: an unauthenticated request is rejected on the session, before any table is
read. And per the amendment above, a timeout is indistinguishable from a miss.

**Why this is not surveillance** (constraint #8, applied carefully rather than over-applied): search
is a per-user *read* tool over data the user is already authorized to read. It computes no aggregate
over people, ranks nothing by author, exposes no per-person scorecard, and produces no artifact any
other user can see. The rule forbids ranking people; it does not forbid a person finding their own
work. What keeps it that way is the refusal to log queries — asserted, not assumed.

**One surface, two depths.** Cmd-K stays the action launcher it is and gains results capped at ~5 per
group, with a persistent `Search everywhere →` row; Enter there navigates to `/search?q=`, a real
route (shareable, back-button correct) where 300 comment hits with snippets are legible. Two
competing entry points would mean two keybindings and two mental models for one question.

#### The falsifiable check

A paired test, one half per half of the thesis.

**Instant (E2E, Playwright against the real stack).** With `/api/v1/search` blocked at the route
level, press Cmd-K and type a token that appears in the **description** of an issue already synced
for the current team. The result row is present in the same frame — asserted by zero in-flight
requests to the search route and a `performance` mark under 100 ms from keypress to paint — and the
"From the server" group renders its offline label instead of hanging. On current `main` this half is
not merely unimplemented: `grep -rn "ilike|tsvector|to_tsquery" apps packages` returns **zero hits**
(verified), and `matchesText` (`filter.ts:71-80`) matches title and issue key only, so a
description-only token already fails.

**Complete and non-oracular (integration, `.pg.test.ts` against live Postgres).** Seed a distinctive
token into (i) a comment body on an issue in team T1, (ii) an issue description in team T2, and
(iii) a `retro_draft` body in T1. Then, as a member of T1 only, `GET /api/v1/search?q=<token>`
returns the T1 comment with a snippet; returns **nothing** for the T2 issue, with a response
byte-identical to searching a token present in no row anywhere; returns **nothing** for the retro
draft, and returns nothing for it **to a workspace admin either**. Re-running the backfill job leaves
the result set unchanged (idempotency). On `main` the route does not exist, so every assertion fails.

**Supporting gates**: the schema-drift test shows `search_document` present in Postgres and absent
from the Zero schema; the compose smoke test still passes, proving zero-cache replicates cleanly past
the new table; and a test asserts the request logger never records the query string.

#### Risks

- **Search becomes an anonymity break.** The single most dangerous failure mode. `retro_draft.body`
  is what a person is still writing and its author is precisely the identity the retro's
  storage-layer guarantee protects; `retro_card_author` is server-only by construction. An index
  built as "every text column" — the obvious way to write this — indexes the drafts and destroys the
  strongest promise in the codebase via a JOIN nobody reviewed. Mitigation: an explicit **allowlist**
  constant, a pg test asserting a distinctive draft token is invisible to every actor including a
  workspace admin, and the drift test's server-only assertion.
- **A permission oracle by omission.** Any path returning a count, a 404-vs-empty distinction, an
  error mentioning a row, a differing status on timeout, or a snippet generated before the scoping
  filter turns search into a tool for confirming a row exists in a team you cannot read. The defence
  is byte-identical responses, and it must be **asserted**, not reasoned about.
- **zero-cache destabilised by the new table.** The default publication copies `search_document` into
  the replica whether Zero knows about it or not. Plain `text` columns keep the type mapping trivial
  and indexes are invisible to logical replication, so this should be a non-event — but "should be"
  is doing work, and the compose smoke test plus e2e are the only real evidence. The fallback, a
  custom publication, costs a full replica resync on every self-hosted upgrade and is therefore not a
  fallback anyone wants to take.
- **Silent index drift.** If a future write path (an importer, a connector that authors issues, a
  bulk operation) bypasses the mutator wrapper, those issues become invisible to server search while
  looking perfectly normal locally. Users report it as "search is flaky" and it is nearly
  unreproducible. Mitigation: the reconcile sweep, and a document-count-vs-source-count check exposed
  where an operator can see it.
- **Write amplification lands on the wrong side of constraint #9.** Search latency is the visible
  thing, but the change actually slows *writing*, which matters more. Must be measured before merge,
  with the pg-boss escape hatch pre-designed.
- **The two-pass UI reflows under the keyboard.** Results arriving 150 ms late that reorder the list
  move the row under the user's cursor between the arrow key and Enter. Append-only merge with an
  id-anchored cursor is the fix, and it must be a **spec scenario**, not an implementation habit.
- **The local pass gets expensive.** Walking every synced issue's TipTap description on every
  keystroke is real CPU at a few thousand issues — and the interaction it would slow is the one this
  whole design exists to keep instant. Needs a plaintext cache memoized on issue id + `updatedAt`;
  the cost of *building* that cache on the first keystroke is itself unmeasured.
- **Scope gravity toward the filter model.** `IssueFilter`, `saved_view`, and search all answer
  "narrow this set". Unifying them mid-build doubles the change and puts the saved-view schema in
  play. Named a non-goal now precisely so it can be pointed at later.

#### Open questions

- Does zero-cache replicate cleanly past a `public`-schema table absent from the Zero schema and
  carrying a large GIN expression index? The four existing server-only tables say yes for the table
  part, and indexes are not logically replicated — but nobody has run it with an index of this shape.
  **Verify in the compose smoke test before anything is built on top of it.**
- Should the local pass search descriptions at all, or only titles plus the issue key? Descriptions
  are already synced for the current team, so it is free data — but the extraction cost per keystroke
  is unmeasured, and title-only would make the local/server seam much wider.
- Is `issues.byTeam` + `issues.mine` + `projects.all` enough corpus for the local pass, or should
  search open a low-TTL synced query covering issue titles across all of the actor's teams? Zero has
  **no `select()`**, so "titles across my teams" necessarily syncs full descriptions too — possibly a
  lot of client data for a marginal gain. Genuinely unresolved; measure before deciding.
- How should recency factor into ranking alongside `ts_rank_cd`? Pure relevance surfaces three-year-
  old issues above last week's; a recency boost needs a weight only real data can calibrate.
- Should issues in archived teams be searchable? `teams.all` filters `archivedAt IS NULL`
  (`queries.ts:62`) but `teamScoped` does not — the existing code is already inconsistent, and search
  will make the inconsistency visible.
- Should `/search` default to workspace-wide (all the actor's teams) or the current team, with a chip
  to widen? Workspace-wide is more useful and matches "search everywhere"; team-first matches every
  other surface in the app.
- Is there an existing debounce/abort utility in `apps/web/src/lib/`, or does this need one?
  `keyboard.ts` and `mutation.ts` are the only helpers there.
- Is `ts_headline` fast enough at 50 results over comment bodies without a materialized snippet
  column? Unmeasured.
- Does the backfill need to be resumable across restarts for a large existing instance, or is a
  single bounded pass enough at the scale yapm targets? The answer changes whether it needs a cursor
  table.

---

## 3. Cross-cutting decisions

### 3.1 Notification identity — constraint #4, resolved by removing the question

`notifications` proposed a generated `id` minted **server-side inside a mutator body**, with a
unique index on `(recipient_id, kind, subject_id, event_key)`, and an argument that CLAUDE.md §4 is
not violated because the rule exists to stop an id *changing between the optimistic and authoritative
runs*, and this branch has no optimistic run. That argument is correct in substance — the precedent
is real (`sweepManualCompletions` mints `newId()` for a `cycle_digest` row keyed on `cycle_id`,
`apps/server/src/jobs/scheduler.ts:165`) — but it costs a full PR-review round to make, because the
constraints lens will flag it and the reviewer will be right to.

**Recommendation: make the natural key the primary key.** `(recipient_id, kind, subject_id,
event_key)` as a composite PK, no generated id column. Then constraint #4 is **not engaged at all**,
`on conflict do nothing` needs no separate unique index, and the idempotency check in §2.1 proves
itself rather than proving a side constraint. Zero supports compound primary keys — verified,
`reference/zero.md` §3.1/§3.3, and zbugs uses them in production for `viewState` and `issueLabel`.

Cost: `markRead` addresses a row by four columns instead of one, and the client mutator's args grow
correspondingly.

**Fallback, if that cost proves ugly in the mutator signatures:** keep a generated id, keep the
unique index on the natural key, and put the constraint-#4 argument in `design.md` **up front**,
before the first reviewer reads the diff. Either shape is acceptable. What is **not** acceptable is
shipping the generated id without the written argument, or shipping without the natural key being a
real uniqueness constraint in Postgres.

### 3.2 Email deep-link origin — pick a variable, and fix the drift

None of the three env vars is named for "the browsable URL a human clicks in an email".
`BETTER_AUTH_URL` defaults to `http://localhost:3000` (`env.ts:90`) and `WEB_ORIGIN` to
`http://localhost:5173` (`env.ts:91`) — while `.env.example:76` sets `WEB_ORIGIN=http://localhost:3000`,
so the two disagree about what `WEB_ORIGIN` even means. In a single-container production deploy the
SPA is served by the app, so `BETTER_AUTH_URL` is the browsable origin — but nothing says so.

An email full of `localhost` links is a silent, embarrassing failure no test catches.
**Recommendation: add `PUBLIC_URL`, required-when-`SMTP_URL`-is-set**, validated with the existing
Zod env pattern and failing fast by name. Reconcile the `WEB_ORIGIN` default/example disagreement in
the same change. Human call — §6.

### 3.3 Every one of the three must state its non-surveillance argument explicitly

Constraint #8 is adjacent to all three and each will be challenged on it. Each proposal carries one
paragraph, in its own terms: notifications is **routing** to one person with no admin bypass;
mentions is **addressing** with no aggregate and no "who mentions whom" view; search is a per-user
**read** over already-authorized data with no query log. The constraint forbids scorecards; it does
not forbid a person finding their own work or being told about it. Say it, do not assume it.

---

## 4. Constraint sanity-check — what was rejected or amended

| # | Constraint | Verdict |
|---|---|---|
| 1 | Three containers | **Pass, all three.** nodemailer is an outbound client, not a service. Postgres FTS is Postgres. pg-boss is on the existing Postgres. **Amended:** no third `PgBoss` instance (§1.4). |
| 2 | ZQL + mutators in `packages/schema` | **Pass.** `search`'s FTS route is Kysely, not ZQL, and its SQL + scoping predicate live in `packages/schema/src/db/search.ts` — the same discipline `cycle-facts.ts` and `connector.ts` already follow. |
| 3 | Packages never import apps; `schema` has no UI deps | **Pass.** The doc walkers are pure JSON recursion with no TipTap import — this is the one place `mentions` could have broken it, and the constraint is what forces the walker's shape. |
| 4 | Client-minted UUIDv7 at the call site | **Amended.** `notifications` engaged it; §3.1 removes the question by making the natural key the PK. Fallback path requires the argument written up front. `search_document`'s PK is the source entity's id — nothing minted. `mentions` mints nothing. |
| 5 | Versions only in the catalog | **Pass, with two deliberate additions.** `notifications` adds `nodemailer` (and see §6 on react-email). `mentions` adds `@tiptap/extension-mention` + `@tiptap/suggestion` at exactly 3.28.0 — pinning all four TipTap packages together is load-bearing, not hygiene. |
| 6 | No TS-Compiler-API tools | **Pass.** None proposed. |
| 7 | Free means free | **Pass.** Viewers are notified, emailed, mentionable, and can search. No role gate, no seat gate. |
| 8 | Team-level metrics only | **Pass, with §3.3 required in each proposal.** Not over-applied: an inbox is routing, not surveillance. |
| 9 | Sub-100ms | **Pass for `notifications` and `mentions`** (authoritative-pass fan-out; synchronous in-memory typeahead). **`search` is the live question** — not on read, where the local pass is instant, but on **write**, where index maintenance rides the issue-write transaction. Human call, §6, escape hatch pre-designed. |
| 10 | Keyboard-first | **Pass**, with two hard requirements: `mentions`' `defaultPrevented` fix (verified real against `rich-text.tsx:120-129`), and `search`'s id-anchored cursor so late server results never reflow under an arrow key. |

**Additionally rejected/amended on grounds other than the ten:**

- `notifications`' comment-body excerpts — **cut** (§1.2). Simplification and a leak closed at once.
- `notifications`' delete-on-membership-removal — **downgraded** to retain-but-redact recommended
  (§1.7), because the delivery-time membership join closes the email leak regardless.
- `mentions`' "admins appear in every team's mention list" — **amended** into an eligibility/candidacy
  split (§2.2).
- `mentions`' email-template work — **cut** as moot once excerpts are gone.
- `search`'s `needs_triage` deferral — **amended**: must be decided in the spec, not left to the
  implementation.
- `search`'s timeout behaviour — **amended** to close a status oracle.
- `notifications`' `routeIssue` open question — **resolved into scope** as an additional trigger
  site (§1.6).
- `notifications`' AppShell-badge open question — **resolved: approved**, one shared subscription.

---

## 5. Nothing in these three touches

Stated so a build flow does not reach for it: the retro anonymity boundary (`retro_card_author`,
`retro_draft`, `retro_vote`), the connector write path (`applyWorkGraphMutation`), the AI substrate's
narrowed team-scoped query, the `saved_view` schema, `issue.team_id` mutability, and the two existing
pg-boss instances' internal wiring.

---

## 6. What needs a human

Consolidated across all three. **No agent should decide these.** Each is a product, trust, or
deployment-promise decision, not an implementation detail.

**H1 — Default email posture: `'all'` or `'none'`.** `email_notifications` defaulting to `'all'`
means a fresh instance emails people who never asked for email the moment SMTP is configured. That is
what every competitor ships and what makes the feature real rather than theoretical. It is also a
trust decision (yapm mailing your colleagues unprompted) and an operational one (a small self-hoster's
relay reputation). `'none'` is defensible and makes email opt-in. *Blocks: `notifications`.*

**H2 — Deviating from TECHSTACK's stated email choice.** TECHSTACK commits to "Bring-your-own SMTP +
react-email", and `react-email@^6.9.0` is already in the catalog **and unused**. The recommendation is
plain HTML+text template functions plus **adding `nodemailer` to the catalog**, because two email
templates do not justify pulling React rendering into the server bundle. That means (a) a new catalog
dependency, which CLAUDE.md §5 makes a deliberate act, and (b) editing TECHSTACK's Email row, which
PROCESS §2 makes merge-blocking if skipped. A third option — drop `react-email` from the catalog
entirely, since nothing uses it — should be decided at the same time. *Blocks: `notifications`.*

**H3 — What happens to a user's notifications when they leave a team.** Retain-but-redact (blank the
denormalised `subject_title`, keep the row) is now recommended over delete, because the delivery-time
membership join (§1.7) already closes the email leak, leaving only a data-retention preference. But
delete is still defensible if "a departing member's history should not persist" is the posture.
*Blocks: `notifications`.*

**H4 — Whether an admin ever needs to read another user's inbox.** The scope says **never**, in code,
with a test. That closes the door on a plausible support workflow ("why didn't Dana get notified?").
If the answer is "an admin should be able to see *that* a notification exists without seeing its
contents", that is a different schema and must be decided now, not retrofitted. *Blocks:
`notifications`.*

**H5 — Debounce/retention defaults.** 2-minute debounce on a 2-minute cron (~4 min worst case) and
30-day retention are proposals, not measurements. Longer batches better and feels less responsive;
90-day retention makes the inbox a usable record at some hydration cost. *Blocks: `notifications`, but
cheap to change later.*

**H6 — Whether mentioning someone who cannot read the issue should be possible at all.** This scope
says no: the typeahead never offers them and the server never emits an event. The alternative —
mention implies an access grant, the way Linear's guest/subscriber model works — is a permission-model
decision with real security weight. *Blocks: `mentions`.*
> **ANSWERED — not possible.** Enforced server-side, mirroring `teamScoped` including its admin
> bypass. Eligibility is split from candidacy (see §2.2's amendments), and the UI **states why** a
> matched name is unavailable rather than silently doing nothing. Built in change 12.

**H7 — Whether a mention auto-subscribes the mentioned person to subsequent activity.** This directly
sets how much mail a self-hoster's relay sends. Scoped as **no** (a mention notifies once), but it is
a product decision. *Blocks: `mentions`.*
> **ANSWERED — yes, and this reversed several conclusions in §0 and §2.2.** A durable
> `issue_subscription` table with migration `0014_mentions` and a Zero schema change; a **sticky**
> unfollow shipped in the same change, not deferred; and subscription activity classified as
> **in-app only** — which follows from the H1 answer rather than being a new rule. Built in change
> 12.

**H8 — Whether `@` should ever address a group (`@team`, `@here`).** A non-goal here. If the answer is
"never", say so in VISION-adjacent terms; if it is "later", the trigger-array architecture must stay.
*Informs: `mentions`.*
> **ANSWERED — later, keep the seam.** None of it built; the trigger config and the recipient path
> are array-shaped end to end so a group target is an added producer, not a signature change.

**H9 — The text-search configuration: `'simple'` vs `'english'`.** Not a technical choice. It decides
whether yapm's search is language-neutral or quietly English-optimized. `'english'` ranks better for
English teams via stemming and stopwords; `'simple'` is fair to every self-hoster and matches the
local pass's substring semantics more closely, which shrinks the visible seam. Recommendation:
`'simple'`, env-configurable, cheap to reverse (rebuild one index) — but the default is a stance about
who yapm is for. *Blocks: `search`.*
> **ANSWERED — `'simple'`, env-configurable via `SEARCH_TEXT_CONFIG`.** yapm is for self-hosters
> everywhere, and `'simple'` also sits closer to the on-device pass's substring semantics, which
> narrows the visible seam. "Cheap to reverse" was made a real property rather than a runbook step:
> the expression index is built against a SQL **literal**, so the `search-reconcile` job compares
> the live `pg_indexes.indexdef` against the configured value and rebuilds that one index when they
> differ — otherwise a changed variable would silently stop the index being used. Built in change 13.

**H10 — Whether write amplification on the issue-write path is the right trade.** Maintaining the
index inside the write transaction means every title/description/comment edit gets slower so search is
never stale. The alternative — the pg-boss job, seconds of staleness — leaves writes untouched. A
direct "which promise bends" call between constraint #9 on the write path and search freshness.
*Blocks: `search`.*
> **ANSWERED — the job. Search freshness bends, the write path does not.** This reversed §2.3's
> `createServerMutators()` bullet (superseded above): no mutator writes a document, so an
> issue-title edit costs exactly what it did before. Typical staleness ~10 s, ~60 s if the
> self-re-arm chain breaks, healed by a fixed one-minute watchdog; a backdated `updated_at` is
> healed by the reconcile. One exception taken deliberately: an FK cascade removes a deleted
> comment's document inside the deleting transaction. Built in change 13.

**H11 — What "everything" includes in search results.** Whether results surface `needs_triage` issues
(held out of every list today) and `canceled` issues. Both are readable, so neither is a permission
question; both are product questions about whether search means "what I work on" or "what exists".
Must be decided, not deferred (§2.3 amendment). *Blocks: `search`.*
> **ANSWERED — both included, visibly labelled.** Search means "what exists"; the lists are what
> curate. Finding nothing when you search for an issue you filed that was later canceled is worse
> than finding it marked canceled. The route returns `status` and `needsTriage` on every hit and the
> result row renders both as state labels, so it is one rule observable in one place rather than two
> passes filtering inconsistently. Built in change 13.

**H12 — Whether the seam is shown or hidden.** Two labelled groups is honest and cursor-stable; a
single merged list that settles when the server answers is what people expect from Linear and reflows
under the keyboard. DESIGN.md's restraint principle points one way, familiarity the other. *Blocks:
`search`.*
> **ANSWERED — show it. Two labelled groups, `On this device` and `From the server`.** CLAUDE.md #10
> outranks familiarity with other tools, and cursor stability while arrowing is exactly what a
> reflowing merged list destroys. The palette therefore sets `shouldFilter={false}`, takes filtering
> and ordering off `cmdk`'s scorer onto the shared deterministic core, and anchors its cursor to a
> **row identity** rather than an index — so appending the server group cannot move anything. §2.3's
> `Results` label is corrected above. Built in change 13.

**H13 — Whether a future typo-tolerance pass may add the `pg_trgm` extension.** It is in the official
`postgres:18` image and adds no container, but it adds a `CREATE EXTENSION` requirement some
managed-Postgres self-hosters cannot satisfy. A deployment-promise decision. *Informs: `search`.*
> **ANSWERED — no.** The deployment promise wins; trading it for typo tolerance nobody has asked for
> is not the trade. Search is exact, not fuzzy, and yapm requires no `CREATE EXTENSION` of any kind.
> Revisit only if it becomes a real complaint. TECHSTACK's Search row, which named `pg_trgm`, was
> corrected by change 13.

**H14 — Which env var carries the public browsable URL for email deep links** (§3.2). Recommendation:
add `PUBLIC_URL`, required when `SMTP_URL` is set, and fix the `WEB_ORIGIN` default-vs-example
disagreement in the same change. *Blocks: `notifications`.*
