# pm-digest-areas — tasks

Ordered so the app runs after every task. Groups 1–5 are the build pass; 6 is tests; 7 is docs.

## 1. The pure area layer in `packages/schema`

- [x] 1.1 Create `packages/schema/src/zero/areas.ts`: `areaRuleSchema`
      (`{ prefix: string.min(1), area: string.min(1), sensitive?: boolean, internal?: boolean }`),
      `areaMapSchema = z.array(areaRuleSchema).default([])`, the exported reserved label
      `UNMAPPED_AREA = 'unmapped'`, `CHANGE_SIZE_BANDS = ['xs','s','m','l','xl']`, a pure
      `changeSizeBand(totalChanges: number): ChangeSizeBand` (xs <10, s <50, m <250, l <1000, xl
      ≥1000), and a pure `matchArea(rules, path): AreaRule | null` that normalizes the path (strip
      leading `./` and `/`, lowercase-compare) and returns the **first** matching prefix. Literal
      prefixes only — no glob, no regex. Zero imports beyond `zod`.
- [x] 1.2 Add `areasForPaths(rules, paths): { areas: string[]; sensitive: string[]; internalOnly: boolean }`
      to the same file: every path maps to a rule's `area` or to `UNMAPPED_AREA`; `internalOnly` is
      true only when the path list is non-empty and every matched rule is `internal`. Deduplicate
      and sort labels so output is deterministic.
- [x] 1.3 Extend `packages/schema/src/zero/cycle-facts.ts` **additively only** — no rename, no
      restructure, no changed shape for an existing caller (`feat/retro-ai-draft` consumes this
      file concurrently):
      - `CycleFactsPr` gains `readonly areas?: readonly string[]` and
        `readonly changedLines?: number`.
      - `CycleFactsInput` gains `readonly areaCatalog?: readonly AreaDefinition[]`
        (`{ area, sensitive?, internal? }`).
      - `CycleIssueFacts` gains `readonly areas?: readonly string[]` and
        `readonly sizeBand?: ChangeSizeBand`.
      - `CycleFacts` gains `readonly areas?: readonly CycleAreaFacts[]`
        (`{ area, issueCount, prCount, sensitive }`), `readonly touchedSensitiveAreas?: readonly string[]`,
        `readonly internalImprovements?: number`, and `readonly areaCoverage?: { enriched: number; skipped: number }`.
- [x] 1.4 Add one internal `deriveAreaFacts` helper in `cycle-facts.ts` and two entry points into
      it: `buildCycleFacts` populates the new fields when its input carries area data, and a new
      exported pure `withCycleAreas(facts, { prAreas, catalog, coverage })` layers them onto an
      already-built `CycleFacts`. Internal-improvement issues stay in `facts.issues`; the collapse
      is the count only. When no area data is supplied every new field stays `undefined`.
- [x] 1.5 Add `dropItemsDisclosingPaths(content)` and `contentDisclosesPaths(content)` to
      `packages/schema/src/zero/digest.ts` as structural siblings of `dropItemsNamingMembers`:
      same walker, drop the item, blank the headline, remove emptied sections. Leak shapes: a
      `/`-bearing path token (a segment carrying a file extension, or ≥2 slashes, or a segment in
      `src|apps|packages|lib|test|tests|node_modules|dist`), a source-file extension, any backtick,
      an `identifier.method()` shape. Non-match allowlist: `CI/CD`, `I/O`, `A/B`, `and/or`,
      `<digits>/<digits>`, and date forms. Do **not** copy `rosterNameNeedles` or add a second
      cite-or-omit walker.
- [x] 1.6 Add `areas: areaMapSchema` to `aiConfigDataSchema` in
      `packages/schema/src/db/ai-config.ts`, surface it on `RedactedAiStatus`, and confirm
      `upsertAiConfig` still leaves the stored map untouched when `config` is omitted.
- [x] 1.7 Add `pullRequestSourcesForCycleFacts(db, teamId, prIds)` to
      `packages/schema/src/db/cycle-facts.ts`: an **explicit column list** of
      `pull_request.(id, repo, number, installation_id)` joined to
      `connector_installation.external_installation_id`, filtered by `team_id`, ordered by
      `pull_request.id`. Never `selectAll()`.
- [x] 1.8 Export the new public surface from `packages/schema/src/index.ts` and
      `packages/schema/src/db/index.ts`. `pnpm turbo typecheck` is green and the existing digest
      behaviour is unchanged.

