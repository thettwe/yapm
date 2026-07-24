# Reference: `connectors` change — first-party connector framework (GitHub first)

Prep for ROADMAP change #8 (`connectors`). Feeds the work graph (issue ↔ PR ↔ CI check ↔ deploy) and the issue-list **reality strip** (DESIGN.md §"Issue list"). AI change #9 reuses the same encrypted-secrets/config surface.

**Verification policy applied:** every API claim below is either quoted from an official GitHub doc (URL inline) or read from a real installed `.d.ts` in a throwaway probe (`scratchpad/probe-connectors`, `octokit@5.0.5` + `@octokit/auth-app@8.2.0` + `@octokit/webhooks@14.2.0` + `@octokit/app@16.1.2`, installed 2026-07-24). Anything not confirmed that way is marked **UNVERIFIED**. Design proposals (the connector interface) are marked **PROPOSAL**.

**Installed/latest npm versions (verified via `npm view`, 2026-07-24):**
| Package | Latest | yapm catalog |
|---|---|---|
| `octokit` | **5.0.5** | `pnpm-workspace.yaml:56` already pins `octokit: ^5.0.5` |
| `@octokit/app` | 16.1.2 | (transitive of `octokit`) |
| `@octokit/auth-app` | 8.2.0 | (transitive) |
| `@octokit/webhooks` | 14.2.0 | (transitive) |
| `@octokit/rest` | 22.0.1 | |
| `@octokit/core` | 7.0.6 | |
| `@octokit/graphql` | 9.0.3 | |

> **ESM-only + Node ≥20 (verified from installed `package.json`):** `octokit@5.0.5` → `"type":"module"`, `"engines":{"node":">= 20"}`. `@octokit/webhooks@14.2.0` → same. `require('octokit')` throws `ERR_REQUIRE_ESM`. yapm's server is ESM on Node 24 LTS, so this is fine — but the whole connector must be authored as ESM. TS7 `moduleResolution:"bundler"` (per TECHSTACK) handles the `.js`-suffixed type imports these packages emit.

---

## 1. GitHub App model & credential storage

### 1.1 GitHub App vs OAuth App — why an App

Source: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps (verbatim quotes):
- *"Like OAuth apps, GitHub Apps use OAuth 2.0 and can act on behalf of a user. Unlike OAuth apps, GitHub Apps can also act independently of a user."*
- *"GitHub Apps come with built-in webhooks and narrow, specific permissions."*
- GitHub Apps are **installed** on orgs/personal accounts with granular repo selection; they authenticate as themselves via **installation access tokens** (server-to-server) or on behalf of a user via user access tokens (user-to-server).

**Decision for yapm (matches TECHSTACK "GitHub App + webhooks (octokit) — never polling"):** use a **GitHub App**, not an OAuth App. Reasons: (a) acts independently of any single user (survives that user leaving), (b) built-in webhooks, (c) fine-grained per-permission scopes, (d) per-installation `5,000 req/hr` rate budget instead of a shared user budget (§3).

- **Installation access token lifetime = 1 hour.** The token carries `expiresAt` (verified — `@octokit/auth-app` `InstallationAccessTokenData` has `expiresAt: UTC_TIMESTAMP`). `@octokit/auth-app` caches and auto-refreshes these; yapm should **not** persist installation tokens, only mint them on demand from the App private key.
- **App-owned vs org-owned registration:** an App can be registered under a personal account **or** an org you own. For a self-hoster, either works; the App owner controls the private key and webhook secret. (Source: registering-a-github-app, §1.2.)

### 1.2 Self-hoster setup guide — register the App (becomes yapm's setup docs)

Source: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app (steps + field names verbatim):

1. Profile picture → **Settings** (personal) **or** **Your organizations → Settings** (org-owned App).
2. Left sidebar → **Developer settings**.
3. Click **GitHub Apps** → **New GitHub App**.
4. Fill required fields:
   - **"GitHub App name"** — *"must be 34 characters or fewer and unique across GitHub"*; GitHub lowercases it and replaces spaces with hyphens.
   - **"Homepage URL"** — full URL to the yapm instance (e.g. `https://yapm.example.com`).
   - **"Webhook URL"** — the instance's ingest endpoint, e.g. `${BETTER_AUTH_URL}/api/github/webhooks` (yapm serves webhooks from the Hono `yapm` container per TECHSTACK).
   - **"Webhook secret"** — *"optional but highly recommended"*; yapm should require it and store it encrypted (§1.4). Used for HMAC verification (§2.3).
   - **Callback URL** — up to 10 supported (only needed if using user-auth flows; v1 may skip).
   - **Installation scope** — *"Only on this account"* or *"Any account"*. Self-host default: "Only on this account"; a public/cloud yapm would use "Any account".
5. Set **Permissions** (§1.3) and **Subscribe to events** (§2.5).
6. Create the App. Then generate the private key (§1.4).

> The registration page does **not** cover private-key download — that is a separate step (§1.4), a common docs gotcha to call out in yapm's guide.

**After creation, the self-hoster provides yapm four values** (env vars, Zod-validated at boot per TECHSTACK config policy): App ID, App private key (PEM), webhook secret, and (optional) client ID/secret if user-auth is added later. Then they click **Install App** to install it on the org/repos; yapm receives an `installation` webhook (§2.5) carrying `installation.id`, which is the key it stores per workspace/team.

Suggested env surface (extends existing `.env.example`, which today only has `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` for better-auth OAuth login — **distinct from the App**):
```
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=        # PEM, PKCS#1; multiline (base64-encode or \n-escape in env)
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_CLIENT_ID=          # only if user-to-server auth is added
GITHUB_APP_CLIENT_SECRET=
```

