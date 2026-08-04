## 1. Migration and database types

- [ ] 1.1 Add `AI_DISCLOSURE_EVENTS` (`policy_changed | generated | published | unpublished`) and the
      derived plain-string `AI_DISCLOSURE_EVENT_CHECK` to `packages/schema/src/zero/context.ts`,
      following `AI_ARTIFACT_STATUS_CHECK` (no Kysely import — this module reaches the client bundle).
- [ ] 1.2 Write `packages/schema/src/migrations/0021_pm_digest.ts` creating `pm_digest`: `id` uuid pk;
      `cycle_id` uuid not null → `cycle(id)` on delete cascade, **unique**; `team_id` uuid not null →
      `team(id)` on delete cascade; `status` text not null default `'pending'` check
      `AI_ARTIFACT_STATUS_CHECK`; `content` jsonb; `provider` text; `model` text; `input_token` int;
      `output_token` int; `estimated_cost_usd` double precision; `generated_at` timestamptz;
      `published_at` timestamptz; `published_by` uuid → `user(id)` on delete set null;
      `audience_size_at_publish` int; `created_at`/`updated_at` timestamptz not null default `now()`.
      Index on `team_id`, and on `(team_id, published_at)`.
- [ ] 1.3 In the same migration create `ai_disclosure_audit`: `id` uuid pk; `workspace_id` uuid not
      null → `workspace(id)` on delete cascade; `team_id` uuid → `team(id)` on delete set null;
      `actor_id` uuid → `user(id)` on delete set null; `event` text not null check
      `AI_DISCLOSURE_EVENT_CHECK`; `pm_digest_id` uuid → `pm_digest(id)` on delete set null; `detail`
      jsonb not null default `'{}'::jsonb`; `created_at` timestamptz not null default `now()`. Index
      on `(workspace_id, created_at desc)` and on `team_id`. `down` drops both tables.
- [ ] 1.4 Register `0021_pm_digest` in `packages/schema/src/migrations/index.ts` (do NOT take `0020`
      — a concurrent change owns it) and add both tables to `packages/schema/src/db/types.ts`.

## 2. Sync schema and the omission asymmetry

- [ ] 2.1 Add the `pm_digest` table to `packages/schema/src/zero/schema.ts` with exactly these
      columns: `id`, `teamId`, `cycleId`, `status`, `content` (optional json), `provider`, `model`,
      `generatedAt`, `publishedAt`, `audienceSizeAtPublish`, `createdAt`, `updatedAt`. **No
      relationships of any kind.** Carry a header comment stating D1 and D8: the row relates to
      nothing because a related row is an ungated second disclosure, and a new column must be safe
      for a reader outside the team or it is server-only.
- [ ] 2.2 Do NOT add `input_token`, `output_token`, `estimated_cost_usd` or `published_by` to the
      sync schema, and do NOT add `ai_disclosure_audit` at all.
- [ ] 2.3 Extend `packages/schema/src/db/schema-drift.test.ts`: the two new table shapes, four new
      entries in `ZERO_OMITTED_COLUMNS` (`pm_digest.input_token`, `.output_token`,
      `.estimated_cost_usd`, `.published_by`), an assertion that `ai_disclosure_audit` is absent from
      the Zero schema in the style of the existing `retro_card_author` assertion, and the CHECK-text
      assertions for both new constraints.

## 3. Disclosure policy: config, resolver, audit writer

- [ ] 3.1 Extend `aiConfigDataSchema` in `packages/schema/src/db/ai-config.ts` with the
      `pmDisclosure` object from design D4 (`enabled`/`killed` booleans defaulting false; `teams`
      record keyed by team id of `{pmVisible, audience[]}`), and make `EMPTY_CONFIG` and the legacy
      `parseConfig` fallback produce the all-off shape.
- [ ] 3.2 Add `packages/schema/src/db/pm-disclosure.ts` with `resolvePmAudienceTeamIds(db, userId):
      Promise<string[]>` implementing D4's collapse (non-member ⇒ `[]`; no config row ⇒ `[]`;
      `!enabled` ⇒ `[]`; `killed` ⇒ `[]`; otherwise the sorted team ids where `pmVisible` and the
      audience contains the user), plus `pmTeamPolicy(db, workspaceId, teamId)` for the job's
      `pmVisible` check and `audienceSize(db, workspaceId, teamId)` for the publish stamp.
