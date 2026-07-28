# pm-digest-areas — design

## Context

Change 9 shipped the AI substrate and its flagship consumer, the team-internal cycle digest:
`cycleFactsForTeam` → `buildCycleFacts` → `generateStructured` → `dropUncitedItems` →
`dropItemsNamingMembers` → a server-only `cycle_digest` write. Every guarantee in it is
**structural**: the model cannot name a person because no identity column is ever selected, and it
cannot invent a number because every number is computed before the call.

What it cannot do is say *where* the work landed. `pull_request` stores
`(id, team_id, installation_id, provider, repo, number, external_id, title, state, url, head_sha,
opened_at, merged_at)` and nothing else. There is no body, no label, no commit, no path, no diff.

This change adds exactly one new signal — the **set of files each merged PR touched** — and spends
it entirely on making it *safe*: the paths are converted to yapm-computed area labels before the
model runs, and never persisted.

Two constraints shape everything below.

1. **`feat/retro-ai-draft` is building concurrently and consumes `buildCycleFacts`.** Every change
   to `cycle-facts.ts` here is strictly additive: new optional fields, no renames, no
   restructuring, no changed shape for an existing caller. Whoever merges second rebases.
2. **`GET /pulls/{n}/files` returns a `patch` field unasked.** Confirmed in the installed
   `@octokit/openapi-types` `diff-entry` schema: `filename`, `status`, `additions`, `deletions`,
   `changes`, `sha`, `blob_url`, `raw_url`, `contents_url`, `patch?`, `previous_filename?`. Four
   of those (`patch`, `blob_url`, `raw_url`, `contents_url`) are content or content pointers.

### Verified before relying on it

The "no new permission" claim was checked against GitHub's live docs, not inferred:

- **Permission.** *"The fine-grained token must have the following permission set: 'Pull requests'
  repository permissions (read)"* — GitHub REST docs, *List pull requests files*, API version
  2022-11-28. yapm's connector docs already require **Pull requests: Read-only**
  (`apps/docs/src/content/docs/self-hosting/github-connector.md:41–50`), so this is inside the
  granted set with room to spare — **Contents: Read-only is not even needed for it.** No new
  permission, no re-consent.
- **`patch` cannot be suppressed.** The same page documents `patch` in the response schema and
  offers **no parameter to exclude it**. Dropping it is therefore the client's job, which is D2.
- **Response bounds.** *"Responses include a maximum of 3000 files. The paginated response returns
  30 files per page by default"*, `per_page` up to 100. Hence `per_page: 100` and the no-pagination
  decision in D7.
- **`pulls.listFiles` exists on the installed client** — present in
  `@octokit/plugin-rest-endpoint-methods@17.0.0`'s generated `method-types.d.ts`, which is the
  version octokit already resolves in this workspace. No dependency change.

## Goals / Non-Goals

**Goals**

- The digest can group work by product area, band it by change size, and flag when a sensitive
  area was touched — all from metadata yapm already has permission to read.
- Raw file paths never enter the model's context. Not filtered out afterwards: **never put in**.
- Nothing from `listFiles` is persisted anywhere.
- The `buildCycleFacts` extension is invisible to every existing caller.
- The new GitHub API draw is bounded, and the bound is stated rather than discovered in an
  incident.

**Non-Goals**

- Patch content in front of the model (scope §5 — declined, with reasons, not deferred).
- The PM reader, the disclosure boundary, the audience map, the audit table (change 20).
- Any new synced entity, mutator, migration, container, env var or dependency.
- Any per-person dimension. A path is not a person; a commit author is. Nothing on this path reads
  a commit, a review, or `review.author`.

## Decisions

### D1 — Enrichment runs inside the existing `CYCLE_DIGEST_QUEUE` worker, not at enqueue

`cycleFactsForTeam` is called at enqueue time in two places (`jobs/cycles.ts:112` and
`jobs/scheduler.ts:412`), and the resulting `CycleFacts` is serialized into pg-boss job data. The
`listFiles` calls happen **in the digest worker**, immediately before `runCycleDigest`.

