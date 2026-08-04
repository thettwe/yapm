# pm-digest-governance

## Why

Change 20 shipped the disclosure boundary and, with it, a promise: that what leaves a team is
**recorded**, **bounded** and **reviewable**. Two thirds of that promise is currently a table
nobody can read and a log nobody deletes.

`ai_disclosure_audit` exists, is written on every policy change, every generation, every publish
and every retraction — and there is no surface that reads it and no sweep that bounds it. An audit
log with no reader is decoration; an audit log that grows forever is not a governed one, it is an
unbounded per-workspace record of who changed what, kept until the disk fills.

Change 20's mission forbade the words **"auditable"** and **"retention-bounded"** in user-facing
copy, on the grounds that neither was true yet. This change is what earns them. It is the last
change of the AI-features family and the last scoped change in the repo, so it also has to leave
ROADMAP, README and VISION telling the truth about where v1 actually stands.

The third item is the one that could have been an accident. A team publishes; the named readers
learn nothing until they happen to open the app. The obvious fix — mail them the digest — is the
one thing this feature must not do, because **a mailed artifact sits outside the kill switch,
outside retention and outside the audit log simultaneously**. An admin who sets the kill switch
stops further reads in yapm and cannot touch a copy already sitting in an inbox. So the notice
carries **a link and nothing else**, and that is a stated decision recorded here rather than a
property somebody has to notice was preserved.

Vision principles served: **#4 (trust — a team can see what left, and it stops being kept forever)**,
**#8 (team-level only — the audit view reports what was disclosed and to how many readers, never a
reading log)**, **#9 (self-hosting simplicity — the sweep is another block on the shipped pg-boss;
still three containers)**, and **#7 (free means free — no governance tier, no audit-log upsell)**.

## What Changes

- **A retention sweep for the disclosure audit log**, registered as a sixth independent block on the
  **existing shared pg-boss instance** — `NOTIFICATION_RETENTION_QUEUE`'s shape, line for line. No
  new container, no new service, no second `PgBoss`. `AI_DISCLOSURE_RETENTION_DAYS` defaults to
  **365** and `AI_DISCLOSURE_RETENTION_CRON` to `23 3 * * *`, staggered off notification retention's
  `7 3 * * *` so the two nightly sweeps do not contend.
- **The sweep deletes `ai_disclosure_audit` rows and nothing else.** Not `pm_digest`, not
  `cycle_digest`. The audit log is append-only and unbounded — a row per policy change, per
  generation, per publish, per retraction, forever — while a digest is one row per cycle per team,
  the same growth rate `cycle_digest` has had since change 9 without ever needing a sweep. Deleting
  a published digest would also silently remove something a reader was told they had.
- **An admin audit view over `ai_disclosure_audit`**, `GET /api/v1/ai/disclosures` behind the
  shipped `requireAdmin`, plus a read-only section on the AI settings page. Per-team totals and the
  recent events, in the `/verdicts` shape. It reports **what was disclosed and to how many readers**.
  There is no read log in the schema for it to surface, and this change does not add one.
- **A "your cycle digest is ready" notice to the named readers on publish, carrying a link only.**
  Written as `notification` rows of a new `pm_digest_published` kind (a new kind costs a TypeScript
  union member and a copy string, never a migration — `0013_notifications` says so in its header),
  which gives the reader an in-app inbox row and gives the mail path an at-most-once `email_sent_at`
  stamp without a schema change.
- **A second delivery sweep for those rows, never a widening of the notification one.** The shipped
  sweep's selection carries a **current-access predicate — team membership OR workspace admin** — and
  a PM reader is neither. Teaching that SQL about the disclosure axis would put a second copy of the
  entitlement rule in a second place, which `db/pm-disclosure.ts` opens by warning against. So the
  new sweep re-resolves entitlement through the **one** resolver, `resolvePmAudienceTeamIds`, at send
  time: a reader dropped from the audience, a team switched off, or the kill switch set between
  publish and sweep means no mail.
- **The mail body is a link and yapm-computed metadata.** Team name, cycle name, and a button to
  `/digests`. No summary, no highlight, no risk flag, no evidence label — asserted against the
  rendered output, not against the template source. Off by default at the instance floor
  (`AI_PM_DIGEST_READY_EMAIL=false`), cleanly absent with no transport configured, and suppressed
  per recipient by the shipped `email_notifications` preference.
- **A mechanical `.env.example` ↔ Zod check.** PROCESS.md §2 claims one exists; it does not. This
  change adds it, with a declared exception list for the compose-set and container-set variables, so
  the agreement this change's three new variables need is enforced rather than asserted.
- **"Auditable" and "retention-bounded" become sayable**, and the docs change 20 wrote around the
  prohibition are swept for phrasing that now reads awkwardly. Said accurately: the window is one
  year and configurable, and the view shows disclosure events, not reads.

## Capabilities

### Modified Capabilities

- `pm-digest`: adds the retention bound on the disclosure audit log, the admin audit view, and the
  publish-time ready notice with its link-only rule and its re-resolved entitlement.
- `notifications`: adds a second subject type (`pm_digest`) and a second notification kind, and
  narrows the shipped delivery sweep's selection to issue-subject rows so the two selections are
  provably disjoint.
- `email-delivery`: adds a second template and a second sweep under the existing provider-neutral
  mailer, with the same clean-disablement rule.

## Impact

- **Schema/migrations**: none. `ai_disclosure_audit` and `pm_digest` ship in `0021_pm_digest`;
  `notification.kind` and `notification.subject_type` carry no CHECK by design.
- **Server**: `apps/server/src/jobs/` (a disclosure retention block and a ready-email sweep on the
  shared boss), `apps/server/src/ai/admin-routes.ts` (one admin-gated GET), `apps/server/src/config/env.ts`
  (three variables plus one cross-field refinement), `apps/server/src/index.ts` (wiring).
- **Schema package**: `db/pm-disclosure.ts` (the sweep's delete and the audit read),
  `db/notification.ts` (the pm-subject selection, beside the existing one), `zero/context.ts` (the
  kind and subject type), `zero/notifications/copy.ts`, `zero/server-mutators.ts` (the publish
  fan-out).
- **Email**: `packages/email/src/pm-digest-ready.tsx` and its export.
- **Web**: the AI settings page gains one read-only section; the inbox gains one subject-type case.
- **APIs**: `GET /api/v1/ai/disclosures`, additive under `/api/v1`.
- **Config**: `AI_DISCLOSURE_RETENTION_DAYS`, `AI_DISCLOSURE_RETENTION_CRON`,
  `AI_PM_DIGEST_READY_EMAIL`.
- **Docs**: `apps/docs/src/content/docs/self-hosting/ai-disclosure.md` (new — the disclosure model
  end to end), `features/pm-digest.md`, `self-hosting/ai-setup.md`, `self-hosting/email.md`,
  `README.md`, `ROADMAP.md`, `VISION.md`, `PROCESS.md` (§2's mechanical-check claim becomes true),
  `.env.example`.
