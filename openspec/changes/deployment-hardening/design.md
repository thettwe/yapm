# Design — deployment-hardening

## Context

See `proposal.md` — Why. Four verified defects; this document records the choices that are not
obvious, and the two places where a defensible alternative was rejected for a reason a reviewer
should be able to argue with.

The state this has to fit into:

- `apps/server/src/config/env.ts` validates everything with Zod and fails fast **by variable name**.
  The precedent for a hard boot failure already exists: a partial GitHub App triplet exits non-zero
  naming the missing member. Optional integrations, by contrast, are cleanly disabled when unset and
  never crash boot. Both patterns are deliberate and both are load-bearing.
- `apps/server/src/health.ts` distinguishes `gatingCheck` (a failure is a verdict; the orchestrator
  takes the instance out of rotation) from `nonGatingCheck` (a failure is information, reported as a
  detail string). Storage is gating; search freshness is not.
- `apps/server/src/config/env-example.test.ts` asserts **set equality** between `.env.example`, the
  Zod schema and the `yapm` service's `environment:` block, modulo two literal, commented exception
  lists (`CONTAINER_SET`, `COMPOSE_ONLY`). Archived change `pm-digest-governance` §I11 added the
  third leg — a variable documented and validated but absent from compose is an instruction with no
  effect — and this change inherits that discipline.
- The self-host-deploy spec already requires: "Defaults SHALL be chosen so `docker compose up` still
  boots with an empty `.env`." That is a promise to evaluators, and §D2 below is where it collides
  with the security fix.
- `apps/web/vite.config.ts` proxies `/api`, `/healthz` and `/readyz` to the server in dev. Anything
  served under `/api` needs no new proxy rule.
- `ZeroRoot` in `apps/web/src/zero/provider.tsx` memoises the whole `ZeroOptions` object because
  `ZeroProvider` recreates the client — reopening IndexedDB, rehydrating every query — when any
  non-`auth` option changes identity. `cacheURL` is one of those options. Anything that makes
  `cacheURL` arrive asynchronously must not make it arrive *twice*.

## Goals

- An operator who follows the README cannot end up running on a published secret without being told,
  in words, which variable.
- A published image syncs on a real host with no rebuild.
- `edge` images exist.
- Upgrade and rollback are written down, and the rollback answer is true.

## Non-goals

See `proposal.md` — Non-goals. Chiefly: no down-migrations, no signing, no fourth container.

---

## D1 — The env-file fix is `--env-file .env` plus a generator, not a compose relocation

**Alternatives considered.**

1. Move `docker-compose.yml` to the repo root so Compose's project directory contains `.env`.
   Rejected: it breaks every documented path in four existing docs pages
   (`backup-restore.md`, `sync-recovery.md`, `search-index.md`) and every operator's muscle memory,
   for a fix that a flag achieves.
2. Add `env_file: ../.env` to each service. Rejected: `env_file` populates the *container's*
   environment, not Compose's **interpolation** context — `${POSTGRES_PASSWORD:-yapm}` in the compose
   file would still resolve to the default. It looks like a fix and is not one, which makes it worse
   than no fix.
3. `--env-file .env`, run from the repo root. **Chosen.** It sets the interpolation context, which is
   what `${VAR:-default}` reads, and `.env.example`'s own header already documents this exact form —
   the README simply never followed it.

`scripts/init-env.mjs` is the other half. `cp .env.example .env` alone leaves every secret at its
shipped value; the file the operator edits would be read, and would still say
`yapm-dev-secret-change-me-in-production`. The generator copies the example and replaces each
shipped-default secret with `crypto.randomBytes(32).toString('base64url')` (Node's own crypto, no
dependency). It refuses to overwrite an existing `.env`, and prints which variables it filled.

## D2 — Production refuses to boot on a defaulted secret; the escape hatch is one named variable

The instruction was to decide between warn and refuse, and log the decision. **Refuse**, with the
narrowest possible escape hatch.