*Why.* The digest queue is already `batchSize: 1`, which serializes the GitHub calls for free —
and `reference/connectors.md` §3.3 quotes GitHub's own guidance verbatim: *"you should make
requests serially instead of concurrently."* Enriching at enqueue would instead put unbounded
network I/O inside the cycle-maintenance pass, where a slow GitHub response delays every other
team's rollover.

*Alternative rejected:* changing the job payload to `{workspaceId, teamId, cycleId}` and rebuilding
the facts in the worker. That would silently break the pre-rollover fact guarantee documented in
`db/cycle-facts.ts` (facts are computed *before* issues roll over; recomputing later gives
different, wrong answers for a scheduler-closed cycle).

*Consequence:* the worker needs `(repo, number, installation_id)` per PR, which `CycleFacts`
deliberately does not carry. It gets them from a new explicit-column read,
`pullRequestSourcesForCycleFacts(db, teamId, prIds)` selecting exactly
`pull_request.(id, repo, number, installation_id)` — no `title`, no author-adjacent column, no
`selectAll()`. Same discipline as `cycleFactsForTeam`, for the same reason.

### D2 — The projection is a function at the client seam, and the mock returns `patch`

`apps/server/src/connectors/github/files.ts` exports:

```
projectChangedFile(entry: unknown): ChangedFile   // { path, status, changes }
listChangedFiles(client, owner, repo, number): Promise<ChangedFile[]>
```

`listChangedFiles` maps every response entry through `projectChangedFile` **before returning**, so
no caller can ever hold an unprojected entry. `ChangedFile` is a closed three-field type — it has
no `patch` field to assign to, so a future edit that tried to carry it would not compile.

The `GithubRestClient` interface declares the response element as exactly the three fields it
reads. **The test mock returns the full GitHub shape** — `patch`, `blob_url`, `raw_url`,
`contents_url`, `sha`, `additions`, `deletions` — precisely so a test can assert none of them
survive. A mock that omits `patch` proves nothing; that is the difference between a guard and a
comment.

*Why declare a narrow response type when the mock returns more?* Structural typing means a wider
object satisfies a narrower interface, which is exactly the real-world condition (octokit returns
the wide shape). Declaring the narrow type documents intent; the runtime projection is what
enforces it; the test is what proves it.

### D3 — Prefix rules, ordered, first match wins. No globs, no regex

An area rule is `{ prefix, area, sensitive?, internal? }`. Matching is case-insensitive on a
normalized path (leading `./` and `/` stripped), first match in list order wins, and a path that
matches nothing maps to the reserved label `unmapped`.

*Why not globs or regex.* A regex typed into an admin form is an untyped denial-of-service surface
(catastrophic backtracking) and needs its own validation story. A glob library is a dependency for
a problem a prefix solves: repositories are directory trees, and product areas are directories.
`apps/server/src/billing/` → `Billing` is the whole requirement.

*Why `unmapped` rather than passing the path through.* A fall-through that leaked the raw path
would destroy the entire safety claim on the first repository whose layout the admin had not
finished mapping. The reserved label is the safe default and it is the *only* default.

*Ordering matters and is explicit:* `apps/server/src/billing/` must be able to win over
`apps/server/`, so rules are an ordered array (not a record), and the admin editor lets an admin
reorder them by keyboard.

### D4 — The map lives in the `ai` connector-config row, not the `github` one

`AiConfigData` (`packages/schema/src/db/ai-config.ts`) gains `areas: AreaRule[]` (default `[]`).
It is stored in the `config` jsonb of the `connector_config` row with `provider = 'ai'`, read
through the existing `getAiConfig`, and written through the existing admin-gated `upsertAiConfig`.

*Why the `ai` row and not the `github` row.* The map exists solely to shape what an AI pipeline
sees; it is an AI-pipeline input, not a connector setting. It must apply unchanged when a second
code connector (GitLab) supplies paths. And the `ai` row already has an admin-gated, Zod-typed,
redacted-status HTTP surface (`/api/v1/ai`) that this slots into without inventing one.