### 1.3 Permissions / scopes needed (issues + PRs + checks + deploys)

Source: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps

| Permission slug | Access | Why (yapm use) |
|---|---|---|
| `metadata` | read | Mandatory baseline; repo info. |
| `contents` | read | Branch/commit/ref data for branch↔issue linking, push events. |
| `issues` | **write** | Read issues; write comments/labels/status back (auto-link, back-reference). |
| `pull_requests` | **write** | PR state for the reality strip; optionally write PR comments/links. |
| `checks` | read | check_run / check_suite → CI health dot. |
| `statuses` ("Commit statuses") | read | Legacy `status` events (Travis/older CI) → CI health. |
| `deployments` | read | deployment / deployment_status → deploy state. |

- If v1 only *reads* PR/issue state and never writes back, `issues`/`pull_requests` can be **read**. Start read-only, escalate to write only when auto-status-write / back-linking ships. Escalating permissions later forces installers to re-approve — so decide the v1 write surface deliberately.
- Each permission gates the matching webhook events (§2.5) and REST endpoints. E.g. `checks:read` is required to receive `check_run`/`check_suite` and to call `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`.

### 1.4 Private key + credential storage

Source: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps (verbatim):
- Generate: App settings → **"Generate a private key"**; *"The key downloads automatically to your computer in PEM format."* *"GitHub only stores the public portion of the key."*
- Format: *"PKCS#1 RSAPrivateKey format"* (RSA). `@octokit/auth-app` accepts this PEM directly as `privateKey`. (Note: some JOSE/WebCrypto paths want PKCS#8; auth-app handles PKCS#1 internally — do **not** pre-convert unless a runtime rejects it. **UNVERIFIED** which runtime would reject it under Node 24.)
- Up to **25 private keys** per App; keys *"do not expire and instead need to be manually revoked"* → enables zero-downtime rotation.
- Storage: *"storing the key in a key vault… Never: hard-code your private key… An attacker accessing environment variables could gain persistent authentication as the GitHub App."*

**yapm storage model (proposal, consistent with the shared secrets surface §6):**
- Single-instance self-host: App private key + webhook secret come from **env vars** (Zod-validated at boot). Acceptable per the docs; simplest for the 3-container promise.
- **Per-installation** data (the `installation.id`, target org/repo selection, per-installation ETags for reconciliation §3.4) is stored in Postgres, keyed to workspace/team. Installation *tokens* are **never persisted** — minted on demand and cached in memory by auth-app.
- If/when yapm cloud hosts many orgs' Apps, the App private keys move into the encrypted-secrets table (§6), not env.

---

## 2. Webhooks — events, payloads, HMAC verification

### 2.1 Event → action-enum reference (for the reality strip)

Source: https://docs.github.com/en/webhooks/webhook-events-and-payloads (actions verbatim).

| Event | `action` enum values | Top-level payload objects |
|---|---|---|
| `pull_request` | `assigned` `auto_merge_disabled` `auto_merge_enabled` `closed` `converted_to_draft` `demilestoned` `dequeued` `edited` `enqueued` `labeled` `locked` `milestoned` `opened` `ready_for_review` `reopened` `review_request_removed` `review_requested` `stacked` `synchronize` `unassigned` `unlabeled` `unlocked` | `action`, `number`, `pull_request`, `repository`, `sender`, `installation` |
| `push` | *(none — no action field)* | `ref`, `before`, `after`, `commits[]`, `created`, `deleted`, `forced`, `repository`, `sender`, `installation` |
| `check_run` | `completed` `created` `requested_action` `rerequested` | `action`, `check_run`, `repository`, `sender`, `installation` |
| `check_suite` | `completed` `requested` `rerequested` | `action`, `check_suite`, `repository`, `sender`, `installation` |
| `status` | *(none)* | `state` (`pending`\|`success`\|`failure`\|`error`), `commit`, `context`, `description`, `branches[]`, `repository`, `sender`, `installation` |
| `deployment` | *(none — fires on create)* | `deployment`, `workflow`, `workflow_run`, `repository`, `sender`, `installation` |
| `deployment_status` | *(none)* | `deployment`, `deployment_status`, `check_run`, `workflow`, `workflow_run`, `repository`, `sender`, `installation` |
| `issues` | `assigned` `closed` `deleted` `demilestoned` `edited` `field_added` `field_removed` `labeled` `locked` `milestoned` `opened` `pinned` `reopened` `transferred` `typed` `unassigned` `unlabeled` `unlocked` `unpinned` `untyped` | `action`, `issue`, `assignee`, `repository`, `sender`, `installation` |

Notes:
- **Draft transitions:** `pull_request` `converted_to_draft` and `ready_for_review` are the draft↔open signals; the PR's own boolean is `pull_request.draft`. (**UNVERIFIED** exact nested field name from live payload; from schema it is `draft: boolean`.)
- **Merge:** there is no `merged` action — a merge fires `pull_request` `closed` with `pull_request.merged === true`. This distinction is load-bearing for the reality strip (merged vs just-closed).
- **Every install-scoped delivery carries `installation.id`** → this is the pg-boss `singletonKey` (§3.3).
- **`review` events:** PR reviews (approve/changes-requested) arrive on the separate **`pull_request_review`** event (action `submitted`/`edited`/`dismissed`), not on `pull_request`. Needed for the review-state part of the reality strip (§4). Also `pull_request_review_comment`, `pull_request_review_thread` exist. (Event existence: verified in webhooks-names generated set exported by `@octokit/webhooks`; action enums **UNVERIFIED** here — confirm against the events page before coding.)

### 2.2 Payload TypeScript types (verified — `@octokit/webhooks`)

`@octokit/webhooks@14.2.0` re-exports fully-typed payloads. The emitter is generic and event-name-narrowed (verified `index.d.ts`):
```ts
declare class Webhooks<TTransformed = unknown> {
    sign:   (payload: string) => Promise<string>;
    verify: (eventPayload: string, signature: string) => Promise<boolean>;
    on:  <E extends EmitterWebhookEventName>(event: E | E[], callback: HandlerFunction<E, TTransformed>) => void;
    onAny: (callback: (event: EmitterWebhookEvent & TTransformed) => any) => void;
    onError: (callback: (event: WebhookEventHandlerError<TTransformed>) => any) => void;
    receive: (event: EmitterWebhookEvent) => Promise<void>;
    verifyAndReceive: (options: EmitterWebhookEventWithStringPayloadAndSignature) => Promise<void>;
    constructor(options: Options<TTransformed> & { secret: string });
}
export { createNodeMiddleware, createWebMiddleware, emitterEventNames, createEventHandler, validateEventName, Webhooks };
```
`on("pull_request.closed", ({ payload }) => …)` narrows `payload` to the merged pull_request-closed type. Payload types are drawn from `@octokit/openapi-webhooks-types` (installed). Use these directly as the ingest DTOs — do **not** hand-roll payload interfaces.

### 2.3 HMAC signature verification (verified header + method)

Source: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- Header: **`X-Hub-Signature-256`**, value prefixed `sha256=`. Algorithm **HMAC-SHA256** over the **raw request body** using the webhook secret.
- *"use a 'constant time' comparison method like `crypto.timingSafeEqual`"* — never `===`.
- **Critical:** HMAC must run over the **exact raw bytes** GitHub sent. If Hono parses JSON first and you re-`JSON.stringify`, the signature will not match. Capture the raw body before parsing.

**Recommended: let octokit do it** (verified — `Webhooks.verifyAndReceive` and standalone `@octokit/webhooks-methods`):
```ts
// @octokit/webhooks-methods index.d.ts (verified):
export { sign } from "./node/sign.js";
export { verify };
export declare function verifyWithFallback(
  secret: string, payload: string, signature: string, additionalSecrets: undefined | string[]
): Promise<any>;   // <-- fallback list = zero-downtime webhook-secret rotation
```
So the ingest path is: read raw body + `X-Hub-Signature-256` + `X-GitHub-Event` + `X-GitHub-Delivery`, then `await webhooks.verifyAndReceive({ id, name, payload, signature })` (throws on bad signature). `verifyWithFallback` supports rotating the secret without dropping in-flight deliveries.

Hono note: TECHSTACK lists *"webhook signature verification"* under Security. Either mount `createWebMiddleware(webhooks)` (Web-standard `Request`/`Response`, fits Hono) or verify manually with the raw body. `createNodeMiddleware` also exists but is Node `http`-shaped. (Middleware existence verified; exact Hono wiring **UNVERIFIED** — prototype both.)

### 2.4 Verify-fast, process-async (the pg-boss handoff)

The webhook HTTP handler must return 2xx quickly (GitHub times out / retries slow deliveries). Pattern: **verify HMAC synchronously → enqueue raw payload to pg-boss → return 202 immediately.** All graph mapping happens in the worker. This is exactly the TECHSTACK line: *"Webhook → pg-boss queue (serialized per installation) → work-graph edges."* Store the `X-GitHub-Delivery` UUID for idempotency (dedupe redelivered events).

### 2.5 Recommended minimal event subscription set

Subscribe (in App settings "Subscribe to events") to exactly what the reality strip needs — nothing more (less signature surface, less queue volume):
- `pull_request` (draft/open/closed+merged/synchronize)
- `pull_request_review` (approved / changes_requested) — review state + latency
- `check_suite` and/or `check_run` (CI health) — prefer `check_suite.completed` for a rolled-up conclusion, add `check_run` only if per-check granularity is shown
- `status` (legacy CI that doesn't use the Checks API)
- `deployment_status` (deploy state; `deployment` alone only tells you a deploy was *created*)
- `push` (branch↔issue linking via branch name / commit message `#123`)
- `issues` (mirror external issue edits if a repo's issues are tracked)
- `installation` + `installation_repositories` (lifecycle: install/uninstall/repo-added-removed — updates yapm's per-installation record)

Deliberately **skipped** in v1: `deployment` (redundant with `deployment_status`), `check_run` if `check_suite` suffices, comment-firehose events.

---

## 3. octokit — App auth, REST/GraphQL, conditional requests, rate limits

### 3.1 App auth (verified signatures)

`octokit@5` re-exports `App` (verified `octokit/dist-types/index.d.ts`):
```ts
export { Octokit, RequestError } from "./octokit.js";
export { App, OAuthApp, createNodeMiddleware } from "./app.js";
```

`App` constructor options (verified `@octokit/app` `types.d.ts`):
```ts
export type Options = {
  appId?: number | string;
  privateKey?: string;
  webhooks?: { secret: string };
  oauth?: { clientId: string; clientSecret: string; allowSignup?: boolean };
  Octokit?: typeof Octokit;
  log?: { debug; info; warn; error };
};
export type ConstructorOptions<TOptions> = TOptions & { appId: number|string; privateKey: string };
```
`App` instance surface (verified `@octokit/app` `index.d.ts`):
```ts
class App {
  octokit: Octokit;                       // app-level (JWT) client
  webhooks: Webhooks;                      // pre-wired with the webhook secret
  oauth: OAuthApp<{clientType:"github-app"}>;
  getInstallationOctokit(installationId: number): Promise<Octokit>;   // <-- the workhorse
  eachInstallation(cb): Promise<void> & { iterator };
  eachRepository(cb | (query,cb)): Promise<void> & { iterator };
  getInstallationUrl(options?): Promise<string>;
  log: { debug; info; warn; error };
}
```

Canonical yapm usage (composed from the verified signatures — **PROPOSAL** wiring, verified primitives):
```ts
import { App } from "octokit";

const app = new App({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  webhooks: { secret: env.GITHUB_APP_WEBHOOK_SECRET },
});

// per-installation client — auto-mints + caches the 1h installation token:
const octokit = await app.getInstallationOctokit(installationId);
const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
```

Lower-level (if not using `App`): `@octokit/auth-app` `createAppAuth` (verified `index.d.ts`):
```ts
export declare function createAppAuth(options: StrategyOptions): AuthInterface;
```
`StrategyOptions` requires `appId` + `privateKey` (or a `createJwt` factory); calling `auth({ type: "installation", installationId })` yields (verified `InstallationAccessTokenAuthentication`) `{ token, expiresAt, permissions, repositorySelection, repositoryIds?, repositoryNames? , type:"token", tokenType:"installation" }`. Attach via `new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId } })`.

### 3.2 REST + GraphQL (verified)

- REST: the bundled `octokit` `Octokit` ships `@octokit/plugin-rest-endpoint-methods` (`octokit.rest.pulls.get`, `.checks.listForRef`, `.repos.listDeploymentStatuses`, `.issues.*`) **and** `@octokit/plugin-paginate-rest` (`octokit.paginate(...)`, `octokit.paginate.iterator(...)`). (Package `@octokit/plugin-paginate-rest` + `@octokit/plugin-rest-endpoint-methods` present in probe `node_modules`.)
- GraphQL: `octokit.graphql` (verified `@octokit/core` `index.d.ts`: `graphql: typeof graphql`). Use GraphQL to fetch PR + reviews + checks + deployment state **in one round trip** (fewer REST calls = further from the secondary-limit points ceiling). `@octokit/plugin-paginate-graphql` is installed for cursor pagination.

### 3.3 Serialized-per-installation processing (Mergify lesson) — cross-ref `server-stack.md §6.4`

GitHub **secondary** limits punish concurrency, and per install the token budget is shared. So process each installation's webhooks **serially**. `reference/server-stack.md:1501` already specifies the exact pg-boss shape (verbatim from that file):
```ts
await boss.createQueue('github-webhook', {
  policy: 'key_strict_fifo',            // strict FIFO per singletonKey
  retryLimit: 5, retryDelay: 1, retryBackoff: true, retryDelayMax: 300,
  deadLetter: 'github-webhook-dlq',
});
await boss.send('github-webhook', payload, { singletonKey: `installation-${installationId}` });
await boss.work('github-webhook', { batchSize: 1 }, async ([job]) => { await ingestWebhook(job.data); });
```
- `key_strict_fifo` (verbatim from `server-stack.md`): *"Blocks processing of jobs with the same key while any job with that key is active, in retry, or failed."* → **operational duty:** a permanently-failed job **blocks that installation's key**. Monitor `boss.getBlockedKeys('github-webhook')`; clear via `retry()`/`deleteJob()` (server-stack §6.4).
- Softer alternative (same file): `groupConcurrency: 1` with `group:{id:'installation-…'}` gives per-install serialization **without** the failed-blocks-key hazard, but **without** FIFO ordering. For webhooks, ordering usually matters (opened→synchronize→closed), so `key_strict_fifo` is the better default; accept the blocked-key monitoring cost.
- This mirrors Mergify's *per-org Redis stream* pattern (TECHSTACK risk #4: promote to Redis Streams only if pg volume demands). **UNVERIFIED** Mergify internals — cited from TECHSTACK's own characterization, not an external doc.

### 3.4 Conditional requests / ETag / 304 (for reconciliation)

Source: https://docs.github.com/en/rest/guides/best-practices-for-using-the-rest-api (verbatim):
- *"Most endpoints return an `etag` header, and many endpoints return a `last-modified` header."* Use `if-none-match` (with the stored ETag) or `if-modified-since`.
- **The key win:** *"Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header."*
- octokit behavior: a `304` is surfaced as a `RequestError` with `status === 304` (verified `@octokit/request-error` exposes `status: number`; **UNVERIFIED** that octokit throws rather than returns for 304 — confirm at prototype time and catch `err.status===304` → "unchanged"). Send the prior ETag via `{ headers: { "if-none-match": etag } }`; persist the returned `etag` per (installation, resource) for the next reconcile.
- yapm uses this in the **periodic reconciliation sync** (TECHSTACK: *"Periodic reconciliation with conditional requests (free 304s) to catch missed events"*) — a pg-boss cron job that re-polls PR/check/deploy state to heal any dropped webhook, at near-zero rate-limit cost when nothing changed.

### 3.5 Rate limits — primary vs SECONDARY (verified numbers)

Source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

**Primary (verbatim):**
- *"GitHub Apps authenticating with an installation access token use the installation's minimum rate limit of 5,000 requests per hour."* Enterprise Cloud orgs → *"15,000 requests per hour."* Non-EMU installs scale with repos/users but *"The rate limit cannot increase beyond 12,500 requests per hour."*
- Headers: `x-ratelimit-remaining` (*"requests remaining in the current window"*), `x-ratelimit-reset` (*"UTC epoch seconds"*).

**Secondary (verbatim triggers) — the dangerous one:**
- *"No more than 100 concurrent requests"*
- *"900 points per minute"* for REST endpoints; points: *"Most REST API GET, HEAD, and OPTIONS requests"* cost **1 point**, mutations cost **5 points**.
- content-creation cap *"80 requests per minute"* (also *"wait at least one second between each"* mutating request, from the best-practices page).
- On secondary limit: `retry-after` header → *"you should not retry your request until after that many seconds has elapsed."* If `x-ratelimit-remaining` is `0`, wait until `x-ratelimit-reset`.
- **Best practice (verbatim):** *"To avoid exceeding secondary rate limits, you should make requests serially instead of concurrently… implement a queue system."* ← this *is* why §3.3 serializes per installation.

**octokit auto-handling (verified `@octokit/plugin-throttling` `index.d.ts`):** add `throttle` to Octokit options; it wraps a Bottleneck limiter and calls `onRateLimit` / `onSecondaryRateLimit` handlers with `retryAfter`. `ThrottlingOptionsBase` fields (verified): `enabled`, `fallbackSecondaryRateRetryAfter`, `retryAfterBaseValue`, `onRateLimit` (required). `@octokit/plugin-retry` (installed) auto-retries transient failures. Recommend enabling both on every installation client, and returning `true` from the handlers only for a bounded retry count.

---

## 4. APIs that populate the reality strip — push vs poll

DESIGN.md §"Issue list" reality strip = PR state (draft→open→approved→merged) · CI health dot · review age · deploy state · divergence flag.

| Signal | Source of truth (REST — verified) | Webhook push? | Poll/reconcile? |
|---|---|---|---|
| **PR state** draft/open/merged | `GET /repos/{owner}/{repo}/pulls/{pull_number}` → `draft:boolean`, `state:"open"\|"closed"`, `merged:boolean`, `merged_at` | ✅ `pull_request` (`opened`/`converted_to_draft`/`ready_for_review`/`closed`+`merged`/`synchronize`) | reconcile via ETag |
| **PR approved** | `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` → `state` ∈ `APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`DISMISSED`/`PENDING` (verified endpoint; states from doc + REVIEW event params `APPROVE`/`REQUEST_CHANGES`/`COMMENT`) | ✅ `pull_request_review` (`submitted`) | poll if event missed |
| **Review latency** | `reviews[].submitted_at` (date-time) minus PR `ready_for_review`/`created_at` (verified `submitted_at` exists) | derive from `pull_request_review` timestamp | computed, not stored by GH |
| **CI health** | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` → per run `status` ∈ `queued`/`in_progress`/`completed` (+`waiting`/`requested`/`pending`), `conclusion` ∈ `success`/`failure`/`neutral`/`cancelled`/`skipped`/`timed_out`/`action_required`/`null` (`stale` GitHub-only). Also legacy `GET /repos/{owner}/{repo}/commits/{ref}/status` (`state` pending/success/failure/error) | ✅ `check_run`/`check_suite` (`completed`) + `status` | reconcile via ETag on the head SHA |
| **Deploy state** | `GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses` → `state` ∈ `error`/`failure`/`inactive`/`pending`/`success`/`queued`/`in_progress` (verified endpoints + enum) | ✅ `deployment_status` | poll long-running deploys |
| **Divergence flag** | derived: human status vs (merged / deploy-failed / CI-failed) | n/a — computed over the above | recompute on any signal change |

Verified enum sources: check-runs https://docs.github.com/en/rest/checks/runs ; deployment statuses https://docs.github.com/en/rest/deployments/statuses ; reviews https://docs.github.com/en/rest/pulls/reviews .

**Push vs poll rule:** everything above is **webhook-push primary**; polling is the **reconciliation safety net** (missed/redelivered events, deploys that outlive a webhook, backfill on first install). First-install **backfill** must be a REST/GraphQL sweep (webhooks are future-only). Use `app.eachRepository` + `octokit.paginate` for the initial sweep, then rely on webhooks + ETag reconcile.

---

## 5. Connector interface sketch — **PROPOSAL (design input, not a fetched fact)**

Goal (ROADMAP #8): GitHub is the *first implementation* of a reusable framework; GitLab etc. slot in later. The interface must isolate the 3 provider-specific concerns — **auth/config**, **ingest(webhook)**, **reconcile()** — and funnel everything into one provider-neutral **work-graph mapping**.

```ts
// packages/schema (or packages/connectors) — provider-agnostic contract. PROPOSAL.
export interface ConnectorDefinition<Config, Secrets> {
  id: "github" | "gitlab";
  displayName: string;

  // --- auth / config ---
  configSchema: z.ZodType<Config>;                    // non-secret settings (repo filters, etc.)
  secretSchema: z.ZodType<Secrets>;                   // encrypted at rest (§6)
  verifySignature(raw: Uint8Array, headers: Headers, secrets: Secrets): Promise<boolean>;

  // --- ingest (webhook, sync-fast path) ---
  //   called by the HTTP handler AFTER signature verify; returns the queue key + normalized envelope
  parseDelivery(raw: string, headers: Headers): {
    installationKey: string;                          // -> pg-boss singletonKey (per-install serialization)
    eventType: string;
    deliveryId: string;                               // idempotency
    payload: unknown;
  };

  // --- ingest (worker, async path) ---
  ingest(event: NormalizedEvent, ctx: ConnectorCtx): Promise<WorkGraphMutation[]>;

  // --- reconcile (cron safety net + first-install backfill) ---
  reconcile(installation: InstallationRecord, ctx: ConnectorCtx): Promise<WorkGraphMutation[]>;
}

// Provider-neutral output — the ONLY thing feature code sees. Maps 1:1 to work-graph edges.
type WorkGraphMutation =
  | { kind: "upsertPR"; externalId: string; state: "draft"|"open"|"approved"|"changes_requested"|"merged"|"closed"; url: string; headSha: string; linkedIssueRefs: string[] }
  | { kind: "upsertCheck"; prExternalId: string; conclusion: "success"|"failure"|"neutral"|"pending"|"..."; }
  | { kind: "upsertReview"; prExternalId: string; state: "approved"|"changes_requested"|"commented"; submittedAt: string }
  | { kind: "upsertDeploy"; ref: string; environment: string; state: "queued"|"in_progress"|"success"|"failure"|"inactive" }
  | { kind: "linkBranch"; branch: string; issueRef: string };

interface ConnectorCtx {
  client: unknown;             // GitHub: installation Octokit from app.getInstallationOctokit()
  getEtag(resource: string): Promise<string | null>;
  setEtag(resource: string, etag: string): Promise<void>;
  log: Logger;
}
```

Why this shape:
- **`parseDelivery` is intentionally split from `ingest`** so the HTTP handler can verify+enqueue in <10ms (§2.4) and the pg-boss worker does the heavy `ingest`. The `installationKey` it returns is the serialization key (§3.3).
- **`WorkGraphMutation` is the provider firewall.** GitHub's `check_run.conclusion` and GitLab's pipeline status both normalize to the same union → the reality strip + divergence logic is written once. Mutations flow through yapm's **existing Zero custom mutators** (TECHSTACK: shared mutators in `packages/schema`), so connector writes obey the same server-side authz as human writes — same safety story ROADMAP #9 wants for AI.
- **`reconcile` uses `getEtag`/`setEtag`** so 304s stay free (§3.4).
- GitLab later implements the same interface: system hooks/webhooks → `parseDelivery` (`X-Gitlab-Token` verify instead of HMAC), Merge Request/pipeline/deployment REST → `reconcile`. No feature code changes.

Boundary placement (per TECHSTACK boundary rules): the interface + `WorkGraphMutation` type live in `packages/schema` (zero UI deps, holds the mutators); the GitHub implementation (octokit, webhook parsing) lives in `apps/server`. ZQL/mutators must not leak — connectors call mutators, not raw ZQL.

---

## 6. Shared encrypted-secrets / config surface (connectors + AI providers)

ROADMAP #9 (AI) explicitly *"Reuses the connector secrets/config surface."* So build **one** secrets table now. Secrets to hold: GitHub App private key + webhook secret (if not env), per-installation metadata, and later AI provider API keys (Anthropic/Gemini/OpenAI BYO-key).

**Encryption-at-rest approach — Node built-in `crypto`, AES-256-GCM (verified working on the installed runtime):**
Ran on Node **v26.0.0** in probe (yapm targets Node 24 LTS; API identical and stable since Node 12):
```
node -e '...aes-256-gcm encrypt/decrypt roundtrip...'  →  roundtrip: webhook-secret  tagLen 16  scrypt? function
```
So `crypto.createCipheriv('aes-256-gcm', key, iv)` / `getAuthTag()` / `createDecipheriv` + `setAuthTag()` and `crypto.scryptSync` are all present. **No dependency needed** — aligns with PRINCIPLES *"Prefer standard library solutions over external dependencies"* and TECHSTACK's minimal-deps stance.

Reference implementation (Node stdlib only — **PROPOSAL**, primitives verified):
```ts
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

// Master key from env (32 bytes). Derive per-record or use directly.
const KEY = Buffer.from(env.SECRETS_ENCRYPTION_KEY, "base64"); // 32 bytes -> AES-256

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);                       // 96-bit nonce for GCM
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();                  // 16 bytes (verified tagLen 16)
  return [iv, tag, ct].map(b => b.toString("base64")).join(".");  // store this text blob
}
export function decryptSecret(blob: string): string {
  const [iv, tag, ct] = blob.split(".").map(s => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
```
Design points:
- **Key source:** a single `SECRETS_ENCRYPTION_KEY` env var (32 random bytes, base64), Zod-validated at boot. Losing it = all stored secrets unrecoverable → document in backup guide. (Self-host reality: env is acceptable per the private-key docs §1.4; a KMS/vault path is the cloud upgrade.)
- **AES-GCM is authenticated** (the 16-byte tag) → tamper-evident; `final()` throws on wrong key/tampered ciphertext. Store `iv‖tag‖ciphertext` together.
- **Postgres storage:** a `text`/`bytea` column in a `connector_secrets` (or generic `encrypted_secrets`) table; never a Zero-synced table (secrets must not replicate to clients — Zero pushes to IndexedDB). Keep it in a server-only Kysely-managed table, read only in `apps/server`.
- **Alternatives considered:** `pgcrypto` (encrypt in the DB) — rejected: key ends up in SQL/logs, and it couples to Postgres extension availability. A userland lib like `@47ng/cloak` or `libsodium` — unnecessary; stdlib AES-GCM covers it. (**UNVERIFIED** current version/health of those libs — not needed.)
- **Rotation:** version the blob (prefix `v1.`) so a future key rotation can re-encrypt lazily. For webhook-secret rotation specifically, `@octokit/webhooks-methods` `verifyWithFallback(secret, payload, sig, [oldSecret])` (verified §2.3) accepts multiple secrets during the overlap window.

---

## 7. Open items to resolve at implementation time (flagged UNVERIFIED)

1. `pull_request_review` / `check_suite` / `push` exact **action enums & nested field paths** — verified event *existence* via `emitterEventNames`; confirm field names against live payloads or `@octokit/openapi-webhooks-types` before mapping.
2. Whether octokit surfaces **304 as a thrown `RequestError` (status 304)** vs a normal response — catch-and-handle either way; confirm in a live conditional request.
3. **PKCS#1 vs PKCS#8** private-key acceptance on Node 24 (auth-app handles PKCS#1; verify no runtime conversion needed).
4. Exact **Hono wiring** for `@octokit/webhooks` `createWebMiddleware` vs manual raw-body HMAC — prototype both; raw-body capture is the risk.
5. Mergify per-org-stream details are cited from **TECHSTACK's own words**, not an external source.
6. GitHub **secondary-limit point costs** for GraphQL specifically (the 900-points/min figure is documented for REST; GraphQL has its own node-based cost model — verify separately if GraphQL is used heavily).

## Source URLs (all fetched 2026-07-24)
- Registering a GitHub App — https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- About creating GitHub Apps (App vs OAuth) — https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps
- Managing private keys — https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
- Permissions required for GitHub Apps — https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- Webhook events and payloads — https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Validating webhook deliveries (HMAC) — https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- REST rate limits — https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- REST best practices (conditional requests, serialization) — https://docs.github.com/en/rest/guides/best-practices-for-using-the-rest-api
- Check runs — https://docs.github.com/en/rest/checks/runs
- PR reviews — https://docs.github.com/en/rest/pulls/reviews
- Deployment statuses — https://docs.github.com/en/rest/deployments/statuses
- Local `.d.ts` probe: `scratchpad/probe-connectors/node_modules/{octokit,@octokit/*}` (octokit 5.0.5, auth-app 8.2.0, webhooks 14.2.0, app 16.1.2)
- Cross-ref: `reference/server-stack.md §6.4` (pg-boss `key_strict_fifo` per-installation serialization)

---

## Verification (adversarial pass)

**Method (2026-07-24, second independent probe):** fresh `npm install` in `scratchpad/probe-connectors` of `octokit@5.0.5` + `@octokit/app@16.1.2` + `@octokit/auth-app@8.2.0` + `@octokit/webhooks@14.2.0` + `@octokit/webhooks-methods@6.0.0` + `@octokit/plugin-throttling@11.0.3` + `@octokit/rest@22.0.1`. Every claim below checked against the **real installed `.d.ts`** and, where possible, a **runtime import/construction smoke test** (Node v26.0.0). Goal was to REFUTE. Result: no false API claims found — the doc holds up. Details:

### Verified-correct (confirmed against real `.d.ts` and/or runtime)

**Versions (all match `npm view`, 2026-07-24):** `@octokit/rest` 22.0.1, `@octokit/auth-app` 8.2.0, `@octokit/webhooks` 14.2.0, `octokit` 5.0.5, `@octokit/app` 16.1.2, `@octokit/core` 7.0.6, `@octokit/graphql` 9.0.3. Supporting deps present in tree: `@octokit/openapi-webhooks-types@12.1.0`, `@octokit/plugin-paginate-rest@14.0.0`, `@octokit/plugin-rest-endpoint-methods@17.0.0`, `@octokit/plugin-paginate-graphql@6.0.0`, `@octokit/plugin-retry@8.1.0`, `@octokit/request-error@7.1.0`.

- **§Intro ESM/engines** — `octokit/package.json` = `"type":"module"`, `"engines":{"node":">= 20"}`; `@octokit/webhooks` identical. ✅
- **§3.1 octokit index exports** — `octokit/dist-types/index.d.ts` exports `{ Octokit, RequestError }` from `./octokit.js` and `{ App, OAuthApp, createNodeMiddleware }` from `./app.js`. Exact match. Runtime `import { App, Octokit, OAuthApp, createNodeMiddleware } from "octokit"` → all `function`. ✅
- **§3.1 `App` `Options` / `ConstructorOptions`** — `@octokit/app/dist-types/types.d.ts` matches the doc field-for-field: `appId?: number|string`, `privateKey?: string`, `webhooks?:{secret:string}`, `oauth?:{clientId,clientSecret,allowSignup?}`, `Octokit?`, `log?`. `ConstructorOptions<TOptions extends Options> = TOptions & { appId: number|string; privateKey: string }`. ✅
- **§3.1 `App` instance surface** — `index.d.ts` confirms `octokit`, `webhooks`, `oauth`, `getInstallationOctokit(installationId:number):Promise<O>`, `eachInstallation`, `eachRepository`, `getInstallationUrl(options?):Promise<string>`, `log`. Runtime: constructed `new App({appId,privateKey(PKCS#1),webhooks:{secret}})`; `app.octokit instanceof Octokit` = true, `app.webhooks instanceof Webhooks` = true, all four methods `function`. ✅
- **§3.1 `createAppAuth` / `StrategyOptions`** — `createAppAuth(options: StrategyOptions): AuthInterface`. `StrategyOptions` requires `appId` + (`privateKey` **or** `createJwt` factory) via a union, as claimed. `auth({type:"installation",...})` overload returns `Promise<InstallationAccessTokenAuthentication>`. ✅
- **§1.1 / §3.1 `InstallationAccessToken*`** — `InstallationAccessTokenData` has `expiresAt: UTC_TIMESTAMP` (=`string`); `InstallationAccessTokenAuthentication = data & { type:"token"; tokenType:"installation"; installationId:number }`, plus `token`, `permissions`, `repositorySelection`, `repositoryIds?`, `repositoryNames?`. Exactly the shape the doc lists. ✅
- **§2.2 `Webhooks` class** — `@octokit/webhooks/dist-types/index.d.ts` matches: `sign`, `verify(eventPayload:string,signature:string):Promise<boolean>`, `on<E>`, `onAny`, `onError`, `receive`, `verifyAndReceive(options)`, `constructor(options & {secret:string})`. Value exports `{ createNodeMiddleware, createWebMiddleware, emitterEventNames, createEventHandler, validateEventName, Webhooks }` all present. ✅
- **§2.3 `verifyAndReceive` arg shape** — `EmitterWebhookEventWithStringPayloadAndSignature = { id:string; name:string; payload:string; signature:string }`. The doc's `{ id, name, payload, signature }` is exact. ✅
- **§2.3 `@octokit/webhooks-methods`** — `index.d.ts`: `export { sign }`, `export { verify }`, `verifyWithFallback(secret:string, payload:string, signature:string, additionalSecrets: undefined | string[]): Promise<any>`. Exact match, incl. the fallback-secret rotation arg. ✅
- **§2.5 / §4 event names** — runtime check of `emitterEventNames` (from `@octokit/webhooks`): all of `pull_request`, `pull_request.closed`, `pull_request_review`, `pull_request_review.submitted`, `check_run`, `check_run.completed`, `check_suite`, `check_suite.completed`, `status`, `deployment`, `deployment_status`, `push`, `issues`, `installation`, `installation_repositories` are present (0 missing). ✅
- **§3.2 REST/GraphQL/pagination** — on a real `new Octokit()`: `octokit.rest.pulls.get`, `.rest.checks.listForRef`, `.rest.repos.listDeploymentStatuses`, `.rest.pulls.listReviews`, `octokit.paginate`, `octokit.paginate.iterator`, `octokit.graphql`, `octokit.graphql.paginate` are all `function`. `@octokit/core/dist-types/index.d.ts` types `graphql: typeof graphql`. ✅
- **§3.4 304 handling primitive** — `@octokit/request-error/dist-types/index.d.ts` exposes `status: number`. ✅ (whether octokit *throws* vs returns for 304 remains UNVERIFIED, see below — doc already flags this.)
- **§3.5 throttling** — `@octokit/plugin-throttling/dist-types/types.d.ts` `ThrottlingOptionsBase = { enabled?; fallbackSecondaryRateRetryAfter?; retryAfterBaseValue?; onRateLimit: LimitHandler(required) }`; `onSecondaryRateLimit` supplied via the `SecondaryLimitHandler` union. Matches doc. ✅
- **§6 AES-256-GCM stdlib** — ran the doc's exact `createCipheriv('aes-256-gcm')` / `getAuthTag` / `createDecipheriv` / `setAuthTag` roundtrip on Node v26.0.0: roundtrip succeeds, `tagLen=16`, `ivLen=12`, `scryptSync` is a function. No external dep needed, as claimed. ✅

### CORRECTED claims

None. No signature, package name, import path, export, or field name in the doc was found to contradict the installed `.d.ts` or runtime behavior. The only deltas are **harmless omissions** (the doc simplifies, but nothing it states is false):
- **§3.1** the doc writes the `App` instance `oauth` as `OAuthApp<{clientType:"github-app"}>`; the real type carries an extra type param `{ clientType:"github-app"; Octokit: OctokitClassType<TOptions> }`. Simplification, not an error.
- **§1.1/§3.1** `InstallationAccessTokenData` also carries `createdAt: UTC_TIMESTAMP` and optional `singleFileName` that the doc's inline list omits. Additive, not wrong.
- **§2.2** the real `Webhooks` class also has `removeListener` (not listed) and additionally re-exports the types `EmitterWebhookEvent`, `EmitterWebhookEventName`, `WebhookError`. The doc's export list is a correct subset of the *value* exports.

### Upgraded from UNVERIFIED → now verified

- **Open item #3 (PKCS#1 vs PKCS#8):** POSITIVELY VERIFIED. Generated a PKCS#1 RSA key (`privateKeyEncoding:{type:"pkcs1",format:"pem"}`) and both (a) constructed `new App({...})` and (b) minted an app JWT via `createAppAuth({appId,privateKey})` → `auth({type:"app"})` returned `{ type:"app", token, appId, expiresAt }` with **no conversion and no error** on Node v26.0.0. So `@octokit/auth-app` accepts PKCS#1 directly. (yapm targets Node 24 LTS; not tested on 24, but the `crypto` sign path is stable across 20–26. Treat the 24-specific confirmation as the only residual.)

### Still UNVERIFIED (unchanged — not checkable from `.d.ts`; doc already flags all of these)

- **§2.1 / §7-#1** live-payload `action` enums & nested field paths for `pull_request_review` / `check_suite` / `push` (event *existence* is verified via `emitterEventNames`; exact enum lists come from the docs page, not the types probe).
- **§3.4 / §7-#2** whether octokit surfaces a `304` as a thrown `RequestError(status:304)` vs a normal response — needs a live authorized conditional request.
- **§2.3 / §7-#4** exact Hono wiring of `createWebMiddleware` vs manual raw-body HMAC (both middleware exports exist and are `function`; the Hono integration itself is untested).
- **§3.5 / §7-#6** GraphQL-specific secondary-limit point costs (REST 900-points/min is documented; GraphQL node-cost model not probed).
- **§3.3 / §7-#5** Mergify per-org-stream internals — cited from TECHSTACK's characterization, no external source.
- **Node 24 LTS** specifically — probe ran on Node v26.0.0 (as the doc also notes); APIs used are stable but 24 itself was not exercised.

**Bottom line:** the doc's package versions, import paths, class/function signatures, and field names are accurate against the real installed types and runtime. No corrections required; the items the doc itself marked UNVERIFIED are the only genuine gaps, and one of them (PKCS#1 key acceptance) is now confirmed working.