The reasoning is asymmetric-cost: a warning about `BETTER_AUTH_SECRET` is a line in a log an operator
reads once, on a stack that comes up working. The failure mode it fails to prevent is *anyone who can
read the database, or who simply knows the published default, minting a sync JWT for any user* —
because that secret encrypts the JWKS private key at rest. A refusal costs a confused operator ten
minutes and a search; a warning costs a workspace.

**But** the self-host-deploy spec promises `docker compose up` boots with an empty `.env`, and
compose sets `NODE_ENV=production`. A bare refusal breaks that requirement, breaks the compose smoke
test, and — worse — makes the first thing an evaluator sees a crash. So:

- `NODE_ENV=production` **and** a security-relevant variable at its shipped default ⇒ exit non-zero
  before listening, naming every offending variable and pointing at `scripts/init-env.mjs`.
- `YAPM_ALLOW_INSECURE_DEFAULTS=true` downgrades that to a warning. It is documented as
  *evaluation only*, it names what it is permitting, and it is what the smoke test and the e2e stack
  set. Choosing it is an explicit act recorded in the operator's own env file — which is exactly the
  property the current silent default lacks.
- Outside production: warn by name, always, no flag needed.

The spec delta **amends** the "boots with an empty `.env`" requirement rather than leaving it
quietly false: it now says the stack boots with an empty `.env` *when insecure defaults are
explicitly permitted*, and refuses otherwise.

**Which variables.** Only those the server process can actually observe:
`BETTER_AUTH_SECRET`, `ZERO_QUERY_API_KEY`, `ZERO_MUTATE_API_KEY`, and the password embedded in
`DATABASE_URL` (shipped default `yapm`). `ZERO_ADMIN_PASSWORD` is read by the zero-cache container
and never reaches the app; adding it to the `yapm` service's environment purely to detect it would
be a variable that does nothing, which the env-example test exists to prevent. It is covered by the
hardening page's checklist and by `init-env.mjs`, which does fill it. Recorded here because a
reviewer will otherwise read its absence as an oversight.

**Severity is uniform, not tiered.** A tempting refinement is "fatal for `BETTER_AUTH_SECRET`, warn
for the Zero API keys". Rejected: the Zero keys authorise the query and mutate endpoints that the
sync layer speaks to, and an instance whose defaults are public on two of four axes is not a
hardened instance. One rule, one flag, one message.

## D3 — The sync origin is fetched from `/api/config`, not injected into `index.html`

**Alternatives considered.**

1. Inject `window.__YAPM__` into the served `index.html` in `apps/server/src/static.ts`. Rejected on
   two counts. It requires the server to *rewrite* the SPA's HTML on every request, which means
   `serveStatic`'s index path can no longer be handed straight to Hono and the SPA fallback grows a
   template step; and it makes the origin unavailable to `pnpm dev`, where Vite serves `index.html`
   itself and the server never sees it — so dev and prod would resolve the origin by two different
   mechanisms, which is how the two come to disagree.
2. `GET /api/config`, fetched before the client is constructed. **Chosen.** One mechanism in dev and
   in production (Vite already proxies `/api`), no HTML rewriting, and it is inspectable with `curl`
   — which matters for defect 2 specifically, where the whole problem was a misconfiguration nothing
   could observe.

**The ordering hazard, handled explicitly.** `ZeroRoot` must not construct a client before the origin
is known: a client built on a placeholder would open a socket to the wrong host, then be torn down
and rebuilt when the real value landed — reopening IndexedDB and rehydrating every query, which is
precisely the churn `ZeroRoot`'s memoisation exists to prevent. So the fetch happens **above**
`ZeroRoot`, in a `RuntimeConfigGate`, and `ZeroRoot` does not mount until the config resolves. While
it is in flight the gate renders a **neutral boot shell** — the app's background and nothing else,
no spinner that flashes on a fast local fetch, no error copy. Only after the retries are exhausted
does it render a named failure that says `/api/config` out loud.

