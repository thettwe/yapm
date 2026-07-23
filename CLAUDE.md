# yapm — working agreement

Read before writing code. Keep this file short; details live in the linked docs.

## Orientation

| Doc | Answers |
|---|---|
| [VISION.md](VISION.md) | Why yapm exists, who it's for, what it refuses to be |
| [TECHSTACK.md](TECHSTACK.md) | Every technology choice and its rationale; pinned version baseline |
| [ROADMAP.md](ROADMAP.md) | Locked v1 scope and the change sequence |
| [`reference/`](reference/) | **Verified API notes for the stack — read these before writing code** |
| [`openspec/`](openspec/) | Specs: `changes/<name>/` is in-flight work, `specs/` is current behavior |

## Critical: the stack postdates your training data

Zero 1.0 (June 2026), TypeScript 7 (July 2026), Vite 8, pnpm 11, Tailwind 4.3,
better-auth 1.6, Kysely 0.28, TanStack Router 1.170 — **all newer than your training
cutoff.** Writing these APIs from memory produces confident, fluent, wrong code.

- Consult `reference/*.md` for real signatures before using any of these libraries.
- If `reference/` doesn't cover what you need, **fetch the real docs** (WebFetch, firecrawl,
  context7) or read the installed package's `.d.ts` in `node_modules`. Do not guess.
- Rocicorp's `zbugs` app is a bug tracker built on Zero by Zero's authors — the closest
  reference implementation to yapm that exists.

**Concrete example of the trap:** Zero 1.x's API is `defineQuery` / `defineQueries` /
`defineMutator` / `defineMutators` / `createBuilder` / `handleQueryRequest` /
`handleMutateRequest`. A model working from memory will instead emit `syncedQuery`,
`PushProcessor`, and `definePermissions` — the 0.x names. That code is fluent, plausible,
and completely non-functional. See [`reference/zero.md`](reference/zero.md) §"Correctness
gotchas" before writing any sync code.

## Non-negotiable constraints

These come from VISION.md and are enforced in CI. A change that violates one is wrong even
if it works:

1. **Three containers.** Self-hosting is `app` + `zero-cache` + `postgres`. No Redis, no
   Elasticsearch, no MinIO, no reverse proxy requirement.
2. **All ZQL and all mutators live in `packages/schema`.** Client and server import the
   same mutator function. This keeps the sync layer swappable.
3. **Packages never import apps.** `packages/schema` has no UI dependencies.
4. **Client-generated UUIDv7 primary keys, minted at the mutator call site** — never inside
   a mutator body. Mutators re-run during rebase, so an ID generated inside one changes
   between runs and corrupts the optimistic result.
5. **Dependency versions only in the pnpm catalog** (`pnpm-workspace.yaml`), referenced as
   `catalog:`. Three pins are load-bearing: **kysely stays on 0.28.17** (Zero's peer range;
   0.29 is breaking), **no `kysely-codegen`** (silently emits uncompilable output under
   TS7 — the `DB` interface is hand-written), and watch for the **`jose` collision** where
   Zero wants v5 and better-auth wants v6.
6. **No tools that import the TypeScript Compiler API** — it doesn't exist in TS7's Go
   build. That rules out typescript-eslint, ts-morph, vite-plugin-dts, knip. Biome only.
7. **Free means free.** No seat caps, no SSO tax, no license-key gates, no upsell UI.
   Viewer role is free and unlimited.
8. **Metrics are team-level only.** Never individual leaderboards or per-person scorecards.
9. **Sub-100ms interactions.** If a common interaction newly waits on the network, that's
   a bug.
10. **Keyboard-first.** Every interactive surface is fully operable without a pointer.

## Conventions

- Conventional Commits with DCO sign-off: `git commit -s -m "feat: ..."`
- Forward-only Kysely migrations, applied automatically at boot (plus better-auth's
  `getMigrations()` for auth tables). The Zero schema is hand-written and guarded by a CI
  drift test against the live Postgres schema.
- Env-only configuration, validated with Zod at startup, failing fast with the variable name.
- Public REST API under `/api/v1`, additive-only within a major.
- Match surrounding code style; Biome decides formatting. No comments explaining what a
  line does or why a change was made — only constraints the code can't express.

## Implementing an OpenSpec change

Work through `openspec/changes/<name>/tasks.md` in order — tasks are sequenced so the app
runs after each one. Check boxes off as you complete them. The specs in that change
directory are the acceptance criteria; every scenario should be true when you're done.

**When you hit something the specs didn't anticipate** — ambiguous product decision, a
library that doesn't behave as documented, a missing requirement:

> Make the call that best fits VISION.md, then record it in the change's `design.md` under
> a `## Decisions made during implementation` section: what was ambiguous, what you chose,
> and why. Then keep going.

Don't stall waiting for a human, and don't silently paper over it. The log is what makes
the decision reviewable and reversible later.

## Verification

Before considering a task done: `pnpm turbo lint typecheck test build`.
For anything touching deployment or sync: the compose smoke test must pass.
Report failures honestly with the actual output — never claim a gate passed without running it.
