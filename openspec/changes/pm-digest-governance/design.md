# Design — pm-digest-governance

## Context

Change 20 (`pm-digest-boundary`, PR #22, `b3f4176`) shipped `pm_digest`, the server-only
`ai_disclosure_audit` table, `resolvePmAudienceTeamIds`, the `pmAudienceScoped` predicate, the four
switches in `connector_config.config` jsonb, and the human review-and-publish gate. Its
`design.md` decision log (I1–I18) is binding precedent here; the ones this change leans on are
**I2** (the producing team is the first reader; a count, never a reader list; no read is ever
logged), **I4** (`actor_id` is `text` with no FK, deliberately outliving the account), **I11** (the
admin block writes one team at a time and re-mints its own credential) and **I17** (a release is
refused while the policy is held, and the refusal is server-only and generic).

Nothing here adds a migration. SCOPE §2 scopes this change at zero, and every extension point it
needs was left open on purpose: `notification.kind` and `notification.subject_type` carry no CHECK
(`0013_notifications` header), and `ai_disclosure_audit.pm_digest_id` is already
`on delete set null`.

## Goals / Non-Goals

**Goals**

- The disclosure audit log is bounded by a configured window and the bound is enforced by a job.
- An admin can read what was disclosed, when, by whom, and to how many readers.
- Named readers learn a digest was released without the release leaving the governed surface.
- The words "auditable" and "retention-bounded" become accurate, and the docs say what the numbers
  actually are.

**Non-Goals**

- No read log. Nothing records that a reader opened a digest, and no surface here implies one exists.
- No per-person aggregation of any kind — no counts by actor, no ranking, no trend line.
- No export, no retention policy per team, no legal-hold flag. One workspace-wide window, one knob.
- No widening of `pmAudienceScoped`, `teamScoped`, or the notification delivery sweep's access
  predicate.
- No fourth container and no second `PgBoss` instance.

## Decisions

### D1 — Retention sweeps `ai_disclosure_audit` only, and the test proves the delete is targeted

SCOPE §8's check reads "the retention sweep deletes a disclosure past its window and leaves the
team's own `cycle_digest` untouched". The ambiguity is what "a disclosure" is: the audit record, or
the `pm_digest` row.

**Chosen: the audit record only**, with the test asserting `cycle_digest` **and** `pm_digest` are
both untouched.

The two tables have different growth laws. `ai_disclosure_audit` is append-only and grows with
*activity* — every policy edit, every generation, every publish, every retraction, forever, and
there is no other control that removes a row. `pm_digest` grows at one row per cycle per team,
exactly the rate `cycle_digest` has grown since change 9, which has never needed a sweep. Deleting a
published digest would also make a reader's `/digests` list silently shrink — removing something the
product told them they had, which is a worse trust outcome than storage.

The audit record deliberately outlives the artifact: `pm_digest_id` is `on delete set null`, so if a
digest is ever removed by a cascade the record that it was disclosed survives with a null link.
Making retention delete the artifact and keep the record would have been coherent too; keeping both
until the audit window expires is simpler and loses nothing.

### D2 — 365 days, and why that number

`AI_DISCLOSURE_RETENTION_DAYS` defaults to **365**, `min(1).max(3650)` like
`NOTIFICATION_RETENTION_DAYS`.

The question an audit log is asked — *what did we share with product, and when did the policy
change?* — is asked at annual-review cadence, and a shorter window loses the record of a policy
change made two quarters ago that is **still in effect**, which is the single most valuable row in
the table. Against that, the cost of keeping it is negligible: a workspace running ten teams on
two-week cycles writes on the order of a few hundred rows a year, kilobytes.

Notification retention defaults to 30 for the opposite reason: notifications are a per-client
**hydration** cost, so short is correct. The audit table is server-only and syncs to nobody, so the
only pressure on it is unbounded growth, and a year bounds that without discarding the answers.

Stated plainly in the docs and the proposal rather than left to be inferred, because "retention-
bounded" is a phrase this change earns and an unstated window is not a bound anybody can rely on.

The cron default is `23 3 * * *`, offset from notification retention's `7 3 * * *`: both are nightly
and there is no reason for two bulk deletes to start in the same minute on one Postgres.

### D3 — The sweep is a sixth block on the shared boss, and it runs unconditionally

`registerDisclosureJobs` copies `registerNotificationJobs`' retention half exactly: `createQueue`,
`work`, `schedule`, one log line. It is registered whenever the block is present, and the block is
always present — like notification retention and unlike every AI block, because retention bounds a
table that exists whether or not AI is switched on. An instance that once had disclosure enabled and
then turned `AI_PM_DIGEST` off must still have its audit log swept; a bound that stops being enforced
when the feature is disabled is not a bound.

The sweep is idempotent by construction (a `delete ... where created_at < $cutoff` deletes nothing
on the second run) and its result is logged only when it deleted something, matching
`runNotificationRetention`.

### D4 — The ready notice is a `notification` row, and the delivery sweep is a second one

This is the load-bearing structural decision and it has two halves.

**Why a `notification` row.** The notice needs at-most-once delivery, and the only migration-free
at-most-once email ledger in the repo is `notification`: its primary key is the natural key
`(recipient_id, kind, subject_id, event_key)`, so a re-run inserts nothing, and `email_sent_at`
stamps what a transport accepted. `0013_notifications` states in its header that a new kind must
cost "a TypeScript union member and a copy string, NOT a forward-only migration", and that
`subject_id` carries no FK precisely so "a later subject type costs no schema change". Both
extension points are used exactly as documented. The reader also gets an in-app inbox row, which is
strictly better than an email-only channel for a self-hosted product: it is inside the permission
model, inside retention, and it disappears with the reader's membership.

**Why a second sweep and not the shipped one.** `pendingNotificationEmails` carries a
**current-access predicate — a member of the notification's team OR a workspace admin** — spec'd as
"Losing team membership stops delivery". A PM reader is neither, so a `pm_digest_published` row
would be written, never mailed, and never explained. Teaching that SQL about the disclosure axis
means a jsonb read of `connector_config.config` inside the notification query — a second place that
decides "is this person allowed", which `db/pm-disclosure.ts` opens by naming as the way the two
answers drift. Widening it for one kind would also weaken it for every kind, since the predicate is
shared.

So: `pendingPmDigestReadyEmails` is written **beside** `pendingNotificationEmails`, not inside it.
It selects `subject_type = 'pm_digest'`, unread, unstamped, within the debounce and recency windows,
applies the same `email_notifications` preference in the same SQL position, and applies **no access
predicate at all** — because entitlement is then re-resolved in TypeScript through
`resolvePmAudienceTeamIds`, the one resolver, per recipient, before anything is sent. That is the
same "current access at delivery time" property the shipped sweep has, obtained through the single
resolver rather than through a copy of it: a reader removed from the audience, a team whose
`pmVisible` was turned off, or a workspace whose kill switch was set between publish and sweep gets
nothing.

`pendingNotificationEmails` gains one narrowing clause, `subject_type = 'issue'`, so the two
selections are provably disjoint. It removes no row today — `'issue'` is the only subject type
that exists before this change — and it is what stops a workspace admin who is also a named reader
from being mailed the same event twice by two sweeps.

### D5 — The actor of a publish is `system`, never the person who released it

`notification.actor_id` is `NOT NULL`, and the row syncs to the reader. Writing the publisher's id
there would hand a PM outside the team the identity of the individual who released the digest —
exactly what change 20's I2 refused when it left `published_by` out of the Zero schema, in those
words: *telling a PM which individual released a digest is accountability in the wrong direction*.

So the fan-out writes `SYSTEM_ACTOR_ID`. `notificationCopy`'s new branch ignores the actor entirely
and words the title without one ("A cycle digest was shared with you"), so the `'Someone'` fallback
never renders. The accountability record for the release is the `ai_disclosure_audit` row, which
carries the real `actor_id` and which only an admin reads — the same split I2 chose.

`event_key` is `String(args.publishedAt)`, deterministic in the mutator's own args like every other
fan-out in the repo, so a rebase re-run inserts nothing new and a re-publish after a retraction
correctly produces a fresh notice.

### D6 — The mail body: a link, a team name, a cycle name, and nothing else

`renderPmDigestReady` takes `{ publicUrl, teamName, cycleName }` and renders a `Layout` with a
single `Button` to `/digests`. It cannot render digest content because it is not given any — the
type has no field for it, the same enforcement `DisclosureAuditDetail` uses.

The falsifiable check is asserted against the **rendered output**: a test renders the message for a
digest whose stored `content` carries distinctive summary, highlight and evidence-label strings, and
asserts the rendered HTML and text contain the `/digests` URL and **no** substring of any of them.
Asserting against the template source would pass for a template that interpolated a field that
happened to be empty in the fixture.

The reasoning to keep written down, in SCOPE's terms: **a mailed artifact sits outside the kill
switch, outside retention and outside the audit log simultaneously.** An admin who sets the kill
switch stops every further read in yapm; they cannot reach an inbox. Retention deletes rows in
Postgres, not messages in a mail store. The audit log records what yapm disclosed, and it has no way
to record what a mail relay forwarded. Each of the three governance mechanisms this change exists to
make true is defeated by a body that carries the content — so the notice carries a link, and a
reader who is no longer entitled follows it into an empty surface, because `pmAudienceScoped` is
evaluated at read time.

### D7 — Three variables, one cross-field refinement, and the instance floor is off

- `AI_DISCLOSURE_RETENTION_DAYS` — `z.coerce.number().int().min(1).max(3650).default(365)`.
- `AI_DISCLOSURE_RETENTION_CRON` — `cronExpression.default('23 3 * * *')`.
- `AI_PM_DIGEST_READY_EMAIL` — `'true' | 'false'`, default `'false'`.

The email is off at the instance floor and that default is the decision, not an oversight: it is the
one path in this feature that leaves the governed surface, so an operator opts into it explicitly.
On top of it sit the shipped per-recipient `email_notifications` preference and the presence of a
transport, so "optional" is true at three layers.

`AI_PM_DIGEST_READY_EMAIL=true` with `AI_PM_DIGEST=false` **fails at boot naming both variables**,
on I1's precedent and for I1's reason: it describes mail for an artifact that is never generated,
and saying so at boot is cheaper than a support thread. No refinement is added against the mailer —
no transport is a clean disablement everywhere else in the product (`createMailer` returns null and
logs), and this follows it rather than inventing a second posture.

No cron variable is added for the ready sweep. It reuses `NOTIFICATION_EMAIL_CRON`: the cadence
question is identical to the notification sweep's, and a second variable would be a knob with no
distinct answer.

### D8 — The audit view: `/verdicts`' shape, and what it deliberately cannot show

`GET /api/v1/ai/disclosures` sits behind the same `requireAdmin` middleware as `/verdicts`, which
refuses **before any read** — a member or a viewer is answered `403 forbidden` without a disclosure,
a team or a digest being touched, and the refusal is identical whether or not the workspace has ever
enabled disclosure. That is the `search`/`attachments` non-oracle discipline: nothing in the refusal
distinguishes "not allowed" from "nothing there".

The response is per-team totals plus the recent events, mirroring `RetroVerdictLog` so the settings
page has one shape for "an operational log". Each event carries: when, which event, the team's name,
the actor's display name where there is one, and the yapm-computed `detail` — audience size, run
status, which switches changed, which team ids a policy write touched.

**The per-person hazard, addressed head-on.** VISION #8 bans per-person metrics. The actor of a
policy change or a release is not a metric: it is an attribute of one discrete governance action, in
an admin-only log, and change 20's I2 already decided this table is where actor identity belongs. So
it is shown — and the guardrails are structural, not editorial:

- There is **no aggregation by actor anywhere** — the totals are grouped by team, and the shape has
  no actor-keyed field for a count to be added to later.
- There is **no read event in `AI_DISCLOSURE_EVENTS`**, so no read can be surfaced; the four values
  are `policy_changed`, `generated`, `published`, `unpublished`.
- The audience itself is never returned. `setPmDisclosurePolicy` already records only *which team
  ids* a write touched, never who is on a list, and the view has no other source for it.

The section says this in the product's own words rather than leaving it to the docs: it reports what
was disclosed and to how many readers, and yapm does not record who read anything.

### D9 — Absence is driven by "nothing was ever disclosed", not by a switch

Change 20's rule is that these surfaces are cleanly absent, never an empty state that reveals a
channel exists. Applied naively to the audit section — hide it when `pmDisclosure.enabled` is false
— that would hide the history from an admin the moment they turn disclosure **off**, which is the
one moment they are most likely to want it. That is a governance regression dressed as consistency.

**Chosen:** the section renders when the log is non-empty, and is absent when it is empty. An
instance that has never enabled disclosure has an empty log and therefore no section — the same
absence, arrived at from the fact rather than from the switch — and an admin who turns disclosure
off keeps the record of what happened while it was on. The whole section already sits inside the
admin-only AI settings page, so its presence discloses nothing to anyone else.

### D10 — The `.env.example` ↔ Zod check is written here because it does not exist

PROCESS.md §2 says "mechanical checks catch the detectable cases (`.env.example` vs the Zod
schema)". Grepping the repo, no such check exists in any test, script or workflow. This change adds
three variables whose documentation is exactly what that check would guard, so it writes the check
rather than restating the claim.

