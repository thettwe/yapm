# pm-digest-areas — product areas from file metadata, no patch content

## Why

The AI cycle digest shipped in change 9 can only see **issue titles and pull-request titles**.
Migration `0009_connectors` stores no PR body, no labels, no commit table, no file paths and no
diffs (`packages/schema/src/migrations/0009_connectors.ts:72–89`), so the digest is a re-voiced
list of ticket titles. That is the honest state of the feature and it is not yet the product.

The missing signal is *where the work landed*. GitHub already knows, and yapm is already
authorized to ask: GitHub's own docs for *List pull requests files* state *"The fine-grained token
must have the following permission set: 'Pull requests' repository permissions (read)"* — and the
connector docs have required **Pull requests: Read-only** since change 5
(`apps/docs/src/content/docs/self-hosting/github-connector.md:41–50`). Verified against the live
docs, not assumed; see design.md §"Verified before relying on it".
Turning those file paths into yapm-computed **product-area labels** is what moves the digest from
"a list of ticket titles" to "auth and billing moved, checkout did not, and something touched a
sensitive area".

**Why now, and why before the disclosure machinery.** `openspec/SCOPE-ai-features.md` sequenced
this change after `pm-digest-boundary` (change 20). The maintainer reordered the family after the
scoping pass established that 20 alone ships a PM a re-voiced ticket list: **build the substance
first, then reassess whether a second authorization axis is worth it with something real to look
at.** This change therefore ships entirely to the **existing team-internal cycle digest** and is
useful whether or not the PM-facing boundary is ever built. It takes on none of change 20's
irreversible permission or schema work.

Vision principles served: the **work-graph wedge** (delivery reality, not a bolt-on report),
**team-level metrics only** (a path is not a person, and no per-person dimension is added), and
**three containers** (no new service, no new table, no migration).

## What Changes

- **`GithubRestClient` gains `pulls.listFiles`.** The narrow hand-written interface at
  `apps/server/src/connectors/github/reconcile.ts:58` is extended with one method, called
  **transiently inside the digest job and discarded**. Nothing from the response is persisted.
  **No new GitHub App permission and no re-consent** — verified against the shipped docs.
- **The `patch` field is dropped at the client seam.** `GET /pulls/{n}/files` returns a `patch`
  string per file *whether or not you ask for it*, alongside `blob_url`, `raw_url` and
  `contents_url` (confirmed in `@octokit/openapi-types` `diff-entry`). The projection keeps
  exactly `filename`, `status` and `changes` and drops everything else **at the boundary** — not
  downstream, not before the prompt. The test mock **returns a `patch` field** so a test can
  assert it never survives; a mock that omits it proves nothing.
- **An admin-editable path→area map**, stored in the existing admin-gated
  `connector_config.config` jsonb — **no migration, no new table, no new crypto**. Not in
  `connector_installation.repo_mapping`, which is typed `Record<string, string>` and read as
  `repo_mapping ->> ${repoFullName}` (`packages/schema/src/db/connector.ts:386`); growing its
  value shape would break a live SQL read.
- **Paths become area labels BEFORE the model runs.** The map converts file paths into
  yapm-computed area labels during fact assembly, so **raw paths never enter the model's context
  at all**. This is the same structural move as removing the identity dimension, and it is much
  stronger than a post-filter.
- **`buildCycleFacts` gains area and size fields** — area grouping, change-size bands,
  touched-sensitive-area risk flags, and an "N internal improvements" collapse count. Every field
  is **strictly additive and optional**, identity-free, and yapm-computed; the model never
  supplies a number. `feat/retro-ai-draft` consumes `buildCycleFacts` concurrently, so no existing
  field is renamed, restructured or reshaped.
- **A runtime disclosure validator** — a structural sibling of `dropItemsNamingMembers` — drops
  any digest item whose text contains a `/`-bearing path token, a source-file extension, a
  backtick fence, or an `identifier.method()` shape. It lands here because this is where
  path-shaped strings first exist anywhere in the pipeline, and because PR *titles* already
  contain them sometimes ("fix `src/auth/session.ts` leak").
- **A rate-limit answer, stated rather than implicit.** The feature costs **zero** GitHub API
  calls until an admin configures at least one area rule; it is bounded by a per-cycle call cap;
  and it stops early when the installation's `x-ratelimit-remaining` header drops below a floor.

**Explicitly not changing:** patch content still never reaches the model
(`openspec/SCOPE-ai-features.md` §5, declined with reasons, not deferred). No new synced entity,
no mutator, no migration, no new env var.

## Non-goals