The response is `Cache-Control: no-store`. A cached `/api/config` would survive a change of origin
in exactly the deployment where the origin just changed.

**`VITE_ZERO_CACHE_URL` is deleted, not deprecated.** Leaving it as a fallback would leave a
build-time constant on the connection path, and a fallback that silently takes over is the failure
this change exists to remove. The default now lives once, in the Zod schema
(`ZERO_CACHE_PUBLIC_URL` defaults to `http://localhost:4848`), so `pnpm dev` is unchanged with no
web-side default at all.

## D4 — `publish` is decoupled with `if: ${{ !cancelled() }}`, not with a second workflow

A version tag pushed by `GITHUB_TOKEN` does **not** trigger a new workflow run, so "publish on tag
push" as a separate workflow would silently never fire — the same class of bug as defect 3, freshly
introduced. Keeping one job that still declares `needs: release-please` (for the version outputs)
and adding `if: ${{ !cancelled() }}` is the minimal change with the right semantics: release-please
failing no longer blocks `edge`/`sha-`, and `release_created` is simply empty in that case, so the
version/`stable`/`latest` tags are correctly skipped. `!cancelled()` rather than `always()` so a
cancelled run does not publish.

The underlying repo setting ("Allow GitHub Actions to create and approve pull requests") is a
maintainer action no agent can take. This change does not pretend otherwise; it makes the setting
non-blocking for images and says so in SECURITY.md.

## D5 — The configuration reference is bound to the schema by the existing mechanical check

Two spec scenarios already say "the environment example and the configuration reference are compared
against the validated schema … with no drift", against a reference that does not exist. Rather than
amend them down, this change satisfies them: `env-example.test.ts` gains a fourth leg that parses the
variable names out of `apps/docs/src/content/docs/self-hosting/configuration.md` and asserts set
equality with the schema, modulo the same two commented exception lists. The docs page is therefore
a checked artifact, not prose — which is the only reason it will still be true in six months.

## Risks / Trade-offs

- **`YAPM_ALLOW_INSECURE_DEFAULTS` is itself a foot-gun.** Someone will set it in production. It is
  named to be embarrassing, it warns by name every boot, and `/readyz` reports it. That is the
  ceiling of what the process can do about a human overriding a refusal.
- **One extra round trip before the first sync.** `/api/config` is served by the same process that
  serves the SPA, from memory, so it costs one same-origin request on a warm connection. Measured
  against the alternative — a bundle that cannot sync at all on any real host — this is not close.
- **The e2e and smoke stacks change shape.** Both set `VITE_ZERO_CACHE_URL` today; both move to
  `ZERO_CACHE_PUBLIC_URL` and the CI e2e job to `YAPM_ALLOW_INSECURE_DEFAULTS=true`. If either is
  missed, CI fails loudly rather than silently — the failure mode is a red build, not a broken
  deploy.
- **The docs sidebar will conflict with the sibling `sso-admin-gating` build**, which adds its own
  self-hosting page. Expect a rebase on `apps/docs/astro.config.mjs`; it is three lines.

## Migration Plan

No database migration. The operational migration for an existing self-hoster is the upgrade page:
after this change, an instance that was running on defaults will **refuse to boot** until either the
secrets are set or the flag is set. That is a breaking operational change and the upgrade page says
so under its own heading, with the exact remedy — including the fact that changing
`BETTER_AUTH_SECRET` invalidates existing sessions and the stored JWKS, so every user signs in again.

## Open Questions

- Whether image signing (cosign) and an SBOM belong in the next deployment change or in the first
  release checklist. Not decided here; deliberately not claimed in SECURITY.md either way.

## Decisions made during implementation

- **`RuntimeConfigGate` lives in `runtime-config.tsx`, not `.ts`.** The tasks name a `.ts` file, but
  the module holds a React component with JSX, and `provider.tsx` is `.tsx` for exactly that reason.
  The test is `runtime-config.test.tsx`; `pnpm --filter @yapm/web test src/zero/runtime-config.test.ts`
  still selects it, because Vitest's positional argument is a path substring filter.