It is a unit test beside `env.test.ts`: parse `.env.example` for `KEY=` at line start, commented or
not, and assert set equality with the Zod schema's keys **modulo two declared exception lists** —
container-set variables the schema requires but an operator never writes in `.env`
(`DATABASE_URL`, `HOST`, `PORT`, `WEB_DIST_DIR`) and compose-only variables `.env.example` documents
that the server never reads (`POSTGRES_*`, `ZERO_*`, `YAPM_*`, `VITE_ZERO_CACHE_URL`). Both lists are
literal and commented, so adding a variable to one is a deliberate, reviewable act rather than a
loosened regex.

### D11 — "Auditable" and "retention-bounded", said accurately

ROADMAP row 23 and SCOPE §2 gate those two words on this change merging. Once it does they are
usable, and the docs change 20 wrote around the prohibition are swept for phrasing that now reads
awkwardly (README's "Next: retention and an admin view…" being the clearest case).

Accuracy over rhetoric, in the docs and in the settings copy:

- "Auditable" means: every policy change, generation, publication and retraction is recorded, and an
  admin can read the record. It does **not** mean reads are recorded — nothing records those, by
  design, and the docs say so in the same breath.
- "Retention-bounded" means: audit records are deleted after `AI_DISCLOSURE_RETENTION_DAYS`,
  default 365. It does not mean digests expire.
- Retraction keeps change 20's exact formulation — **it stops further reads but does not un-read** —
  rather than a second wording invented here.

## Risks / Trade-offs

- **The audit view names an actor.** Deliberate (D8), on change 20's own reasoning, and fenced by
  the absence of any per-actor aggregate and the absence of any read event. The risk is drift: a
  later "who publishes most" tile would violate VISION #8, and the spec forbids it in terms rather
  than by omission.
- **The notice tells a reader a cycle closed on a team they are not on.** It is sent only after a
  human on that team published to them, so it discloses nothing the publication did not. A reader
  whose entitlement is withdrawn before the sweep is not mailed; one whose entitlement is withdrawn
  after it follows a link into an absent surface. What cannot be undone is a mail already delivered
  — which is the same "stops further reads but does not un-read" limit change 20 states, extended to
  the notice, and it is why the notice carries no content.
- **Two delivery sweeps now exist.** The duplication is real and chosen (D4). It is bounded by the
  disjoint `subject_type` selections, both asserted, and by the fact that the second one contains no
  copy of the entitlement rule.
- **365 days may be too long for some hosts and too short for others.** It is one variable, and the
  docs state the number and the reasoning rather than the number alone.

## Migration Plan

None — no schema change. Existing instances pick up the retention sweep at the next boot and delete
whatever is already past the window on the first nightly run; on an instance upgrading within a year
of change 20 that is nothing. The ready email is off until an operator sets
`AI_PM_DIGEST_READY_EMAIL=true`, and no notice is written for digests published before this change,
because the fan-out runs at publish time.

## Open Questions

None blocking. SCOPE §9 items 12 and 14 were answered by change 20 (I1, I2) and this change stays
consistent with both: `AI_PM_DIGEST` remains the PM run's own toggle and the new email variable sits
under it; the producing team still learns what was disclosed through the review gate and the
audience-size snapshot, and this change adds no per-team disclosure history beside it — the audit
view is admin-scoped, exactly where I2 said that history belongs.

## Decisions made during implementation

### I1 — The notice's copy is actor-free at the COPY layer, not only at the fan-out

D5 says the fan-out writes `SYSTEM_ACTOR_ID`. Implementing it exposed a second place the publisher
could have leaked: `notificationCopy` interpolates an actor into every title, falling back to
`'Someone'` when the actor row is gone.

**Chosen:** `titleFor`'s `pm_digest_published` branch takes no actor argument at all and returns a
constant — "A cycle digest was shared with you". The `'Someone'` fallback is therefore unreachable
for this kind rather than merely unlikely, and a future change that decided to write a real
`actor_id` would still render no name here. Two independent refusals rather than one.

### I2 — `subject_title` is `"<team> · <cycle>"`, and the sweep splits it back

The mail template takes `{ teamName, cycleName }` (D6), but the notification row carries one
`subject_title` column. Options were a second column (a migration this change refuses to take), a
jsonb blob in `subject_key`, or a delimited label.

**Chosen:** the fan-out bakes `"<team> · <cycle>"` and the sweep splits on the first `' · '`. A label
without the separator still renders — the team half degrades to the whole string, the cycle half to
empty — because a missing cycle name is not a reason to withhold a link somebody was told they would
get. The delimiter is the same middot the inbox and the settings surfaces already use for
compound labels, so the in-app row reads correctly with no special case.

### I3 — The ready sweep is per-recipient-per-row, not batched like the notification sweep

`runNotificationEmailSweep` groups every pending row for one recipient into a single digest message.
The ready sweep sends one message per notice instead.

**Chosen deliberately.** The two shapes answer different questions. A notification digest exists to
collapse a burst about the same inbox; a ready notice is one discrete team releasing one discrete
cycle, and collapsing two teams' releases into "you have 2 notifications" would either name both
teams in one subject line — a cross-team disclosure neither release authorised on its own — or name
neither, which is a message with nothing in it. Entitlement is also resolved per team, so a batch
containing one entitled and one withheld notice would have to be partially rendered anyway. The
resolve itself is memoised per recipient, so the extra cost is messages, not queries.

### I4 — The audit view's error path is silent

Every other settings section surfaces a load failure in a `role="alert"`. This one does not.

**Chosen:** the section is absent on an instance that has never disclosed (D9), so an error banner
would announce that a disclosure channel exists to an admin who has not opened one — the same
"absence, never an empty state" rule change 20 set, applied to the failure path. The section sits
below the two that matter and its absence costs an admin nothing they cannot get from the server
log.

### I5 — `pendingPmDigestReadyEmails` returns a narrower row than `PendingNotificationEmail`

It carries no `actorName`, no `subjectKey`, no `subscriptionState` and no `createdAt`, because the
template needs none of them and the copy is actor-free (I1). The type is the enforcement again: a
future change that wanted to name the publisher in the mail would have to widen the row type first,
which is a reviewable act rather than a one-line interpolation.

### I6 — `notificationSubjectPath` gains a `pm_digest` case it can never reach

`pendingNotificationEmails` now selects `subject_type = 'issue'` only, so the issue sweep can never
see a `pm_digest` row — but the path function's switch is exhaustive over the union and stops
compiling without the case. It returns `/digests` rather than throwing: an unreachable branch that
throws is a landmine if the selection is ever widened, while one that answers with the reader's own
surface is merely redundant.

### I7 — Change 20's word blocklist is retired rather than left passing

`apps/web/src/settings/pm-disclosure.test.tsx` carried a test asserting the disclosure switch copy
contained neither "auditable" nor "retention-bounded" — change 20 enforcing ROADMAP row 23's
reservation of those words against itself. It still passes, because the new audit section is a
different component.

**Retired, and replaced rather than deleted.** Row 23 reserved the words *until the surfaces that
earn them exist*; they exist now, a few centimetres below that block, and a passing test whose
comment cites a lifted prohibition fails the next honest copy edit for the wrong reason. What
replaces it is the claim that stays false however governed this feature becomes: the switch copy
offers no reading data — no "who read it", no "who opened", no read log. That property is the one
VISION #8 actually cares about, and a blocklist of two words would never have caught its violation.