## 2. The provider seam

- [x] 2.1 Extend `GithubRestClient` in `apps/server/src/connectors/github/reconcile.ts` with
      `pulls.listFiles({ owner, repo, pull_number, per_page })` returning
      `GithubRestResponse<{ filename: string; status: string; changes: number }[]>`, and add
      `'x-ratelimit-remaining'?: string` to `GithubRestResponse['headers']`. Declare only the
      fields read — a wider real response satisfies it structurally.
- [x] 2.2 Create `apps/server/src/connectors/github/files.ts` with the closed type
      `ChangedFile = { path: string; status: string; changes: number }` (no field can hold patch
      content), a `projectChangedFile` that is the **only** constructor of it, and
      `listChangedFiles(client, owner, repo, number)` that maps every entry through the projection
      before returning. Export `MAX_PR_FILE_CALLS = 50` and `RATE_LIMIT_FLOOR = 500`, and return
      the observed remaining quota so the caller can stop.
- [x] 2.3 Expose the installation client to non-connector callers without leaking octokit: add a
      narrow `changedFilesReader` accessor to the `GithubConnector` surface
      (`apps/server/src/connectors/github/service.ts` + `index.ts`) that resolves an external
      installation id to a client and calls `listChangedFiles`. Absent GitHub App env ⇒ the
      accessor is `null`, exactly like the rest of the connector's disabled path.

## 3. Transient enrichment inside the existing digest job

- [x] 3.1 Create `apps/server/src/ai/areas.ts` with
      `enrichCycleFactsWithAreas(deps, { workspaceId, facts }): Promise<CycleFacts>`:
      read the workspace AI config; **return `facts` unchanged and make zero provider calls when
      `areas` is empty or the reader is null**; otherwise read the PR sources
      (`pullRequestSourcesForCycleFacts`), call `listChangedFiles` **serially** in ascending PR-id
      order up to `MAX_PR_FILE_CALLS`, stop when remaining quota < `RATE_LIMIT_FLOOR`, map paths
      through `areasForPaths` and `changeSizeBand`, then return `withCycleAreas(...)`. Persist
      nothing. Never throw: any error logs and returns the un-enriched facts.
- [x] 3.2 Wire it into `apps/server/src/jobs/scheduler.ts`: the existing `CYCLE_DIGEST_QUEUE`
      worker calls `enrichCycleFactsWithAreas` immediately before `runCycleDigest`. Add the
      optional reader to `DigestSchedulerOptions`. No new queue, no second `boss.start()`, no new
      cron.
- [x] 3.3 Wire the reader through `apps/server/src/index.ts` — `github.changedFilesReader` into
      `cycles.digest`. The digest still runs (un-enriched) when the connector is disabled.

## 4. Prompt altitude and the disclosure validator in the run

- [x] 4.1 Extend `DIGEST_SYSTEM_PROMPT` in `apps/server/src/ai/digest.ts`: describe work by
      product-area label; never emit a file path, filename, extension, code fence or code
      identifier; collapse internal-area work into one "N internal improvements" line using the
      supplied count. Keep the existing rules verbatim.
- [x] 4.2 Extend `buildDigestInput` to state the area grouping, size bands, touched sensitive
      areas and internal-improvement count in the **trusted computed values** section — outside
      the untrusted fence — and to omit the whole area paragraph when the facts carry no area
      layer.
- [x] 4.3 Apply `dropItemsDisclosingPaths` in `runCycleDigest` after `dropItemsNamingMembers`.

## 5. The admin area-map surface

- [x] 5.1 Accept `areas` in the `configBody` Zod schema of `apps/server/src/ai/admin-routes.ts`
      and return it from the GET. Admin-gated by the existing middleware; a non-admin is rejected
      before the map is read.
- [x] 5.2 Add the `areas` field to `apps/web/src/settings/ai.ts`'s mirrored types and request
      helpers.
- [x] 5.3 Add the area-map editor section to `apps/web/src/settings/ai-view.tsx`: an ordered list
      of `prefix → area` rows with `sensitive` / `internal` toggles, add, remove, and **keyboard**
      move-up / move-down (order is semantic — first match wins). Tokens only, AA contrast, correct
      in all three presets light and dark, fully operable without a pointer. Explain the reserved
      `unmapped` label and that an empty map means no provider calls.

## 6. Tests