*Why not `connector_installation.repo_mapping`.* That column is typed `Record<string, string>` and
read with `repo_mapping ->> ${repoFullName}` (`db/connector.ts:386`). Growing its value shape
breaks a live SQL read. Scope §6 flags this; it stays flagged.

*No migration.* `connector_config.config` is already `jsonb`, already admin-gated, already
server-only, and never syncs through Zero.

### D5 — `buildCycleFacts` is extended additively; `withCycleAreas` is the worker's entry point

New **optional** fields:

| Type | Added field | Computed by |
|---|---|---|
| `CycleFactsPr` (input) | `areas?: readonly string[]`, `changedLines?: number` | the enrichment step |
| `CycleFactsInput` | `areaCatalog?: readonly AreaDefinition[]` | the enrichment step |
| `CycleIssueFacts` | `areas?: readonly string[]`, `sizeBand?: ChangeSizeBand` | yapm |
| `CycleFacts` | `areas?: readonly CycleAreaFacts[]`, `touchedSensitiveAreas?: readonly string[]`, `internalImprovements?: number` | yapm |

Every one is optional, so `feat/retro-ai-draft` and both existing enqueue sites compile and behave
identically. Absent enrichment, every new field is `undefined` and the digest is byte-identical to
today's.

Because the worker holds a built `CycleFacts` rather than a `CycleFactsInput` (D1), the pure
entry point it calls is `withCycleAreas(facts, { prAreas, catalog })`. `withCycleAreas` and
`buildCycleFacts` both delegate to **one** internal `deriveAreaFacts` helper, so the two entry
points cannot drift.

