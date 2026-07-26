## Context

`grep -rn notification apps packages` returns nothing. Assignment is silent. The scoping pass in
[`openspec/SCOPE-v1-gaps.md`](../../SCOPE-v1-gaps.md) §1 and §2.1 resolved this change's
architecture, its overlaps with the two changes that follow it (`mentions`, then `search`), and
the constraint questions; the maintainer then settled the six product/trust calls it flagged
(H1–H5, H14). This document records how those decisions land in code and, up front, the
arguments a reviewer will otherwise raise in a PR round.

What already exists and is reused rather than reinvented:

| Existing thing | Where | How this change uses it |
|---|---|---|
| Server-authoritative mutator overrides | `packages/schema/src/zero/server-mutators.ts` | The fan-out rides `if (tx.location !== 'server') return`, the same guard carrying `issue.create`'s per-team number and `retroVote.cast`'s tally |
| `serverDb(tx)` — the wrapped Kysely transaction | same file, line 59 | Notification rows commit or roll back with the change that caused them |
| A self-scoped query with **no** admin bypass | `queries.retroDrafts.mine` (`queries.ts:238`) | The exact shape `notifications.mine` copies |
| One pg-boss instance with an optional feature block | `apps/server/src/jobs/scheduler.ts:37` (`digest?:`) | Extended into `cycles?:` + `notifications?:` — **not** a third instance |
| Kysely accessors beside the sync layer | `packages/schema/src/db/cycle-digest.ts` | `db/notification.ts` mirrors it, and exports the public write seam |
| `preference.set` + the theme control | `mutators.ts:462`, `apps/web/src/components/theme-controls.tsx` | Gains one optional arg and one control |
| The keyboard list model | `apps/web/src/triage/triage-view.tsx:140` | `/inbox` reuses `j`/`k`/arrows/Enter and the `data-index` focus model |
| `SMTP_URL`, shipped since `workspace-auth` with zero consumers | `env.ts:98`, `.env.example:89` | Finally consumed — and `openspec/specs/invitations/spec.md:24-25` becomes true |

## Goals / Non-Goals

**Goals**

1. A person learns they were assigned an issue, or that someone commented on an issue they are
   involved in, without polling a tab.
2. The fan-out is **provably** idempotent under mutator rebase — provable, not argued.
3. Nobody but the recipient can read a notification. Not a teammate, not a workspace admin.
4. Email is genuinely optional and genuinely pluggable: SMTP **or** HTTPS, and neither
   configured means cleanly off.
5. `mentions` can add a trigger type without reopening this change.
6. Still three containers; still sub-100ms on every interaction a human performs.

**Non-Goals** — see the proposal's Non-goals section. The two worth repeating here because they
shape the code: **no comment-body excerpts** (which is why this change needs no plaintext walker
at all), and **nothing aggregatable across people**.

## Decisions

### D1 — The natural key IS the primary key. This is the crux.

`(recipient_id, kind, subject_id, event_key)` is the composite primary key. There is **no
generated `id` column, and this change mints no id anywhere.**

The rejected alternative is a UUIDv7 `id` minted server-side inside the mutator body with a
unique index on the natural key. That argument is defensible — CLAUDE.md #4 exists to stop an id
*changing between the optimistic and authoritative runs*, and a server-only branch has no
optimistic run; the precedent is real (`sweepManualCompletions` mints `newId()` for a
`cycle_digest` row keyed on `cycle_id`, `scheduler.ts:165`). But it costs a full PR-review round
to make, because the constraints lens will flag it and the reviewer will be right to.

Making the natural key the PK removes the question rather than winning it:

- Constraint #4 is **not engaged at all** — nothing is minted, so nothing can change between runs.
- `on conflict do nothing` needs no separate unique index; the PK *is* the uniqueness constraint.
- The idempotency test proves the design rather than proving a side constraint: run the same
  mutator twice with identical args, assert exactly one row.
- **A benefit the scope did not name:** `markRead` addresses a row by its four PK columns, and
  `recipient_id` comes from the verified `ctx.userID`, never from args. A caller is therefore
  *structurally* unable to name another person's row. With a surrogate id, self-scoping would be
  a `where` clause somebody could forget.

Cost: the client mutator's args carry `{kind, subjectId, eventKey}` instead of one id. That is
three strings on a call the UI already has all three values for.

Zero supports compound primary keys (`reference/zero.md` §3.1/§3.3) and zbugs uses them in
production for `viewState` and `issueLabel`; this repo already has three — `issue_label`,
`issue_link`, `retro_presence`.

**`event_key` is deterministic in the mutation's own args, all minted at the call site**:
`String(args.updatedAt)` for `issue_assigned`, the comment id for `issue_commented`. Nothing is
derived from `Date.now()`, a random source, or a database sequence inside a mutator.

### D2 — `notification.kind` carries no Postgres CHECK constraint. Deliberate.

`0012_retro.ts` puts a CHECK on every enum-shaped column and a reviewer will flag the absence.
The reason: adding the `'mention'` kind must cost a TypeScript union member and a copy string,
**not** a forward-only migration in a different change. `kind` is validated as a TS union in
`context.ts` and by the Zod args schemas; the fan-out is the only writer and it is server-only.

The contrast is deliberate and load-bearing: `user_preference.email_notifications` **does** get a
CHECK, because its value set is closed and owned entirely by this change. Same house, two
answers, both argued.

### D3 — `subject_key` and `subject_title` are denormalised snapshots, not joins.

