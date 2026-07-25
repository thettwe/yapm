## 1. Dependencies and scaffolding

- [x] 1.1 Add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai` (Apache-2.0) to the pnpm catalog (`pnpm-workspace.yaml`) at their verified versions and reference them as `catalog:` from `apps/server`; confirm no `jose`/TS-Compiler-API/AGPL-incompatible tree is pulled in; `pnpm install` and `pnpm turbo build` stay green.
- [x] 1.2 Add the optional AI env vars to the server Zod env schema (`AI_ANTHROPIC_API_KEY`, `AI_GOOGLE_API_KEY`, `AI_OPENAI_API_KEY`, `AI_DEFAULT_PROVIDER`, `AI_DIGEST_ON_CYCLE_CLOSE`) via the existing `optionalString`/enum patterns with `EXPECTED_FORMAT` entries; add an `aiEnv(env)` helper mirroring `githubAppEnv`; absent env leaves AI disabled and boot unaffected.

## 2. Schema: config reuse, digest entity, drift

- [x] 2.1 Add typed AI-config helpers in `packages/schema` that read/write the `provider = "ai"` `connector_config` row (`{ enabled, defaultProvider, models, spendCapUsd }`) and per-provider `connector_secret` keys through the EXISTING connector accessors — no new table, no new crypto.
- [x] 2.2 Forward-only migration `0010_ai` adding the team-scoped, synced `cycle_digest` table (`id`, `team_id`, `cycle_id`, `status`, `content` jsonb, `provider`, `model`, `generated_at`, `input_token`, `output_token`, `estimated_cost_usd`); add it to the hand-written `DB` interface and the Zero schema; the app boots and migrates cleanly.
- [x] 2.3 Extend the schema-drift test to cover `cycle_digest`; confirm the AI secret/config rows remain excluded from the Zero schema (reused connector tables).
- [x] 2.4 Add the team-scoped synced query for `cycle_digest` (membership `whereExists`, deny-by-empty, viewers read) and a server-only accessor to write it over the authoritative write path (client-read-only, no client mutator).

## 3. Schema: substrate contract (typed output, validators, team-facts query)

- [x] 3.1 Define the typed digest output schema (sections + per-item `{ kind, summary, evidenceRefs[], confidence }`) as a Zod schema in `packages/schema`.
- [x] 3.2 Implement the cite-evidence-or-omit validator (drops any item with empty `evidenceRefs`) as a pure function.
- [x] 3.3 Implement the deterministic name-validator (rejects output naming a workspace member's name/handle) as a pure function taking the roster.
- [x] 3.4 Implement `cycleFactsForTeam(teamId, cycleId)` emitting team-level aggregates + per-issue evidence bundles with NO assignee/author/reviewer/user dimension, reusing existing team-level metric computations; numbers computed here, not by any model.

## 4. Schema: agent-as-actor tool registry

- [x] 4.1 Generate the AI-SDK tool registry from `defineMutators` (one tool per mutator, `inputSchema` = the mutator's exported Zod args schema) plus read-only tools over the named queries; types live in `packages/schema` with no SDK/UI import.
- [x] 4.2 Add the tool-ceiling predicates + `activeTools` selection helpers (write/destructive tools flagged `needsApproval`, reads auto-run, least-privilege per task) and the audit shape (actor = agent, on-behalf-of = user).

## 5. Server: the gateway wrapper

- [x] 5.1 Implement `resolveModel(workspaceId, provider?)` in `apps/server/src/ai/gateway.ts` — read the `ai` config, decrypt the provider key from the connector secret surface (per request, server memory only), construct the AI-SDK provider model, return null when disabled/unconfigured.
- [x] 5.2 Implement `generateStructured(...)` (`generateObject` with a Zod schema; no tools; every provider-side external tool off) returning `{ object, usage, cost }`.
- [x] 5.3 Implement `runAgent(...)` (`generateText` + tools + `stopWhen: stepCountIs(n)`; `needsApproval`-gated writes; `execute` invokes the shared mutator under the invoking user's `AuthContext`; UUIDv7 minted at the call site) — built as foundation, not used by the digest.
- [x] 5.4 Add the updatable server-side model+price table + spend math (usage × price, labeled "estimated"), the per-workspace running total, and the optional spend-cap refusal.
- [x] 5.5 Wire the AI-SDK mock provider so build/test needs no real key or network.

## 6. Server: admin AI REST surface

- [x] 6.1 Extend the server-only admin REST surface with AI routes (`canManage`-gated): toggle, write-only masked key entry, model + default-provider selection, spend cap; return redacted status (never key material), reusing the connectors admin-surface pattern.

## 7. Server: cycle-digest pre-compute job

- [x] 7.1 On cycle close (in the existing pg-boss cycle-maintenance path), enqueue a digest job for the completed cycle under the system principal, gated by `AI_DIGEST_ON_CYCLE_CLOSE`.
- [x] 7.2 Implement the job: `cycleFactsForTeam` → `generateStructured` → cite-or-omit + name-validator → write a `ready` `cycle_digest`; write `ai_off` when AI is disabled/keyless/spend-capped, `failed` on error; bounded + rate-limited per workspace, off the hot path.

## 8. Web: admin AI settings + cycle-digest surface

- [x] 8.1 Build the admin AI settings view (enable toggle, masked key entry, per-provider model + workspace default, spend cap, running-total display) over the admin REST surface — keyboard-first, all three themes, tokens only, non-admins never see it.
- [x] 8.2 Build the cycle-view digest panel: typed sections + items with evidence links opening the issue/PR/check/deploy, AI-generated + model + estimated-cost framing, render-safe (no auto-loaded remote content) — keyboard-first, all three themes, tokens only.
- [x] 8.3 Build the AI-off raw-evidence fallback on the cycle view (completed/carried issues + linked PRs + CI/deploy + scope delta) shown when the digest is absent/`ai_off`/`failed`.

## 9. Unit tests (Vitest, no DB)

- [x] 9.1 `resolveModel` selection across providers + disabled/unconfigured returns null.
- [x] 9.2 Cite-evidence-or-omit validator drops uncited items; keeps cited ones.
- [x] 9.3 Name-validator rejects output naming a roster member; passes clean output.
- [x] 9.4 Spend math (usage × price) and spend-cap refusal.
- [x] 9.5 Tool-registry generation over `defineMutators` (one tool per mutator, correct arg schema) + tool-ceiling/`activeTools` predicates.
- [x] 9.6 `cycleFactsForTeam` result carries no assignee/author/reviewer/user dimension.

## 10. Integration tests (Vitest, live Postgres + zero-cache)

- [x] 10.1 Admin AI config authz end-to-end (admin writes; member/viewer rejected; key never returned).
- [x] 10.2 Assert no synced query ever returns an AI provider key/ciphertext (server-only surface).
- [x] 10.3 Agent under a viewer `AuthContext` cannot write (mutator rejects); a write tool surfaces an approval request rather than auto-applying.
- [x] 10.4 Digest pre-compute job (mock provider) writes a team-scoped `ready` `cycle_digest`; a non-member of the team cannot sync it; AI-off path writes `ai_off`.

## 11. E2E tests (Playwright, mock provider, real 3-container stack)

- [x] 11.1 Admin configures a (mock) key → toggles AI on → opens a completed cycle → sees the digest; evidence links open the referenced entity; full keyboard flow across all three themes.
- [x] 11.2 Toggle AI off (or unconfigured) → the cycle view renders the AI-off raw-evidence fallback; opening the cycle is never blocked.

## 12. Documentation

- [x] 12.1 `apps/docs`: a self-hoster **AI setup** page (enable AI, enter a provider key, choose a model, the optional instance-default env + `SECRETS_ENCRYPTION_KEY`, spend/estimated-cost notes, BYO-key privacy, AI-off behavior) under Self-hosting, linked from the sidebar/home.
- [x] 12.2 `apps/docs`: a user-facing **Cycle digest** feature page (what it summarizes, team-level/blameless, evidence links, AI-off fallback), linked from the sidebar/home; `pnpm --filter @yapm/docs build` passes.
- [x] 12.3 Update `.env.example` with the new optional AI vars (matching the Zod schema exactly — drift check passes) with comments that absent = disabled.
- [x] 12.4 Update root docs made stale: `README.md` (status + feature list), `ROADMAP.md` (#9 status), `TECHSTACK.md` (AI SDK catalog additions + the BYO-key gateway/agent-as-actor/substrate decisions and the three-container/no-new-service reaffirmation).

## 13. Close-out

- [x] 13.1 `pnpm turbo lint typecheck test build` green; compose smoke test passes; walk every scenario in the change's specs and confirm it holds.