- [ ] 6.1 Unit (`packages/schema/src/zero/areas.test.ts`): first-match-wins ordering; case and
      leading-slash normalization; an unmatched path yields `unmapped` and never the raw path; an
      empty rule set yields `unmapped` for everything; every `changeSizeBand` boundary.
- [ ] 6.2 Unit (`packages/schema/src/zero/cycle-facts.test.ts`, extended): the area aggregates,
      sensitive set, and internal-improvement count; internal-improvement issues remain in
      `facts.issues`; **a facts object built with no area input is deep-equal to the pre-change
      output** (the additivity guard `feat/retro-ai-draft` depends on).
- [ ] 6.3 Unit (`packages/schema/src/zero/digest.test.ts`, extended): each of the four leak shapes
      drops its item; the headline blanks but clean items survive; every allowlisted form
      (`CI/CD`, `I/O`, `A/B`, `and/or`, `24/7`, `14/30`, `2026/07/28`) is retained; an emptied
      section is removed.
- [ ] 6.4 Unit (`apps/server/src/connectors/github/files.test.ts`): **the mock returns `patch`,
      `blob_url`, `raw_url`, `contents_url`, `sha`, `additions`, `deletions`** — assert the
      projected value has exactly three keys and that a JSON serialization of the result contains
      none of the dropped values.
- [ ] 6.5 **The falsifiable check** (`apps/server/src/ai/areas.test.ts`): mocked
      `pulls.listFiles` returns a file named `apps/server/src/billing/refund.ts` **with a `patch`
      field**; the area map is `apps/server/src/billing/ → Billing (sensitive)`; a mocked gateway
      captures its arguments and echoes back an item whose summary is
      "hardened `src/auth/session.ts`". Assert, all in one test: the captured `{system, input}`
      contains no patch text, no `refund.ts`, no `apps/server/src/billing`, no `.ts`; it does
      contain `Billing`; the stored digest content contains no item mentioning
      `src/auth/session.ts`; and no row anywhere records a filename.
- [ ] 6.6 Unit (`apps/server/src/ai/areas.test.ts`): zero provider calls when the area map is
      empty; the call cap truncates deterministically and still produces a digest; a remaining
      quota below the floor stops enrichment mid-run; a throwing provider yields a `ready`
      un-enriched digest, never `failed`.
- [ ] 6.7 Integration (`packages/schema/src/db/cycle-facts.pg.test.ts`, extended):
      `pullRequestSourcesForCycleFacts` returns exactly the four columns for the team's PRs and
      nothing for another team's; `describe.skipIf(DATABASE_URL === undefined)`.
- [ ] 6.8 Integration (`packages/schema/src/db/ai-config.pg.test.ts` or the existing AI-config pg
      test): the area map round-trips through `connector_config.config`; updating the spend cap
      alone leaves it intact; a non-admin context is rejected.
- [ ] 6.9 Per PROCESS.md §3's big-feature rule this change touches at most one of {synced
      entity/schema, mutator, permission surface, signature UI} — **no new Playwright e2e**.
      Confirm the existing e2e suite still passes unchanged.
- [ ] 6.10 `pnpm turbo lint typecheck test build` green; `check-boundaries` green (no UI import in
      `packages/schema`, no octokit import outside `apps/server/src/connectors`).

## 7. Documentation

- [ ] 7.1 `apps/docs/src/content/docs/features/cycle-digest.md`: product areas, change-size bands,
      sensitive-area flags, the "N internal improvements" collapse, and an explicit **what the
      model sees / does not see** section stating that patch content is never read.
- [ ] 7.2 `apps/docs/src/content/docs/self-hosting/ai-setup.md`: configuring the product-area map
      (ordered prefixes, first match wins, `sensitive` and `internal`, the reserved `unmapped`
      label), and the GitHub rate-limit draw with its three bounds and the fact that an empty map
      costs nothing.
- [ ] 7.3 `apps/docs/src/content/docs/self-hosting/github-connector.md`: the digest reads
      changed-file **metadata** under the already-required Pull requests: Read-only permission —
      no new permission, no re-consent, nothing persisted, patch content never read.
- [ ] 7.4 `README.md` feature list; `ROADMAP.md` row 21 status **and** a note that the family was
      reordered (21 ships before 20, to the existing team-internal digest); `openspec/SCOPE-ai-features.md`
      records the reorder and why. State in the PR that `.env.example` is deliberately unchanged —
      the rate budget is a constant, not an operator knob.
- [ ] 7.5 `pnpm --filter @yapm/docs build` passes and no root doc is left stale.