Joining the issue through a relationship off a self-scoped query would need
`.related('issue', i => teamScoped(i, ctx))` to avoid widening reads past the team boundary — the
trap `projects.all` already handles at `queries.ts:150` — and a notification whose issue fell out
of scope would then render blank. A snapshot renders in one query with no permission subtlety.

The cost is that a renamed issue shows its old title. That is correct for a log of *what
happened*, and it **must be stated in the feature docs** or it will be reported as a bug.

`subject_key` (`ENG-42`) is nullable: the fan-out reads `team.key` and the issue's `number`, and
on `issue.create` the number is claimed by the server override immediately before the fan-out
runs. If a number is somehow absent the row still renders from the title alone.

### D4 — `notifications.mine` is self-scoped with NO workspace-admin bypass (H4).

`teamScoped` (`queries.ts:21`) grants workspace admins everything. That is right for work data
and catastrophic for an inbox. `notifications.mine` is the `retroDrafts.mine` shape: a bare
filter on the verified `ctx.userID`, gated on `isMember`, denied by an empty query otherwise,
`.limit(100)` ordered `createdAt desc`.

This mirrors the anonymity posture `retro-board` shipped, and it is a one-line mistake no
ordinary test catches — which is why the falsifiable check below asserts an **admin** gets zero
rows, not merely that a non-recipient member does.

`isMember` rather than `isAuthenticated`, matching `issues.mine`: a user demoted out of
membership loses their inbox outright rather than watching it drain. Under D11 their rows are
deleted anyway, so the two agree.

### D5 — The fan-out runs only on the authoritative pass, at four trigger sites.

Guarded by `if (tx.location !== 'server') return`, exactly the pattern already carrying
`issue.create`'s per-team number (`server-mutators.ts:159-164`), and exactly what zbugs does for
its own notifications (`reference/zero.md` §5.7). Three properties make it safe:

1. **The client never runs it.** Client mutators re-run during rebase; the guard puts the fan-out
   outside that path. There is no optimistic notification to corrupt — the recipient is a
   different client, and the actor has no use for a notification about their own action.
2. **The server runs it exactly once, atomically.** `handleMutateRequest` applies each mutation id
   once (`lastMutationID` is persisted in the same transaction, so a retried push is a no-op), and
   the inserts go through `serverDb(tx)` — the same wrapped Kysely transaction — so notification
   rows and the change that caused them commit or roll back together.
3. **It is idempotent anyway**, by D1.

The four sites, and why there are four rather than three: `issue.routeIssue` (`mutators.ts:1030-1047`)
carries **its own** `assigneeId` and sets it directly, independent of `assignIssue` — a duplicated
assignee path that must fan out too. Verified by reading the code, not assumed.

| Trigger | Kind | Recipients | `event_key` |
|---|---|---|---|
| `issue.create` (with `assigneeId`) | `issue_assigned` | the assignee, minus the actor | `String(args.updatedAt)` |
| `issue.assign` (non-null `assigneeId`) | `issue_assigned` | the assignee, minus the actor | `String(args.updatedAt)` |
| `issue.routeIssue` (with `assigneeId`) | `issue_assigned` | the assignee, minus the actor | `String(args.updatedAt)` |
| `comment.create` | `issue_commented` | assignee ∪ creator ∪ prior commenters, deduped, minus the actor, capped | the comment id |

On `issue.create` the order inside the override is: shared mutator → `claimNextIssueNumber` →
`issue.update` with the number → fan out. The number must exist before `subject_key` is composed.

**Sub-100ms holds.** The actor's interaction is the optimistic client mutation, untouched. The
extra work — one bounded ZQL read plus one multi-row insert — happens on the authoritative pass,
which the UI never waits on. The recipient's inbox arrives a sync tick later. Marking read is a
local optimistic write.

### D6 — `recordNotifications` is the public seam; `NOTIFICATION_TRIGGERS` is private.

```ts
// packages/schema/src/db/notification.ts, re-exported from @yapm/schema/server
export interface NotificationEvent {
  recipientId: string
  actorId: string
  kind: NotificationKind
  teamId: string
  subjectType: NotificationSubjectType
  subjectId: string
  subjectKey: string | null
  subjectTitle: string
  eventKey: string
  createdAt: number
}

export async function recordNotifications(
  db: Kysely<DB>,
  events: readonly NotificationEvent[],
): Promise<void>
```

One multi-row `insert … on conflict do nothing`, a no-op on an empty array, inside the caller's
transaction. This is the contract `mentions` binds to; it must exist and be exported here even
though this change is its only caller.

`NOTIFICATION_TRIGGERS` — the kind → `{recipients, copy}` map — stays private. `mentions` does
**not** register in it: its recipient computation is a document diff, not a subject-involvement
rule, and forcing it through the map buys nothing.

`@yapm/schema/server` maps to `dist/zero/server-mutators.js` (see `packages/schema/package.json`),
so `server-mutators.ts` re-exports the seam. Kysely never reaches the client bundle.

### D7 — The mailer: a provider-neutral interface with two implementations.

The same framework-plus-implementations shape TECHSTACK documents for connectors
(`ConnectorDefinition` + the `WorkGraphMutation` firewall) — this repo's strongest architectural
precedent.

```ts
// apps/server/src/mail/mailer.ts
export interface RenderedMessage {
  subject: string
  html: string
  text: string
}

export interface OutboundMessage {
  to: readonly string[]     // one message, N recipients — the transports agree on this
  message: RenderedMessage
}

export interface Mailer {
  readonly transport: 'smtp' | 'resend'
  send: (message: OutboundMessage) => Promise<void>
}
```