- [ ] 3.3 Add `recordDisclosureAudit(db, entry)` to the same module — the ONE writer of
      `ai_disclosure_audit`. Its `detail` parameter is typed to yapm-computed metadata only; assert
      in review and in a test that no call site passes digest content.
- [ ] 3.4 Add `setPmDisclosurePolicy(db, ctx, options)` — admin-gated through `upsertAiConfig` (which
      already goes through `upsertConnectorConfig`'s `canManage` gate), merging per-team entries
      rather than replacing the map, and writing one `policy_changed` audit row per call describing
      what changed. Surface the policy in `RedactedAiStatus` / `getRedactedAiStatus`.
- [ ] 3.5 Extend `getWorkspaceAiSpendUsd` in `packages/schema/src/db/cycle-digest.ts` with a fourth
      union arm over `pm_digest` where `status = 'ready'`. One `sum('estimated_cost_usd')` only —
      `scripts/check-boundaries.mjs` rule 4 fails a second.

## 4. The second authorization axis

- [ ] 4.1 Add `readonly pmAudienceTeamIds?: readonly string[]` to `AuthContext` in
      `packages/schema/src/zero/context.ts`. Optional, so every existing construction site including
      `SYSTEM_AUTH_CONTEXT` compiles unchanged and a pre-change credential denies.
- [ ] 4.2 Add `pmAudienceScoped` to `packages/schema/src/zero/queries.ts`, immediately below
      `teamScoped` and never inside it: deny unless `isMember`; deny when the audience is absent or
      empty; otherwise `.where('teamId', 'IN', ids).where('publishedAt', 'IS NOT', null)`. Carry the
      D2 comment — why it is separate, that it has NO admin bypass and why, that the published filter
      lives here so no future query can forget it, and what silently breaks if the two predicates are
      ever merged.
- [ ] 4.3 Add the `pmDigests` query group (audience axis, `pmAudienceScoped`): `byCycle({cycleId})`
      returning `.one()`, and `inbox()` ordered by `publishedAt desc` with a sync limit constant.
      **Neither relates to anything.** Export their query-name constants alongside the existing ones.
- [ ] 4.4 Add the `pmDigestReview` query group (producing team, `teamScoped`): `byCycle({cycleId})`
      `.one()`, any status, so the team reviews before anyone outside reads. Comment why one table
      carries two predicates and which is which.
- [ ] 4.5 Do not modify `teamScoped` or any existing query. Confirm with `git diff` that the only
      change to `queries.ts` is additive.

## 5. Credential plumbing

- [ ] 5.1 Extend `createSessionContextResolver` in `apps/server/src/zero/context.ts` with a
      `lookupPmAudience(userID)` option alongside `lookupRole`, folding the result into the resolved
      `AuthContext`. This is the authoritative copy `/query` evaluates against.
- [ ] 5.2 Wire the resolver in `apps/server/src/app.ts` / `index.ts` to `resolvePmAudienceTeamIds`.
- [ ] 5.3 Return the resolved audience from the sync-credential endpoint in
      `apps/server/src/auth-routes.ts` beside `role`.
- [ ] 5.4 Carry it through `apps/web/src/zero/session.ts` (parse defensively, exactly as `asRole`
      does) and `apps/web/src/zero/provider.tsx` into the memoized `AuthContext` and into
      `SyncSessionState`, so a surface can ask "is my audience empty" without issuing a query. Keep
      the memo keyed on values so a re-mint does not tear down the Zero client.

## 6. Publish and retract

- [ ] 6.1 Add `pmDigest.publish({id})` and `pmDigest.unpublish({id})` to
      `packages/schema/src/zero/mutators.ts`: `canWrite` + team access to the row's team, checked
      BEFORE any existence check; publish additionally requires `status === 'ready'` and
      `publishedAt === null`. Neither mints an id.
- [ ] 6.2 Add server overrides in `packages/schema/src/zero/server-mutators.ts` that, through the
      existing `(tx as ServerTransaction).dbTransaction.wrappedTransaction` seam, stamp
      `published_by` and `audience_size_at_publish` from `audienceSize(...)` and write the
      `published` / `unpublished` audit row in the same transaction.
- [ ] 6.3 Register both in the client `mutators` map and confirm `pm_digest` content/status/provider/
      model/token/cost fields have NO client mutator anywhere.

## 7. Generation

- [ ] 7.1 Add `packages/schema/src/zero/pm-digest.ts`: re-export `digestContentSchema` as the
      model-facing PM schema (D6 — the shape is reused verbatim, no new walker), define
      `storedPmDigestContentSchema` extending it with the yapm-authored `subject` and
      `evidenceLabels`, and add the pure `buildPmEvidenceLabels(facts)` producing `ENG-142 · PR #331`
      strings from `CycleFacts`.
- [ ] 7.2 Add `packages/schema/src/zero/pm-digest-writes.ts` with the server-only
      `upsertPmDigest(tx, ...)` Zero `Transaction` helper, re-exported from `@yapm/schema/server`
      only — never registered in the client `mutators` map (the `upsertRetroAiDraft` precedent).
- [ ] 7.3 Add `apps/server/src/ai/pm-digest.ts`: `PM_DIGEST_SYSTEM_PROMPT` (PM altitude — outcomes and
      product areas, no engineering internals, plus the identity, cite-or-omit, numbers-by-yapm,
      untrusted-data and no-path rules carried over from `DIGEST_SYSTEM_PROMPT`),
      `buildPmDigestInput(facts)` reusing the existing trusted-counts/untrusted-fence structure, and
      `runPmDigest(deps, input)` mirroring `runCycleDigest`: spend check → `generateStructured` (no
      tools) → `dropUncitedItems` → `dropItemsNamingMembers` → `dropItemsDisclosingPaths` → attach
      `subject` + `evidenceLabels` → write `ready` with `published_at` NULL. `ai_off` on null result
      or `AiSpendCapError`, `failed` on error.
- [ ] 7.4 Write one `generated` audit row on every terminal status, attributed to the system
      principal.
- [ ] 7.5 Extend the `CYCLE_DIGEST_QUEUE` worker in `apps/server/src/jobs/scheduler.ts` to run the PM
      pass after the internal one over the SAME already-built `CycleFacts`, short-circuiting before
      any model call when the team's `pmVisible` is false or the workspace switch/kill switch says no.
- [ ] 7.6 Add `AI_PM_DIGEST` (default `false`) to `apps/server/src/config/env.ts` with the D-I1
      cross-field refinement that fails at boot, naming both variables, when it is true while
      `AI_DIGEST_ON_CYCLE_CLOSE` is false. Thread it through `apps/server/src/index.ts`.

## 8. Admin policy surface

- [ ] 8.1 Extend `apps/server/src/ai/admin-routes.ts` with the PM-disclosure policy read and write
      over `setPmDisclosurePolicy`, admin-gated by the existing middleware plus the accessor's own
      `canManage` belt-and-braces.
- [ ] 8.2 Add the PM-disclosure block to the admin AI settings page in `apps/web/src/settings`:
      workspace switch, kill switch, and a per-team row with `pmVisible` and an audience picker over
      workspace members. Keyboard-first, theme tokens only, correct in all three presets light and
      dark at AA. Copy states plainly that the kill switch stops further reads and does not un-read.
- [ ] 8.3 After a successful policy write, call the provider's `refresh({fresh: true})` so the
      caller's own credential picks up an audience change without a reload.

## 9. Reader and producing-team surfaces

- [ ] 9.1 Add `apps/web/src/routes/digests.tsx` and the view under `apps/web/src/pm-digest/`. The
      route and its navigation entry MUST NOT render when the sync-session audience is empty, and no
      `useQuery` may be called in that case. Render the subject line, headline, sections, items and
      baked plain-text evidence labels, plus the "AI-generated · <model>" framing. No links from
      summarized content and no remote media.
- [ ] 9.2 Add the "Shared with product" card to the cycle view beside the existing digest panel
      (`apps/web/src/cycles/`): the full PM-facing text from `pmDigestReview.byCycle`, a **Publish**
      control when `ready` and unpublished, and after publish the "Shared with N readers outside this
      team" marker plus a **Retract** control whose copy states retraction does not un-read.
- [ ] 9.3 Offer no publish control for a `pending`, `failed` or `ai_off` row; say what happened
      instead.
- [ ] 9.4 Keyboard-first and token-only across both surfaces; verify in all three presets, light and
      dark, at AA contrast.

## 10. Tests

- [ ] 10.1 **Unit** — `pmAudienceScoped`: denies for a non-member, denies for an empty or absent
      audience, denies an unpublished row for a named reader, admits only the named teams. Assert
      explicitly that an `admin` context with an empty audience is denied.
- [ ] 10.2 **Unit** — `resolvePmAudienceTeamIds` over each of the four switches, including the legacy
      config blob parsing to all-off.
- [ ] 10.3 **Unit** — `buildPmDigestInput` contains no identity-shaped key at any depth; the gateway
      is called with no tools; `buildPmEvidenceLabels` renders `ENG-142 · PR #331` and yields nothing
      for an unknown id.
- [ ] 10.4 **Unit** — the publish/unpublish mutator gates: a viewer is rejected before any existence
      check; a non-`ready` row cannot publish; the response for a nonexistent id is identical to the
      response for an unauthorized one.
- [ ] 10.5 **Integration (pg)** — the falsifiable check, in one file: a workspace member with
      `role: 'viewer'` and no `team_membership` for the producing team. (a) with the default config,
      `pmDigests.byCycle` for a real cycle is byte-identical to the same query for a cycle id that
      never existed; (b) with the switches on and the reader named but the row unpublished, still
      zero; (c) after publish, exactly one row; (d) in the SAME test and for the SAME principal,
      `issues.byTeam`, `issues.mine`, `issues.detail`, `cycles.byTeam`, `labels.byTeam`,
      `deployments.byTeam`, `savedViews.byTeam`, `digests.byCycle`, `digests.byTeam`,
      `attachments.byIssue`, `retros.byTeam`, `triage.inbox` and `projects.get` all return zero rows
      for that team's data — the proof that
      `teamScoped` was not widened; (e) the published row's JSON contains no `/`-bearing path token,
      no source-file extension, no backtick and no roster needle.
- [ ] 10.6 **Integration (pg)** — one `ai_disclosure_audit` row per generation, per publish, per
      retract and per policy change; none of them contains any substring of the digest content.
- [ ] 10.7 **Integration (pg)** — `getWorkspaceAiSpendUsd` rises when a `ready` `pm_digest` is
      inserted.
- [ ] 10.8 **Integration (pg)** — the migration applies against a running zero-cache and both tables
      replicate; `ai_disclosure_audit` is nameable in no query.
- [ ] 10.9 **E2E** — the big-feature rule is met on all four counts (synced entity, mutator,
      permission surface, signature UI), so Playwright covers: with the default config no digests
      navigation entry or route exists and no disclosure query is issued; after an admin names a
      reader and a team member publishes, that reader reads it keyboard-only; the producing team's
      cycle view shows the "Shared with N readers" marker; retracting removes the reader's access.
- [ ] 10.10 Run `pnpm turbo lint typecheck test build` and the compose smoke test on the assigned
      ports (`POSTGRES_HOST_PORT=5444 ZERO_CACHE_HOST_PORT=4852 YAPM_HOST_PORT=3004`, project
      `yapm-pdb`); tear down with `down -v`.

## 11. Documentation

- [ ] 11.1 New `apps/docs/src/content/docs/features/pm-digest.md`: what it is, the four switches, the
      review-and-publish gate, why evidence is a label and not a link, what the producing team sees,
      and the honest statement that retraction does not un-read. **Do not use the words "auditable"
      or "retention-bounded"** — ROADMAP row 23 reserves them.
- [ ] 11.2 Add it to the docs sidebar and cross-link from `features/cycle-digest.md`.
- [ ] 11.3 Extend `self-hosting/ai-setup.md` with `AI_PM_DIGEST`, its default, its dependency on
      `AI_DIGEST_ON_CYCLE_CLOSE`, and the fact that a PM run is a second model call on the same
      BYO key.
- [ ] 11.4 Add `AI_PM_DIGEST` to `.env.example` (commented, showing the default).
- [ ] 11.5 Update `ROADMAP.md` row 20 to built, and `README.md` where it lists the AI features.
- [ ] 11.6 Append every implementation decision to `design.md` under
      "## Decisions made during implementation".