- **The gate passes the config down as a render prop, not through context.** `children` is
  `(config) => ReactNode`, so `ZeroRoot` is not merely hidden before the origin resolves — it is not
  in the element tree at all, and no Zero client can be constructed early by an accident of
  ordering. A context would have required `ZeroRoot` to read a possibly-undefined value and decide
  for itself, which is the decision this gate exists to take away from it.
- **`AppOptions.zeroCacheUrl` is optional and the route is mounted only when it is present.**
  Making it required would have forced a value into eleven existing `createApp` call sites in tests
  that have nothing to do with sync configuration. An app constructed without it 404s `/api/config`,
  which the SPA reports by name — a louder failure than a fabricated default. `index.ts` always
  passes it, and the schema gives it a default, so the shipped deployment always has one.
- **`SHIPPED_DEFAULTS.DATABASE_URL` holds the shipped *password*, not a connection string**, and the
  detector compares it against `new URL(value).password`. Host, port and database name are
  deployment facts; only the password is a secret this repo publishes. The reported name is
  `DATABASE_URL` (what the server reads), and `SHIPPED_DEFAULT_REMEDIES` names `POSTGRES_PASSWORD`
  as the remedy, because under the shipped compose stack that is the variable an operator edits.
- **`scripts/init-env.mjs` duplicates the variable list rather than importing it.** It runs against a
  clean checkout before `pnpm install`, so it cannot import a TypeScript module. Its list differs
  from `SHIPPED_DEFAULTS` in two deliberate ways, both commented in the file: `POSTGRES_PASSWORD`
  replaces `DATABASE_URL`, and `ZERO_ADMIN_PASSWORD` is added.
- **`init-env.mjs` rewrites only uncommented assignments,** and writes the file `0600`. A commented
  `# NAME=value` in `.env.example` documents a default the operator has not chosen; uncommenting it
  would turn documentation into configuration.
- **Two files outside the tasks' enumeration also carried `VITE_ZERO_CACHE_URL`** and were changed:
  `turbo.json` (the `dev` task's `passThroughEnv`, which now lists `ZERO_CACHE_PUBLIC_URL` and
  `YAPM_ALLOW_INSECURE_DEFAULTS`) and `scripts/dev.mjs` (the `pnpm dev` default, now
  `ZERO_CACHE_PUBLIC_URL` so the host-run server serves it). `apps/docs/.../sync-recovery.md`'s two
  references were corrected in the same pass — they described a value baked in at image build time,
  which is no longer true and would have sent an operator to rebuild an image for nothing.
- **The failure copy waits for the backoff ceiling, ~30s of retries.** That is what §D3 asks for and
  it is a deliberate trade: a page that says "can't reach the server" during a slow first paint has
  cried wolf, and the neutral shell is honest for as long as the answer is genuinely unknown.
- **The drift test (4.3) binds each shipped default to the artifact that actually produces it, which
  is not one artifact.** `BETTER_AUTH_SECRET` has a Zod default and is bound to it. The two Zero API
  keys are `optional()` in the schema with **no** default there — their shipped values exist only as
  compose's `${VAR:-…}` interpolation — and `DATABASE_URL`'s password comes from
  `${POSTGRES_PASSWORD:-yapm}`. So the test reads `docker-compose.yml`, asserts each `${NAME:-…}`
  default is self-consistent across the `yapm` and `zero-cache` services, and compares. It closes
  with the end-to-end form: the environment an empty `.env` actually produces is parsed by the real
  schema and every one of the four is detected, then the gate refuses. Falsified by hand —
  perturbing one character of `SHIPPED_DEFAULTS.BETTER_AUTH_SECRET` fails three of those tests.