The interface is shaped around *"send this rendered message to these recipients"*. It has no
`Transporter`, no `envelope`, no MIME concept, no header bag — nothing SMTP-shaped that HTTPS
would have to emulate. react-email renders once; both transports send the same
`RenderedMessage`. Adding a third transport later (a plain webhook, SES's API) touches one file.

**`SmtpMailer`** wraps `nodemailer.createTransport(SMTP_URL)`. This single implementation already
reaches Mailgun, Resend, Mailjet, Postmark, SendGrid and SES — every one of them issues SMTP
relay credentials — which is why it is the default and why one implementation covers most
self-hosters.

**`ResendMailer`** is one authenticated JSON POST to `https://api.resend.com/emails` via `fetch`:
`Authorization: Bearer ${RESEND_API_KEY}`, body `{from, to, subject, html, text}`, non-2xx →
throw with the status and the response body. **No SDK.** The `resend` package pulls
`postal-mime` and `standardwebhooks` for a request Node's built-in `fetch` makes in eight lines;
a dependency not added is a dependency not maintained. It exists because **some hosts block
outbound SMTP ports entirely**, and on those SMTP cannot be made to work at all.

**Selection and precedence.** `createMailer(env)` returns `Mailer | null`:

| `RESEND_API_KEY` | `SMTP_URL` | Result |
|---|---|---|
| set | unset | `ResendMailer` |
| unset | set | `SmtpMailer` |
| set | set | **`ResendMailer`**, with one warn log naming `SMTP_URL` as ignored |
| unset | unset | `null` — email cleanly disabled, one info log at boot |

Resend wins the tie because a host that blocks SMTP is *why* the HTTPS sender exists: an operator
who has added `RESEND_API_KEY` on top of an existing `SMTP_URL` has almost certainly done so
because SMTP stopped working. The alternative — fail boot on ambiguity, the `GITHUB_APP_*`
all-or-nothing precedent — was rejected because neither value is malformed and refusing to boot
on a *valid* config is a footgun on upgrade. A deterministic, documented precedence plus a warn
log is the better trade. `EMAIL_FROM` and `PUBLIC_URL` are required whenever either transport is
set (D12).

**Tests make no real network calls and need no credentials.** The interface is what makes the
test double cheap: `SmtpMailer` is constructed with an injected `createTransport`, `ResendMailer`
with an injected `fetch`. Both assert what was handed to the transport, not that a mail arrived.
CI has no SMTP server and no API key, and never needs one.

### D8 — react-email lives in a new `packages/email`, and TECHSTACK's version row is wrong.

H2 says honour TECHSTACK: render with react-email. Two facts had to be verified rather than
assumed, and both change the shape of the task:

1. **The catalog's `react-email@^6.9.0` is the dev CLI, not the renderer.** Its `package.json`
   declares `bin: {email: ...}` and depends on esbuild, socket.io, prismjs, tailwindcss,
   `@babel/parser` and `@babel/traverse`. The runtime packages are **`@react-email/render`**
   (2.1.0) and **`@react-email/components`** (1.0.12). "react-email" in TECHSTACK is the
   ecosystem name; the catalog entry is the preview tool. Both runtime packages go into the
   catalog; `react-email` stays as a **devDependency** of `packages/email` for `email dev`
   template preview, which is the only thing it is for.
2. **TECHSTACK contradicts itself.** Line 46 commits to "Bring-your-own SMTP + react-email"; line
   75's version baseline says "react-email 1.x"; the catalog pins `^6.9.0`. Fixed in this change,
   per PROCESS §2.

**Why a new package rather than `apps/server/src/mail/templates`.** `@react-email/render`
peer-requires `react` and `react-dom`, and JSX in `apps/server` would mean adding `jsx` and
likely `lib: ["DOM"]` to a Node service's tsconfig — a compiler-config change on the app that
serves the API, to render two emails. `packages/email` isolates that: it owns its own `jsx`
setting, it is unit-testable without booting a server, it is where the `email dev` preview
belongs, and it matches the repo's existing `packages/{schema,ui,api,config}` layout. It exports
exactly one thing per template:

```ts
export function renderAssignmentDigest(input: DigestInput): RenderedMessage
export function renderInvite(input: InviteInput): RenderedMessage
```

`RenderedMessage` is `{subject, html, text}` — the text part comes from the same render call
(`render(el, {plainText: true})`), so HTML and plain text can never describe different things.
`packages/email` imports no transport, no env, and no `@yapm/schema` type it does not need; it is
pure `input → RenderedMessage`.

**Escape hatch, designed before it is needed:** if `@react-email/render` proves hostile under
TS7 + `moduleResolution: nodenext` + `verbatimModuleSyntax`, the fallback is `React.createElement`
inside the same package (no JSX, no tsconfig change) and, failing that, plain template functions
returning the same `RenderedMessage` — the `Mailer` seam and every call site are unchanged either
way, because nothing outside `packages/email` knows how the string was produced. **Task 6.1
verifies the render path against the installed `.d.ts` before any template is written.**

### D9 — `nodemailer` is added to the catalog. Justified, per CLAUDE.md §5.

SMTP needs a transport library; writing one is not a serious option. `nodemailer@9.0.3` is
**MIT-0**, has **zero runtime dependencies** (verified against the published manifest), and is
the de-facto standard. `@types/nodemailer@8.0.1` ships separately as a devDependency — its major
trails nodemailer's, so **task 5.2 typechecks the transport against the installed types before
the rest of the mail module is written**; if they prove incompatible, a hand-written local `.d.ts`
covering `createTransport`/`sendMail` is a dozen lines and is the fallback.

Rejected: `emailjs` (smaller, far less exercised), and rolling raw SMTP over `node:net` (TLS,
AUTH mechanisms, and pipelining are exactly the wheel nobody should reinvent).

### D10 — No third pg-boss instance. `startCycleScheduler` becomes `startScheduler`.

Three `boss.start()` calls against the same `pgboss` schema in one process are three
connection-pool consumers and three concurrent schema installs on a fresh volume — a boot race
invisible in dev and ugly exactly once, on a self-hoster's first `docker compose up`.

```ts
export interface StartSchedulerOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  logger: Logger
  cycles?: CycleSchedulerOptions      // { cron, digest?: DigestSchedulerOptions }
  notifications?: NotificationSchedulerOptions  // { mailer, publicUrl, emailCron, retentionDays, retentionCron }
}
```

extending the shape `digest?: DigestSchedulerOptions` already uses (`scheduler.ts:37`). This is
**not** the drive-by refactor the scope correctly ruled out — that was "merge the two existing
instances". This is "do not add a third", which is smaller and more defensible.

**A consequence that must not be missed:** `index.ts` today starts the scheduler only when
`CYCLE_MAINTENANCE === 'true'`, and the e2e stack sets it to `false` for deterministic timing.
The start condition becomes "cycles enabled **or** notifications enabled", and the two blocks are
independently gated, so turning off cycle maintenance no longer silently turns off notification
retention.

Two queues, both registered on that one instance:

- **`notification-email`** (registered only when a mailer exists), cron `NOTIFICATION_EMAIL_CRON`,
  default `*/2 * * * *`. Selects notifications where `read_at is null` **and** `email_sent_at is
  null` **and** `created_at < now() - 2 minutes` (the debounce) **and** `created_at > now() - 24
  hours` (never resurrect a backlog), joined to **current** `team_membership` for the row's
  `team_id`, joined to `user_preference` for the mode and `user` for the address; grouped per
  recipient into one digest message; then stamps `email_sent_at` for exactly the rows it sent.
- **`notification-retention`** (always registered), cron `NOTIFICATION_RETENTION_CRON`, default
  `7 3 * * *`. Bounded delete of rows older than `NOTIFICATION_RETENTION_DAYS`. Runs whether or
  not a mailer exists — retention is what bounds the synced set, and it is not an email feature.

**Delivery-time membership re-check.** The sweep joins current team membership for every
team-scoped kind from day one — not just for the mentions that come later. Membership can change
between the write and the send, and the denormalised `subject_title` would otherwise outlive the
membership that authorised it. This is what makes the email side sound independently of D11.

**Failure containment.** A transport error is caught *inside* the job, logged with the recipient
count and the transport name, and the rows are left unstamped for the next window. The worker
never throws, so it never disturbs the cycle or connector jobs sharing the process, and there is
no job that retries forever.

### D11 — Leaving deletes. Team vs workspace, precisely (H3).

The scope had drifted toward retain-but-redact; the maintainer's call is **delete**. Being precise
about *what* is deleted is the whole of this decision:

| Event | Mutator | Effect on notifications |
|---|---|---|
| A member leaves, or is removed from, **a team** | `team.removeMember` | Delete rows where `recipient_id = <leaver>` **and** `team_id = <that team>`. Their notifications for **other** teams are untouched. |
| A member leaves, or is removed from, **the workspace** | `member.remove` | Delete **every** row where `recipient_id = <that user>`, across every team. |
| A team is deleted or its rows cascade | Postgres FK `team_id → team(id) on delete cascade` | Every notification for that team, for every recipient, goes with it. |
| Retention window elapses | `notification-retention` | Bounded delete past `NOTIFICATION_RETENTION_DAYS`. |

Both mutator paths are **server-authoritative overrides** doing one raw `delete` through
`serverDb(tx)`, in the same transaction as the membership removal. They cannot be shared client
mutators: an admin removing somebody else cannot see that person's notification rows, so the
optimistic pass has nothing to delete. `notifications.mine` is the only synced query over the
table, so an admin's client never learns what was removed.

The deletes are keyed on `recipient_id` (indexed as the PK's leading column), so they are cheap
and bounded.

**What does *not* cascade, and why:** `subject_id` carries **no** foreign key. It is polymorphic
by `subject_type` (`'issue'` today) and an FK would foreclose a future subject type for no gain —
v1 has no issue-delete mutator at all (`declineTriage` cancels, it does not delete), so there is
no dangling-subject path to defend against. `recipient_id` and `actor_id` also carry no FK, matching
`retro.facilitator_id` and `retro.created_by`: the `user` table is owned by better-auth's own
migrator, and this repo's migrations do not reference it.

### D12 — `PUBLIC_URL`, and the `WEB_ORIGIN` disagreement (H14).

An email full of `localhost` links is a silent, embarrassing failure no test catches. None of the
three existing variables is named for "the browsable URL a human clicks in an email":
`BETTER_AUTH_URL` is the origin better-auth signs and verifies against (it is also the sync JWT's
issuer/audience), and overloading it is precisely how the `WEB_ORIGIN` confusion started.

**`PUBLIC_URL`** is added: optional, and **required when either transport is configured**,
validated with a Zod `.check()` refinement that fails boot naming the variable — the
`GITHUB_APP_*` all-or-nothing precedent. `EMAIL_FROM` is required on the same condition (a relay
cannot send without a From address). Configuring email for the first time therefore fails fast
with an actionable message rather than quietly mailing `http://localhost:3000` links to a team.

**The `WEB_ORIGIN` reconciliation is documentation, not a default change, and that is the
finding.** `env.ts:91` defaults to `http://localhost:5173`; `.env.example:76` sets
`http://localhost:3000`. They are not in conflict — they describe different deployments. The Zod
default serves `pnpm dev`, where the SPA is Vite on 5173 and an empty `.env` must boot;
`.env.example` feeds `docker/docker-compose.yml`, where the app serves the built SPA same-origin
on 3000. **Changing either value would break the other**, so this change fixes what was actually
wrong — that nothing said so. `.env.example` gains the explanatory comment, `EXPECTED_FORMAT`
gains the sharper string, and `PUBLIC_URL` gives email the unambiguous variable it needed.

New environment surface, in full:

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | *(unset)* | The browsable base URL for email deep links. **Required when a transport is set.** |
| `EMAIL_FROM` | *(unset)* | The From address. **Required when a transport is set.** |
| `SMTP_URL` | *(unset, existing)* | SMTP relay URL. Now actually consumed. |
| `RESEND_API_KEY` | *(unset)* | Resend HTTPS API key. Takes precedence over `SMTP_URL`. |
| `NOTIFICATION_EMAIL_CRON` | `*/2 * * * *` | The digest sweep. |
| `NOTIFICATION_RETENTION_DAYS` | `30` | Retention window. |
| `NOTIFICATION_RETENTION_CRON` | `7 3 * * *` | The retention sweep. |

### D13 — Email posture: actionable only, by default (H1).

`user_preference.email_notifications` is `'all' | 'assigned_only' | 'none'`, default
**`assigned_only`**, with a Postgres CHECK (contrast D2).

Kinds are classified in the private trigger map, not in the sweep:

- **actionable** — addressed at a person: `issue_assigned` now, `mention` once `mentions` lands.
- **ambient** — everything else: `issue_commented`.

`assigned_only` emails actionable kinds only; `all` emails every kind; `none` emails nothing.
That is exactly H1 ("email for things addressed at a person; everything else in-app only") as the
default, while leaving the preference the maintainer asked to keep — and `mentions` gets email
for free by adding one entry to the actionable set, with no schema change and no new preference
value.

**In-app is unconditional.** The preference governs *email*, never the inbox row. Turning email
off never costs you the notification.

### D14 — Debounce, cron and retention defaults (H5).

2-minute debounce on a `*/2 * * * *` sweep (≈4 minutes worst case from assignment to email);
30-day retention. Proposals, not measurements; cheap to change; not defended further. The
debounce is a constant beside the queue rather than an env var, because it is only meaningful
relative to the cron — an operator who lengthens the cron does not need to re-tune it.

**Four independent defences against email storms**, all of which must survive implementation:
the natural-key uniqueness (D1), the debounce window, per-recipient batching into one message,
and — the single most effective one — **never emailing a notification already read in-app**
(`read_at is null`). If any one is dropped as "an optimisation", the risk returns. The failure
mode is a self-hoster's relay blacklisting them.

### D15 — `markAllRead`: shared bounded loop, then one raw statement.

The shared mutator authorizes the caller and loops over their unread rows, which is what makes
the client optimistic and instant. On the client that loop only sees the ≤100 rows
`notifications.mine` synced, so the server override adds one raw
`update notification set read_at = $2 where recipient_id = $1 and read_at is null` through
`serverDb(tx)` — `reference/zero.md` §5.8 is verbatim this example.

The override calls the shared mutator first and then adds the statement, keeping the house
pattern (`shared fn → if (tx.location !== 'server') return → authoritative work`) rather than
duplicating the authorization check in two places. The shared loop's server run touches at most
the same bounded set and is idempotent, so the redundancy costs a handful of statements on a
deliberate, rare action and buys a single definition of "who may mark read".

### D16 — The `team_id` denormalisation invariant, written down once, here.

`notification.team_id` is a denormalised copy of the owning issue's team, and it is only sound
because **an issue can never change team**. `routeIssue` refuses it explicitly
(`mutators.ts:1041-1042`: "Team reassignment is deliberately not routable"). This change owns the
guard — a comment on the column and an **integration test asserting no mutator mutates
`issue.team_id`** — and the later `search` change cites it rather than duplicating it.

If a future change makes issues movable, that change must move every derived row — notification
rows and every one of the issue's comments' documents — or they silently leak to the old team.

### D17 — Why this is not surveillance, and the line it must not cross.

Constraint #8 forbids individual leaderboards and per-person scorecards. A per-user inbox is not
that: a notification is **addressed to exactly one person and readable by exactly that person**.
The query has no admin bypass (D4), so not even a workspace admin can read someone's inbox. It
aggregates nothing, ranks nobody, exposes no read receipts, and produces no per-person view.
"Team-level metrics only" forbids scorecards; it does not forbid routing. This is routing.
Viewers are notified and emailed like anyone else — no role gate, no seat gate (constraint #7).

**The line this change must not cross, stated so a later change cannot cross it by accident:** no
per-person activity table; no "who reads their notifications" signal; no read-receipt visible to
a sender; no count, view, or export of notifications aggregated across people; no surface that
shows anyone but the recipient anything about the recipient's inbox. If a future feature wants
"did Dana get notified?", the answer is a server log line an operator reads, never a product
surface — and it is a new change with its own argument, not a quiet extension of this one.

### D18 — The AppShell badge shares one subscription with the inbox.

`notifications.mine` is the same query the inbox uses; Zero dedupes active queries, so mounting
it in `AppShell` costs one bounded subscription per client, not one per route. Approved, with the
requirement that badge and inbox read from **one** `useQuery`. The badge's accessible name is
"Inbox, 3 unread"; at the query limit it reads "99+".

## Risks / Trade-offs

- **The fan-out lengthens every assign and comment transaction.** It runs inside the mutation's
  own Postgres transaction, so a pathological issue — hundreds of distinct prior commenters —
  turns a one-row update into a long transaction holding locks. → Mitigations are *in* this
  change, not deferred: bound the prior-commenter read with a `limit`, dedupe before insert, emit
  **one** multi-row insert rather than N statements, and let the PK index answer the conflict
  check instead of a scan. Most likely to be invisible in dev and painful in production.
- **Email storms.** → The four defences in D14. Dropping any one restores the risk.
- **Email configuration taking the app down.** "Absent means cleanly disabled" is the easy half;
  "present but broken means degraded, never down" is the half that gets missed. → No unhandled
  rejection, no crashed scheduler, no effect on cycle or connector jobs sharing the process; the
  job catches, logs and leaves rows unstamped (D10).
- **Sync volume.** A monotonically growing per-user synced table is a hydration cost on every
  client forever. → `.limit(100)` and the retention sweep are load-bearing, not hygiene.
- **Permission copy-paste.** `notifications.mine` written as `teamScoped` grants every workspace
  admin every inbox, and looks completely normal in review. → The falsifiable check asserts an
  admin gets zero rows. This assertion exists for exactly this one-line mistake.
- **`@types/nodemailer` trails `nodemailer`'s major.** → Typecheck the transport first (task 5.2);
  a local `.d.ts` for `createTransport`/`sendMail` is the fallback (D9).
- **react-email under TS7.** → Verify the render path against the installed `.d.ts` before writing
  templates (task 6.1); `React.createElement`, then plain template functions, are the pre-designed
  escape hatches (D8). Nothing outside `packages/email` changes in any of the three cases.
- **Stale title snapshots read as a bug.** → Correct behaviour (D3); document it on the feature
  page.
- **Scope creep into broadcasts.** "While we're here, notify the team when a retro opens" is one
  line and a permanent doubling of the fan-out surface. → The non-goals make it a conversation,
  not a commit.
- **The scheduler start-condition regression.** Making notifications ride the cycle scheduler
  means a stack with `CYCLE_MAINTENANCE=false` would silently lose retention. → D10's independent
  gating, and an e2e stack that exercises it.

## Migration Plan

Forward-only Kysely migration `0013_notifications`, applied automatically at boot like every
other migration. It creates one table and adds one column with a non-null default — no backfill,
no data movement, no downtime, and nothing to reconcile on an existing instance. Migration
numbers were assigned by the scoping pass (`0013_notifications`, with `0014_search` reserved) so
two build flows cannot both claim `0013`.

Rollback is the ordinary one for this repo: migrations are forward-only, so a revert is a new
migration. Nothing in the change is destructive to existing data, so reverting the code alone
leaves an unused table and an unread column behind — inert.

Deployment: no new container, no new service, no new required environment variable. An existing
instance upgrades and gets the in-app inbox immediately; email stays off until the operator sets
a transport, at which point boot will tell them if `EMAIL_FROM` or `PUBLIC_URL` is missing.

## How we will know this worked

**The single falsifiable check.** `packages/schema/src/zero/mutators.notification.pg.test.ts`,
an integration test against live Postgres, gated by `describe.skipIf(DATABASE_URL === undefined)`
like every other `.pg.test.ts` (with the existing in-CI guard that fails if the DB is absent).

Seed a workspace with team T, workspace **admin** A, and members B and C, all three in T. Run

```ts
createServerMutators().issue.assign.fn({
  tx, ctx: A, args: { id: I, assigneeId: B, updatedAt: 1000 },
})
```

**twice, with identical args**, then assert:

1. `queries.notifications.mine` with `ctx = B` returns **exactly one** row —
   `kind: 'issue_assigned'`, `subjectId: I`, `actorId: A`, `readAt: null`. *Twice-run yields one
   row: natural-key idempotency, proved rather than argued.*
2. The same query with `ctx = C` (a member of T who is not the assignee) returns **zero** rows.
3. The same query with `ctx = A`, a **workspace admin**, returns **zero** rows. *The
   no-admin-bypass deviation — the one assertion a copy-paste of `teamScoped` breaks silently.*
4. Running the same mutator with a **client-location** transaction writes **zero** notification
   rows. *The rebase path can neither duplicate nor fabricate.*
5. `notification.markAllRead` as B stamps every unread row of B's and **none** of anyone else's.

**Run it with:** `DATABASE_URL=postgres://yapm:yapm@localhost:5443/yapm pnpm --filter @yapm/schema
test mutators.notification.pg`

**Against today's `main` it does not compile** — there is no `notification` table, no
`queries.notifications`, no `notification` mutators and no fan-out. It passes only when the
fan-out is on the authoritative pass, the natural key is a real uniqueness constraint in
Postgres, and the query is self-scoped without an admin bypass. Each of the five assertions fails
for a different, specific defect.

**Supporting, and also falsifiable:**

- *Idempotency of the whole four-site surface* — the same test file runs `issue.create` with an
  assignee, `issue.routeIssue` with an assignee, and `comment.create`, each twice, asserting one
  row per event and that `routeIssue` is not silently missed.
- *Leaver deletion (D11)* — removing B from team T deletes B's T-scoped rows and leaves B's rows
  for another team intact; removing B from the workspace deletes all of them.
- *The `team_id` invariant (D16)* — an integration test asserting no mutator mutates
  `issue.team_id`.
- *Email with no transport* — `createMailer(env)` with neither variable set returns `null`, and
  the sweep with a null mailer completes without throwing and stamps nothing. No network, no
  credentials.
- *Both transports, no network* — `SmtpMailer` and `ResendMailer` each driven through an injected
  double, asserting the same `RenderedMessage` reaches both.
- *E2E* (`apps/web/e2e/notifications.spec.ts`) — two browser contexts. A assigns an issue to B.
  With **no reload**, B's header badge reads "Inbox, 1 unread"; B reaches `/inbox` by keyboard
  only (Cmd-K → "Go to inbox"), presses `j` then `Enter`, lands on the issue, and the badge
  clears.

**What is NOT agent-checkable, and belongs to a human.** Named here rather than quietly dropped:

- **Whether the inbox feels Linear-grade.** Density, the rhythm of `j`/`k` through a list where
  rows change read-state under the cursor, whether "Dana commented on ENG-42" without an excerpt
  reads as informative or as a stub. A test can prove the keyboard works; it cannot prove the
  surface is good. **Human review of the running app.**
- **Whether ~4 minutes from assignment to email is right** (D14). Longer batches better and feels
  less responsive; the read-first-in-app suppression already removes most of the noise, so the
  right answer may be "longer than you think". Only real use tells. **Human call, cheap to
  change.**
- **Whether an email actually arrives** through a real relay and renders acceptably in real
  clients. CI proves the right bytes reach the transport; it cannot prove Gmail renders them.
  **Human smoke test with a real `SMTP_URL` or `RESEND_API_KEY` before announcing the feature.**

## Open Questions

None blocking. The six the scope raised (H1–H5, H14) were settled by the maintainer and are
implemented as D13, D8/D9, D11, D4, D14 and D12 respectively; the three the scope left open for
this change (`routeIssue` as a trigger, the AppShell badge, `isMember` vs `isAuthenticated`) are
resolved as D5, D18 and D4.

Anything genuinely ambiguous that surfaces during implementation goes below, per CLAUDE.md.

## Decisions made during implementation

*(Appended during the build. Each entry: what was ambiguous, what was chosen, why.)*

### DI-1 — `notification.created_at` is typed `Timestamp`, not `Generated<Timestamp>`

*Ambiguous:* the fan-out sets `created_at` from the triggering mutation's own timestamp, but every
other `created_at` in the hand-written `DB` interface is `Generated<Timestamp>`, which kysely 0.28
resolves to an insert type of `ColumnType<…>` rather than `Date` — a plain `Date` will not compile.

*Chosen:* `created_at: Timestamp`, following the precedent already established (and already
commented) on `connector_config`: "`Timestamp` (not `Generated<Timestamp>`) so these DB-defaulted
columns stay omittable on insert yet settable on update". The Postgres default is unchanged, and the
drift test's `hasDefault: true` entry is what actually asserts it.

### DI-2 — `NOTIFICATION_SYNC_LIMIT` lives in `context.ts`, not `queries.ts`

*Ambiguous:* task 3.2 requires `markAllRead` to loop "bounded by the same limit the query uses",
which naïvely means `mutators.ts` importing from `queries.ts`.

*Chosen:* the constant lives in `context.ts` beside the other shared enums and limits, and both
`queries.ts` and `mutators.ts` import it. Same single definition, no new edge from the mutator layer
to the query layer.

### DI-3 — "run it twice" means "attempt it twice" for the two insert-shaped triggers

*Ambiguous:* the falsifiable check says to run each of the four triggers twice with identical args.
`issue.assign` and `issue.routeIssue` are update-shaped and genuinely re-runnable, but `issue.create`
and `comment.create` insert a row keyed on a call-site-minted id, so a second identical application
cannot get past its own insert — in any mutator in this repo, not just these two.

*Chosen:* the test attempts both twice (the second attempt's transaction rolls back whole) and
asserts exactly one notification row afterwards, with the reason written at the helper. The natural
key's idempotency under a genuinely repeated authoritative write is then asserted directly at the
seam — `recordNotifications` called twice with the same event, and once with the event duplicated
inside a single statement, both yielding one row. Falsifiability was confirmed by mutation: removing
`routeIssue`'s fan-out fails exactly one assertion, removing `issue.assign`'s rebase guard fails
exactly one, and replacing the recipient filter with `teamScoped` fails the admin assertion.

### DI-4 — `setPreference` preserves an omitted `emailNotifications` rather than resetting it

*Ambiguous:* the field is written "on both insert and update defaulting to `assigned_only`", but the
theme control shares this one mutator and does not send the field.

*Chosen:* insert writes `args.emailNotifications ?? 'assigned_only'`; update writes
`args.emailNotifications ?? existing.emailNotifications ?? 'assigned_only'`. Changing your theme can
never silently re-enable email you turned off. Both paths are covered by unit tests.

### DI-5 — Two registries had to admit the new surface, and both are the point of having them

*Not anticipated:* `ai-tools.ts` fails its own test if any registered mutator has no tool spec, and
`queries.anonymity.pg.test.ts` fails if any registered query is missing from its walk. Both fired.

*Chosen:* `notification.markRead` / `markAllRead` are classified `write` (they are structurally
self-scoped and destroy nothing), and `notifications.mine` joins the anonymity walk — where it earns
its place, since a notification carries both a recipient id and an actor id and has no
`IDENTITY_BY_DESIGN` entry to excuse either reaching anyone else.

### DI-6 — A third index, on `team_id`

*Not anticipated:* tasks 1.1 named the unread index and the delivery-sweep index. `team.removeMember`
deletes by `(recipient_id, team_id)` — answered by the PK's leading column — but the `on delete
cascade` from `team` scans by `team_id` alone. `notification_team_id_idx` was added for it.

### DI-7 — Verified: zero-cache replicates the compound primary key cleanly

Not a decision, but the thing most likely to have gone wrong. `zero-cache` 1.8.0 was started against
the migrated database on the isolated stack: it computed an initial download state for
`notification` with all twelve columns and reported `replication status OK` with zero `ERROR`-level
log lines. The four-column primary key needed nothing special.

### DI-8 — The one subscription is a hook, not a convention

*Ambiguous:* D18 requires the shell badge and the `/inbox` list to read **one**
`notifications.mine` subscription, but two components calling `useQuery` separately satisfies that
only because Zero dedupes — a property no test asserts and a future third caller could quietly rely
on or break.

*Chosen:* `apps/web/src/notifications/use-inbox.ts` is the single call site. The badge and the view
both call `useInbox()`, and the rule ("never open a second `notifications.mine`") is written where
the query is opened rather than in a doc. The dedupe still does the work; the hook makes the
requirement inspectable.

### DI-9 — Enter is the row button's own activation, not a list keybinding

*Ambiguous:* the spec asks for both Enter and Right to open the focused row. `triage-view.tsx`
handles Enter in the container's `onKeyDown` because its rows are `IssueRow` divs. A `<button>` row
fires `click` natively on Enter, so handling Enter in the container as well would open — and mark
read — twice per press.

*Chosen:* the inbox row is a real `<button>`, so Enter and Space activate it through the platform;
the container handles only `j`/`k`/Down/Up, Right and `e`. A test asserts activation produces
exactly one mutation. The row therefore needs no `role`, and its accessible name is its own text.

### DI-10 — Day grouping, and why the `data-index` sequence is computed rather than counted

*Not anticipated by the tasks, which say only "row-shaping and grouping":* the inbox groups by
calendar day (Today / Yesterday / Earlier), empty buckets dropped. Grouping introduces headings
between rows, so `data-index` is taken from a `Map` of the flat, already-ordered row list rather
than from a counter incremented during render — the cursor sequence then cannot depend on render
order, and a heading can never make `j` skip a row.

### DI-11 — The email preference rides the existing Appearance popover, and its trigger keeps its name

*Ambiguous:* task 7.6 says "beside the theme preference (`theme-controls.tsx` or its sibling
surface)". That popover is titled "Appearance" and its trigger is labelled "Appearance settings" —
a name two shipped e2e specs already select by (`theme.spec.ts:65`, `triage.spec.ts:172`).

*Chosen:* the control is added as a separated block inside the same popover, and **neither the
trigger label nor the popover title is renamed**, because that is the only per-user preference
surface in the app and renaming it would regress two passing specs for a cosmetic gain. The block
carries its own explanatory line — "Your inbox always shows everything. This only changes what is
emailed." — which is D13's in-app-is-unconditional rule stated where a user can act on it. The
value is read straight off the synced `user_preference` row (optimistic, so the select moves in the
same frame) and written through `preference.set` with the theme fields the mutator requires,
`emailNotifications` omitted by every other caller so DI-4's preservation rule holds.

### DI-12 — "Mark all notifications as read" gets its own palette group

*Ambiguous:* the palette spec says the two commands go "in its existing navigate and action
groups". "Go to inbox" fits the existing Navigate group exactly. Every existing *action* group
(`Issue`, `Triage`) is gated on a selected issue, and marking your own inbox read has nothing to do
with whatever issues the palette happens to be pointed at — putting it there would hide the command
whenever nothing is selected.

*Chosen:* a small always-visible `Notifications` group holding the one command. The existing
`Jump to issue` group is untouched — the later `search` change owns it.

### DI-13 — The badge is a link, and lives only in `AppShell`

*Not anticipated:* `AppShell` is not the only header. The team-scoped routes
(`teams.$teamId.issues.index.tsx` and its siblings) each compose their own header from the same
four components rather than using the shell, so the badge added to `AppShell` appears on `/`,
`/inbox`, `/invite` and the settings routes but not on the team boards.

*Chosen:* the assignment scopes this stage to `app-shell.tsx`, and that is what was changed —
touching six route headers to duplicate the badge is a wider edit than this stage owns, and the
palette's "Go to inbox" already reaches the inbox by keyboard from a team route. **The e2e stage
(13.1) must therefore assert the badge on a shell route, or first hoist those headers.** Flagged
rather than silently assumed.

The badge itself is a `Link`, not a button with an `onClick`: it is in the tab order, it has a real
`href` a middle-click or a screen-reader link list can use, and its accessible name is the model's
one sentence (`Inbox, N unread`, `99+` past the cap) with the visible pill marked `aria-hidden` so
the count is announced once.