**Change-size bands** are computed from `changes` (GitHub's own additions+deletions per file),
summed per PR: `xs` <10, `s` <50, `m` <250, `l` <1000, `xl` ≥1000. The digest carries the **band**,
not the raw churn — a band is the decision-grade fact and a raw line count invites the model to
editorialize about it.

**The "N internal improvements" collapse is a computed count, not a removal.** Issues whose PRs
touch only `internal: true` areas are counted into `internalImprovements` and **stay in
`facts.issues`**. The *prompt* asks the model to collapse them into a single line; the *facts* keep
the team's own digest complete. Removing them from the facts would be right for a PM reader and
wrong for the team that did the work — and change 20 can act on the same field more aggressively
without a second computation.

### D6 — The disclosure validator runs on every digest, starting now

`dropItemsDisclosingPaths(content)` is an exact structural sibling of `dropItemsNamingMembers`:
same walker, same "drop the item, blank the headline, remove emptied sections" behavior, same
purity. It is applied in `runCycleDigest` after the name validator.

It drops an item whose text contains any of:

1. a **path token** — a `/`-bearing token where a segment carries a file extension, or the token
   has ≥2 slashes, or a segment is a well-known source directory (`src`, `apps`, `packages`,
   `lib`, `test`, `tests`, `node_modules`, `dist`);
2. a **source-file extension** (`.ts .tsx .js .jsx .mjs .cjs .py .go .rs .rb .java .kt .swift .c
   .h .cpp .cs .php .sql .sh .yml .yaml .toml .json .css .scss .html .vue .svelte`);
3. a **backtick** of any kind;
4. an **`identifier.method()`** shape.

With an explicit non-match allowlist, tested: `CI/CD`, `I/O`, `A/B`, `and/or`, `24/7`, `14/30`,
`2026/07/28`, and any `<digits>/<digits>` pair. A short all-caps pair separated by a slash is not
a path.

*Why apply it to the team-internal digest, which is entitled to see paths.* Three reasons, in
order. (a) The alternative is dead code awaiting change 20 — and a validator that has never run is
a validator that does not work. (b) Once yapm hands the model area labels instead of paths, a
path-shaped string in the output can only come from an injected or echoed PR title, or a
hallucination; neither is content the team's own digest wants. (c) It drops one *item*, never the
digest, and the AI-off raw-evidence fallback still shows the team every linked entity.

*Alternative rejected:* a config flag. Defaulting it off is the same as dead code; defaulting it
on is the same as applying it, with an extra knob to get wrong. retro-board D7's refusal of
knobs-on-principle applies.

*Honest limit, stated:* this validator is **defense in depth, not the boundary.** The boundary is
structural — raw paths are never in the context. That distinction is exactly why a heuristic is
acceptable here and why the declined patch-content secret-scanner was not: there, the regex would
have been the *only* control.

### D7 — Rate budget: zero until configured, capped per cycle, floor-aware

Scope §9.13 flags an unmeasured new draw on the same installation rate limit with no existing
accounting to extend. The answer, in three parts, all in `files.ts`:

1. **Zero-cost until opted in.** If the workspace's `areas` map is empty, the enrichment step
   returns immediately and makes **no API calls at all**. The feature costs nothing until an admin
   decides it is worth something.
2. **A per-cycle call cap** (`MAX_PR_FILE_CALLS = 50`, a constant, not an env var — following the
   scheduler's stated rule that "everything an operator would plausibly turn is one", and this is
   not). PRs are enriched in a deterministic order (ascending PR id) so a truncated run is
   reproducible; the un-enriched remainder simply has no area data and the facts say how many were
   skipped.
3. **A remaining-quota floor.** `GithubRestResponse.headers` gains
   `'x-ratelimit-remaining'?: string` (documented in `reference/connectors.md` §3.4). When it drops
   below `RATE_LIMIT_FLOOR = 500`, enrichment stops for that run and logs it. Reconciliation is
   the connector's load-bearing sweep; a digest must never be the thing that starves it.

No pagination beyond the first page of 100 files. A PR touching more than 100 files is banded `xl`
from what was seen and its area set is marked partial. Paginating to 3000 files to refine a label
that is already "big and everywhere" is not worth the quota.

### D8 — The admin surface is the existing AI settings view

The area-map editor is a section of `apps/web/src/settings/ai-view.tsx`, over the existing
admin-gated `/api/v1/ai` routes: an ordered list of `prefix → area` rows with `sensitive` and
`internal` toggles, add/remove/reorder, all keyboard-operable (reorder via buttons, not
drag-only), every color and spacing from theme tokens, correct in all three presets light and
dark. Non-admins never reach it — `ConnectorsView`'s `canManage` gate shape.

### D9 — Injection properties, re-checked against `ai-agent` §78

1. **No egress from the AI step.** The `listFiles` call is yapm-initiated, completes **before**
   `generateStructured`, is never exposed as a tool, and its result is discarded. The gateway is
   still called with no `ToolSet`. The model has no way to cause a fetch.
2. **Typed output only.** `digestContentSchema` is unchanged.
3. **Numbers computed by yapm.** Bands, counts, `internalImprovements`, area membership — all
   computed here. The model narrates.
4. **Team-level aggregation, no individual.** `listFiles` responses carry no author field, and the
   projection would drop it if they did. No commit, review or assignee column is read on this
   path.

## Risks / Trade-offs

- **A `patch` string reaches the model through a future refactor** → The projection is the only
  constructor of `ChangedFile`, the type has no field to hold it, and a test asserts absence
  against a mock that supplies one. Merge-blocking.
- **An unmapped repository produces a digest full of `unmapped`** → It degrades to today's
  behavior (titles only) rather than leaking; the docs tell admins to seed the map from their top
  directories, and the digest simply omits an area section with nothing in it.
- **The disclosure validator eats a legitimate internal item** → The false-positive allowlist is
  tested; the drop is per-item, never per-digest; the raw-evidence fallback is untouched. This is
  the trade named in D6 and it is the maintainer's to overturn.
- **A misconfigured `sensitive` flag creates alarm fatigue** → It is admin-set and admin-visible,
  and the flag reports "a sensitive area was touched", never a judgement about the change.
- **The GitHub draw starves reconciliation** → D7's three bounds. The floor is the load-bearing
  one.
- **A rebase conflict with `feat/retro-ai-draft`** → Every `cycle-facts.ts` edit is additive and
  append-only within the file. Whoever merges second rebases.
- **Area labels are directory names wearing a costume** → Real. Whether "auth and billing moved,
  checkout did not" reads as product insight or as a `tree` command depends on the map a human
  writes. Named in Open Questions; not agent-checkable.

## Migration Plan

No migration. No Zero schema change. No env var.

Deploy is a normal rolling deploy: the new `areas` key is absent from every existing
`connector_config.config` blob, `aiConfigDataSchema` defaults it to `[]`, and an empty map means
zero API calls and a byte-identical digest. Rollback is a redeploy; the stored map is inert data
that a rolled-back build simply ignores (the Zod parse tolerates unknown keys the same way it
tolerates a legacy blob today).

## Open Questions

1. **Are the area labels actually useful?** Read three real digests from real cycle data against a
   hand-written map and say whether "auth and billing moved, checkout did not" is insight or a
   directory listing. This is the question the reorder exists to answer, and it cannot be answered
   from the code. *(Scope §9, the reordered version of item 1.)*
2. **Should the disclosure validator apply to the team-internal digest?** D6 says yes and gives
   three reasons. A maintainer who values a team seeing `refund.ts` in its own digest more than
   the validator having live coverage should overturn D6 — and change 20 then inherits an unproven
   validator.
3. **Is the PM audience worth a second authorization axis at all?** Explicitly deferred to after
   this change ships, which is the whole reason for the reorder. *(Scope §9.3.)*
4. **Reverse the patch-content decline?** Unchanged and still human. *(Scope §9.2.)*
5. **Should `MAX_PR_FILE_CALLS` ever become an env var?** D7 says no. A self-hoster on a
   15,000/hour Enterprise limit with 200-PR cycles may disagree.

## Decisions made during implementation

**`projectChangedFile` takes the declared element type, not `unknown`.** D2 sketched
`projectChangedFile(entry: unknown)`. The seam only ever receives values typed by
`GithubRestClient`'s own narrow declaration, so an `unknown` parameter would have added a runtime
narrowing step that could only fail on a shape TypeScript already rejects. The parameter is typed
`{ filename, status, changes }`; structural typing means the wide octokit object still satisfies it
and the explicit three-field construction is what drops everything else. The guarantee D2 asks for —
"no caller can hold an unprojected entry" — is unchanged, and `ChangedFile` still has no field able
to carry patch content.

**`areaCatalogFromRules` was added to `zero/areas.ts`.** The tasks name `areaCatalog` on
`CycleFactsInput` but not how the enrichment step obtains one. Deriving it from the ordered rules in
the same pure module (collapsing duplicate labels, flag-set-anywhere-wins) keeps the rules the single
source of truth; the alternative — the worker hand-building a catalog — would have let the map and
the catalog disagree about which area is sensitive.

**`splitRepoFullName` and a `repoFullName` reader parameter.** `pull_request.repo` stores GitHub's
full name (`owner/repo`), so the reader takes that string and splits it at the connector boundary
rather than making every caller know the provider's naming convention. An unsplittable value returns
an empty file list instead of throwing — enrichment is best-effort and must never fail the digest.

**The disclosure validator has no maintained allowlist.** D6 lists `CI/CD`, `I/O`, `A/B`, `and/or`,
`24/7`, `<digits>/<digits>` and dates as non-matches. Implementing them as a literal allowlist would
be a list that goes stale the first time someone writes `pass/fail`. Instead the three leak
sub-rules D6 names (a segment carrying a source extension, ≥2 slashes, a segment in the source-dir
set) are the only things that match, with an all-numeric-segments check running first so
`2026/07/28` is not caught by the ≥2-slash rule. Every form D6 names is retained as a consequence of
the rules rather than as an exception to them, which is what task 6.3 asserts.

**`withCycleAreas` records coverage even when nothing was derived.** If a run made calls but every
PR came back with no mapped files, `areaCoverage` is still attached so a reader can tell "enrichment
ran and found nothing" from "enrichment never ran". `buildCycleFacts` never sets it, so the
additivity guard is untouched.

**The admin route replaces the area map wholesale.** Every other field in `configBody` merges. The
area map cannot: order is semantic (first match wins), so merging an array would silently change
which rule applies. Omitting `areas` leaves the stored map exactly as it was, which is what keeps a
spend-cap edit from clobbering it.

**`reconcile.test.ts`'s client mock gained a `listFiles` stub.** `pulls.listFiles` is a required
member of `GithubRestClient`, so the existing structurally-typed mock no longer compiled. The stub
resolves an empty list and is never called by reconciliation.

**The path-token trim now strips a trailing dot (a real defect the allowlist test found).** Task 6.3
requires `2026/07/28` to survive the disclosure validator. It did not: the token trim kept `.` in its
allowed set so that an extension mid-token stayed intact, which left a sentence-final date as
`2026/07/28.` — three segments, the last non-numeric, so the ≥2-slash rule fired. The trim now keeps
only word characters and `/` at the edges, so surrounding punctuation of any kind is stripped while
interior dots (the extension rule's whole job) are untouched. This is the case that justifies writing
the allowlist as an assertion rather than as a comment.

**`enrichCycleFactsWithAreas` is unit-tested with `vi.mock('@yapm/schema/db')`, not a live database.**
The three behaviours that matter most — the 50-call cap, the mid-run rate-limit stop, and the
degrade-to-un-enriched failure path — cannot be provoked by writing rows; they need a harness that
controls what the provider returns and when. This follows the precedent `apps/server/src/jobs/
search-tail.test.ts` set for exactly the same reason. The two things that genuinely need Postgres get
their own gated files: `packages/schema/src/db/cycle-facts.pg.test.ts` proves
`pullRequestSourcesForCycleFacts` returns only its projected fields and only the team's own rows, and
`packages/schema/src/db/ai-config.pg.test.ts` proves the map round-trips through
`connector_config.config` (reading the raw jsonb column, and asserting no `repo_mapping` row was
created) and is refused for a non-admin.

**The falsifiable check runs the REAL seam, not a stubbed reader.** `apps/server/src/ai/areas.test.ts`
builds its `ChangedFilesReader` from the actual `listChangedFiles` over an octokit-shaped mock whose
response carries `patch`, `blob_url`, `raw_url`, `contents_url` and `sha`. A stubbed reader would have
tested the enrichment loop against a type that cannot hold patch content in the first place — which
proves nothing. It then asserts one chain end to end: the patch enters, `apps/server/src/billing/
refund.ts` becomes `Billing`, the captured `{system, input}` contains `Billing` and none of the patch
text / the path / the bare `.ts`, and an item the model echoed back naming `src/auth/session.ts` is
absent from the stored row.

**`pullRequestSourcesForCycleFacts` is asserted at five keys, not four.** Task 6.7 says "four
columns", meaning the four `pull_request` columns; the joined `external_installation_id` makes five
fields on the returned object. The test asserts the exact five-key set, which is the property that
matters (no title, no `head_sha`, no identity column can arrive by accident).

**No new docs page; three existing pages grew.** PROCESS.md §2 asks for the pages this change adds.
This change adds no surface a reader would look for under a new title — it deepens the cycle digest,
the AI setup guide and the GitHub connector guide — so all three were extended in place and the
sidebar is unchanged. `.env.example` is deliberately untouched: the call cap and the rate-limit floor
are safety bounds on a shared budget, not operator preferences, so they are constants.

**`reference/connectors.md` gained §3.6.** The harvest had the rate-limit facts but nothing about
`GET /pulls/{n}/files`, which is the endpoint this whole change rests on. The new section records the
verified permission level, the 3000-file ceiling, the `per_page` maximum, the full Diff Entry field
list, and the fact that GitHub documents no parameter suppressing `patch` — verified against
docs.github.com on 2026-07-28, not recalled.