- **The configuration reference is parsed as "the name in the first table cell, in backticks".** One
  row per variable, and `env-example.test.ts` asserts set equality in both directions against the
  schema modulo the same two lists, plus the presence of every compose-only variable — those are the
  ones an operator most needs the page for (`POSTGRES_PASSWORD` and `ZERO_ADMIN_PASSWORD` are two of
  the five secrets the hardening page tells them to change), so they are asserted rather than merely
  permitted. Unlike the `.env.example` legs, `CONTAINER_SET` is **not** excused in the "documents
  everything" direction: `DATABASE_URL`, `HOST`, `PORT` and `WEB_DIST_DIR` are real configuration for
  anyone running the server outside the shipped compose stack, so the reference documents all 59
  schema variables plus all 10 compose-only ones. The check found no drift on its first run.
- **`GET /api/config` is asserted to ignore the ambient environment** by stubbing
  `ZERO_CACHE_PUBLIC_URL` to a different origin while passing another through `AppOptions`. Without
  that assertion the route could be rewritten to read `process.env` directly and every other test
  would still pass — and a second reader of the same variable is how the served value and the
  validated value come to disagree.
- **Task 4.9's compose smoke run was NOT performed locally.** PROCESS.md §3 makes CI the gate of
  record for the compose path and explicitly excludes docker from the local fast gates, and the
  build instruction for this pass repeated that. The end-to-end proof is therefore the CI smoke job
  as rewritten in task 3.4: it runs `node scripts/init-env.mjs`, boots with
  `docker compose --env-file .env -f docker/docker-compose.yml up -d --build --wait`, and sets **no**
  `YAPM_ALLOW_INSECURE_DEFAULTS` — so if the env file were not read, the generated secrets would not
  reach the container, the boot gate would fire under `NODE_ENV=production`, and the job would fail
  on a refusal naming the variables. A green smoke job *is* the assertion that the operator's env
  file is read. Recorded rather than claimed: this was not run on this machine.

## Root-doc staleness sweep (PROCESS.md §2)

| Doc | Verdict |
|---|---|
| `README.md` | **Updated** — quickstart is `init-env.mjs` + `--env-file` (earlier pass), and the self-hosting paragraph now links the three new pages. |
| `ROADMAP.md` | **Updated** — row 25, and one sentence at the end of "Where v1 actually stands" saying what none of the features were any use without. |
| `TECHSTACK.md` | **Updated** — three §Self-host operations entries: runtime sync origin, shipped-default detection, and publishing decoupled from release automation; the upgrade bullet now points at the rollback truth; the configuration bullet points at the checked reference. |
| `SECURITY.md` | **Updated** — the self-hoster section was one sentence promising an artifact that did not exist. Now: change these five secrets and what each protects, the boot refusal, `--env-file`, the real tag set, an upgrade command that works, and an explicit **no signing, no provenance, no scanning**. |
| `.env.example` | **Updated** in the earlier pass; still set-equal to the schema, and now to the configuration reference as well. |
| `PROCESS.md` | **Updated** — §2's "mechanical checks" clause described two legs of `env-example.test.ts`; there are now four plus the README check. |
| `CONTRIBUTING.md` | Not stale. It documents the `pnpm dev` loop, which this change leaves unchanged (`ZERO_CACHE_PUBLIC_URL` defaults to `http://localhost:4848`, and no web-side default exists to disagree with it). |
| `VISION.md` | Reviewed, **left alone**. #6 says "One `docker compose up` on a small VPS". The deployment is still one compose command; it is now preceded by a one-off secret generator, which is the difference between deployable-in-minutes and deployable-in-minutes-and-compromised. |
| `DESIGN.md` | Not stale — no UI surface changed. The pre-config boot shell is the page background and nothing else. |
| `reference/*.md` | Not stale. Nothing here contradicted a harvested API note; `grep` for `VITE_ZERO`, `docker compose` and `--env-file` across `reference/` finds only an unrelated Kysely CLI `--env-file` flag. |
| `CLAUDE.md` | Not stale — no constraint changed. Three containers still, no new service. |
| `apps/docs/**` | **Three pages added** (deploy, upgrade, configuration) plus the sidebar; `sync-recovery.md`'s two build-time-constant claims were corrected in the earlier pass. |