- **Patch/diff content in the model's context.** Declined in scope §5 and re-declined here: it
  needs a secret-scanning control that does not exist in-stack (a hand-rolled regex as a *security
  boundary* is exactly the "looks fine, fails quietly" case CLAUDE.md #6 exists to prevent), and
  it inverts a shipped guarantee — `ai-agent` §"worst case is a bad paragraph, never a bad action
  or a leak" stops being true once source text can reach an output that crosses a permission
  boundary. Reversing it is a human call and would be its own change behind its own switch.
- **The PM audience, the `pm_digest` row, the audience map, the kill switch and
  `ai_disclosure_audit`.** All of that is change 20. This change adds no reader who cannot already
  read the digest.
- **Commit messages, PR bodies, labels, or any new ingested column.** No migration.
- **Persisting anything from `listFiles`** — no cache table, no derived-area column. Asserted.
- **Per-person anything.** `listFiles` responses carry no author, and the projection would drop it
  if they did. No `review.author`, no commit author, no `assignee_id` is read on this path.
- **Exporting the digest as a customer changelog.** Scope §5; yapm is not an everything-app.
- **Globs or regexes in the area map.** Prefix rules only — see design D3.

## Capabilities

### New Capabilities

- `product-areas`: the admin-editable path→area map (its storage, its matching semantics, its
  admin surface) and the guarantee that mapping happens before the model runs, so raw file paths
  never enter an AI context.

### Modified Capabilities

- `cycle-digest`: the team-level cycle-facts read gains identity-free area, change-size and
  sensitive-area fields; the digest run gains a deterministic disclosure validator; the digest
  prompt gains the area altitude and the internal-improvements collapse.
- `connectors`: the narrow REST client gains `pulls.listFiles` under the already-granted
  permissions, with a mandatory boundary projection and a bounded rate-limit draw.
- `ai-agent`: the structural injection story gains one property — a yapm-computed **label
  substitution** performed before the call, and a deterministic disclosure validator after it.

## Impact

**Affected code**

- `packages/schema/src/zero/areas.ts` (new): area-map Zod schema, pure prefix matcher, change-size
  bands.
- `packages/schema/src/zero/cycle-facts.ts`: additive area/size fields on `CycleFactsPr`,
  `CycleIssueFacts` and `CycleFacts`; a `withCycleAreas` pure sibling of `buildCycleFacts`.
- `packages/schema/src/zero/digest.ts`: `dropItemsDisclosingPaths` (+ `contentDisclosesPaths`).
- `packages/schema/src/db/ai-config.ts`: `areas` added to `AiConfigData` and `RedactedAiStatus`.
- `packages/schema/src/db/cycle-facts.ts`: `pullRequestSourcesForCycleFacts` — an explicit-column
  read of `(id, repo, number, installation_id)` for the PRs already in the facts.
- `packages/schema/src/index.ts`, `src/db/index.ts`: exports.
- `apps/server/src/connectors/github/reconcile.ts`: `pulls.listFiles` on `GithubRestClient`,
  `x-ratelimit-remaining` on the response headers type.
- `apps/server/src/connectors/github/files.ts` (new): the boundary projection + the rate budget.
- `apps/server/src/connectors/github/service.ts`, `index.ts`: expose the installation client to
  the digest job without exporting octokit.
- `apps/server/src/ai/areas.ts` (new): the transient enrichment step.
- `apps/server/src/ai/digest.ts`: prompt altitude, area facts in the input block, the disclosure
  validator in the pipeline.
- `apps/server/src/jobs/scheduler.ts`, `apps/server/src/index.ts`: wiring on the **existing**
  pg-boss scheduler — no second `boss.start()`, no new queue.
- `apps/server/src/ai/admin-routes.ts`: the area map on the existing admin-gated AI settings
  routes.
- `apps/web/src/settings/ai.ts`, `apps/web/src/settings/ai-view.tsx`: the keyboard-operable,
  token-styled area-map editor.

**APIs**: `/api/v1/ai` (existing, admin-gated) gains `areas` in its GET payload and accepts it in
its POST body. Additive within the major.

**Dependencies**: none added. `octokit` already ships `pulls.listFiles`.

**Schema**: no migration. No Zero schema change. No new synced entity. The drift test is
unaffected.

**Docs**: `apps/docs/src/content/docs/features/cycle-digest.md` (product areas, size bands,
sensitive-area flags, the internal-improvements collapse, and an explicit statement of what the
model does and does not see); `apps/docs/src/content/docs/self-hosting/ai-setup.md` (configuring
the product-area map, and the GitHub rate-limit draw); `apps/docs/src/content/docs/self-hosting/github-connector.md`
(that the digest reads changed-file *metadata* under the existing Pull requests: Read-only
permission, that no re-consent is needed, and that patch content is never read). Root docs:
`README.md` (feature list), `ROADMAP.md` (row 21 status and the family reorder),
`openspec/SCOPE-ai-features.md` (record that 21 ships before 20 and why). **No `.env.example`
change** — the rate budget is a constant, not an operator knob.
