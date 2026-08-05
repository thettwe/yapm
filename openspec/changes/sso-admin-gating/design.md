# Design — sso-admin-gating

Every claim below about `@better-auth/sso` was read out of the installed
`node_modules/.pnpm/@better-auth+sso@1.6.24_.../dist/index.mjs` and its `.d.mts`, not recalled.
Line references are to that build.

## D1 — Which `/api/auth/sso/*` path is which

The single most dangerous way to get this change wrong is a prefix gate on `/api/auth/sso/*`,
because the OIDC **callback** lives under that prefix and an anonymous browser must reach it
mid-flow. The plugin's endpoints split cleanly in two, and the split is by exact path, not by
method — `delete-provider` is a **POST**, so method-based gating would be both wrong and unsafe.

**Provider management — MUST be workspace-admin-only.** Every one of these is gated today by
`sessionMiddleware` alone (`use: [sessionMiddleware]` at index.mjs 1321, 1368, 1437, 1518, 1564,
1601, 2381):

| Path | Method | What it does |
|---|---|---|
| `/sso/register` | POST | Creates a provider bound to a domain. **The vulnerability.** |
| `/sso/update-provider` | POST | Rewrites issuer, endpoints, client secret, domain |
| `/sso/delete-provider` | POST | Removes a provider |
| `/sso/providers` | GET | Lists the caller's providers |
| `/sso/get-provider` | GET | Returns one provider's (sanitized) config |
| `/sso/request-domain-verification` | POST | Mints the DNS TXT token |
| `/sso/verify-domain` | POST | Flips `domainVerified` |

**Sign-in and callback — MUST stay reachable to anonymous callers.** These are the flow itself and
this change does not touch them:

| Path | Method | Why anonymous |
|---|---|---|
| `/sign-in/sso` | POST | The entry point. **Not under `/sso/`** — a prefix gate would miss it, a prefix *deny* would not catch it either. |
| `/sso/callback/:providerId` | GET | The IdP redirects the browser here with no yapm session yet |
| `/sso/callback` | GET | Shared-redirect-URI variant |
| `/sso/saml2/callback/:providerId` | POST | SAML SP-initiated response |
| `/sso/saml2/sp/acs/:providerId` | POST | SAML assertion consumer |
| `/sso/saml2/sp/slo/:providerId` | GET/POST | Single logout |
| `/sso/saml2/logout/:providerId` | GET | Initiates SLO |
| `/sso/saml2/sp/metadata` | GET | SP metadata an IdP fetches unauthenticated |

## D2 — The gate is `disabledPaths` plus a separate admin surface, not a middleware in front of the same paths

Two shapes were available.

**(A) A Hono `requireAdmin` middleware registered before `app.on(['POST','GET'], '/api/auth/*')`,
matching the seven management paths.** Keeps the better-auth URLs. But Hono path matching would have
to enumerate seven exact paths *and* be certain none of them shadow a callback, and the ordering
guarantee lives in one `app.use` call whose position in a 200-line file is load-bearing and
invisible.

**(B) Chosen: `disabledPaths` removes the seven paths from the router entirely, and a new
`/api/v1/sso` admin surface calls the same plugin endpoints server-side.**

Why (B):

1. `disabledPaths` is enforced in better-auth's own `onRequest` (`better-auth/dist/api/index.mjs:164`)
   using `normalizePathname(req.url, basePath)` and `Array.includes` — an **exact** string match on
   the pathname with the query string and trailing slashes stripped
   (`@better-auth/core/dist/utils/url.mjs:18`). `/sso/callback/acme` can never equal `/sso/register`.
   There is no prefix and therefore no way to catch a callback by accident.
2. It is enforced *inside* better-auth, so it cannot be defeated by a future change to how the
   handler is mounted in Hono.
3. `disabledPaths` is checked only in the **router**. `auth.api.registerSSOProvider(...)` and its
   siblings are plain function calls on the endpoints object (`getEndpoints` returns
   `{...pluginEndpoints}` and the router wraps it), so the admin surface still reaches every one of
   them with full OIDC discovery, issuer validation, SAML metadata size limits and config parsing
   intact. Nothing is reimplemented.
4. `/api/v1/sso` puts SSO where connectors and AI keys already live: same `requireAdmin` shape, same
   `/api/v1` versioned surface, same "no secret material in a response" rule, one settings page.

The cost, stated: `POST /api/auth/sso/register` answers **404**, not 403. That is deliberate — the
path is not part of yapm's API and saying "forbidden" would imply it is. The *authorization-shaped*
refusal (`401` with no session, `403` for a signed-in non-admin, evaluated before any lookup) is at
`/api/v1/sso`, which is the surface yapm documents and ships a UI for. Both facts get a test.

`AuthService` (auth.ts) deliberately does not expose the raw `Auth<Options>` — its comment says the
type is invariant in the concrete options and would leak everywhere. So the admin routes do not get
the auth instance either; `AuthService` grows a small set of named methods (`registerSsoProvider`,
`updateSsoProvider`, `deleteSsoProvider`, `requestSsoDomainVerification`, `verifySsoDomain`), each a
thin call into `auth.api.*`. The existing pg tests already fake `AuthService`, so this keeps them
fakeable.

## D3 — `/api/v1/sso`, and authorization before existence

Modelled on `apps/server/src/connectors/admin-routes.ts` and `apps/server/src/ai/admin-routes.ts`,
including their `requireAdmin` middleware verbatim in shape: resolve the session, resolve the
caller's own `workspace_member` row, `401` when there is no session, `403` when `role !== 'admin'`,
and only then set the context the handlers read.

```
GET    /api/v1/sso                                  → { configured, providers: [redacted…] }
POST   /api/v1/sso/providers                        → register (OIDC)
POST   /api/v1/sso/providers/:providerId            → update
DELETE /api/v1/sso/providers/:providerId            → delete
POST   /api/v1/sso/providers/:providerId/domain-verification → { name, value } TXT record to publish
POST   /api/v1/sso/providers/:providerId/verify     → verify, or a typed failure
```

`requireAdmin` runs as route middleware, so it is evaluated **before** the handler resolves
`:providerId`. A signed-in member asking about a provider id that does not exist gets `403`, not
`404` — the same discipline `ai/admin-routes.ts:178` states in prose ("ADMIN-GATED BEFORE ANY
READ"). A non-member with a session (the AccessGate case) has no `workspace_member` row at all,
so `member?.role !== 'admin'` is true and they get the same `403`.

No response from this surface carries `clientSecret`, `privateKey`, `decryptionPvk` or a
verification token belonging to another provider. The redaction mirrors the plugin's own
`sanitizeProvider` (index.mjs:1264): `providerId`, `issuer`, `domain`, `domainVerified`,
`discoveryEndpoint`, and the **last four** of the client id.

## D4 — A provider is workspace configuration, not the registering admin's property

`checkProviderAccess` (index.mjs:1348) authorizes update/delete/verify by `provider.userId === session.user.id`,
and `/sso/providers` lists only rows the caller registered. With the organization plugin absent
that is the *only* access rule.

yapm has exactly one workspace and models SSO as workspace configuration. Left alone, the plugin's
rule produces a real dead end: the admin who set SSO up leaves, and no remaining admin can rotate
the client secret or delete the provider — through any supported path, ever.

**Chosen:** the admin surface treats providers as workspace-owned.

- The **list** reads the `ssoProvider` table directly through a redacting helper in
  `packages/schema/src/db/sso.ts` rather than through `auth.api.listSSOProviders`, because "the
  workspace's providers" is not "my providers".
- A **write** (update, delete, domain verification) first transfers `ssoProvider.userId` to the
  calling workspace admin, then delegates to `auth.api.*`. One `update … set "userId" = ? where
  "providerId" = ?`, run only after `requireAdmin` has passed.

This writes one field of a better-auth-owned table from outside better-auth, which is the single
point in this change most worth a reviewer's attention. It is confined to `packages/schema/src/db/sso.ts`,
it writes only an ownership pointer to a user id better-auth itself minted, and it leaves every
config field to the plugin. The alternative considered and rejected: refuse the write with "another
admin owns this provider" and document the dead end. That is honest but it makes admin handover
impossible without direct SQL, which is worse for a self-hosted product than one narrow write.

## D5 — Domain verification is enabled, and the friction is stated rather than hidden

`domainVerification: { enabled: true }` makes the plugin (a) add a `domainVerified` boolean to the
`ssoProvider` model, (b) mint a token at registration and expose `/sso/request-domain-verification`
and `/sso/verify-domain`, and (c) **refuse sign-in against an unverified provider** (index.mjs 2002,
2874, 3025 — `UNAUTHORIZED "Provider domain has not been verified"`).

It needs no new service: verification resolves `_<prefix>-<providerId>.<domain>` TXT with
`await import('node:dns/promises')` in the app process (index.mjs 1630-1648). The three-container
promise holds.

Enabled, for two reasons. First, it is the only mechanism that makes "this instance may sign in
`@acme.com` employees" a claim about acme.com rather than a claim about whoever clicked Register —
which is exactly the trust the vulnerability abused. Second, admin-gating alone is a *workspace*
boundary, and a workspace with several admins (yapm's normal shape) still has a junior admin able to
bind a domain the company does not own.

**The cost, stated plainly:** an operator evaluating yapm against a throwaway IdP on a domain whose
DNS they cannot edit **cannot complete SSO**. Registration succeeds, verification does not, and
`/api/auth-methods` therefore reports SSO unavailable — no button, rather than a button that fails.
That is the right failure shape but it is still a wall. The escape hatch a later change should add
is the plugin's `defaultSSO` (env-configured providers, auto-verified at index.mjs:1745), which is an
env-var change and therefore belongs to whoever owns `config/env.ts` — the concurrent
`deployment-hardening` build owns that file, so it is out of scope here and is named in Risks
instead of smuggled in.

`providersLimit` is set to a small named constant rather than left at the plugin's default of 10. It
is defence in depth only: with registration admin-gated, the limit bounds what a gate failure could
produce. It must stay ≥ 1 — the plugin treats `0` as "registration disabled" and would refuse the
admin surface too (index.mjs:2552).

## D6 — Availability is a fact about the database, not a constant

`GET /api/auth-methods` is anonymous and currently returns `sso: true` unconditionally. It becomes
`sso: <at least one registered provider whose domain is verified>`, computed by a single indexed
count in `packages/schema/src/db/sso.ts`. That is a boolean of exactly the same sensitivity as the
`github` flag beside it — it says a sign-in method exists, which the button would say anyway.

`useAuthMethods`' optimistic default for `sso` flips from `true` to `false`, matching `github`: a
capability is absent until the instance says it is present. This is the codebase's settled rule for
an unconfigured capability (`pm-digest-governance` §I4: absence, never an empty state) applied to
the login form.

Verified — not merely registered — is the condition, so the states line up: no provider ⇒ no button;
provider registered but DNS not yet published ⇒ no button (and `/settings/sso` tells the admin
exactly why, which is where that message belongs); verified provider ⇒ button, and it works.

## D7 — No migration; better-auth owns the table, the drift test learns its shape

Highest migration on main is `0022`. This change adds none. `getMigrations()` at boot creates
`ssoProvider` and adds `domainVerified` when the option is enabled, on the same path that already
creates `user`, `session`, `account`, `verification` and `jwks`.

The hand-written Kysely `DB` interface gains an `ssoProvider` entry because three reads need it (the
availability probe, the redacted list, the ownership transfer). `schema-drift.test.ts` then requires
the table to exist in Postgres, so it gains a `createAuthSsoProviderTable` helper mirroring the
existing `createAuthUserTable`. **That DDL is to be captured from a live Postgres after boot and
recorded in `reference/kysely-stack.md`, not written from memory** — the same discipline archived
change 24 §L2 used for a constraint name. Column names are better-auth's camelCase (`userId`,
`providerId`, `oidcConfig`, `samlConfig`, `organizationId`, `domainVerified`), quoted, exactly as
`user`'s `emailVerified` already is.

## D8 — `/settings/sso`

A third settings route beside `/settings/ai` and `/settings/connectors`, reached from the same user
menu, rendered inside `Authenticated` + `AppShell`, absent for non-admins because the API answers
403 and the view renders the same "admins only" absence the other two do.

Content: the provider list (issuer, domain, verified state, client-id last four); a register form
(provider id, issuer/discovery URL, client id, client secret, email domain); for an unverified
provider, the exact TXT record name and value with a copy control and a Verify button; and a delete
confirm. Client secret is write-only — entered, never returned, and re-entering it is how it is
rotated, the same contract `/settings/ai` uses for API keys.

Keyboard-first (constraint #10): every control tab-reachable in DOM order, the form submits on
Enter, the copy control is a real button, verification success and failure are announced in a
`role="status"` / `role="alert"` region. Colour and type via tokens only; AA in Warm, Focused and
Editorial, light and dark. No new colour pair is introduced — verified/unverified is carried by
`Badge variant="outline"` plus **words**, the rule archived change 23 §G3 settled.

## Risks / Trade-offs

- **The DNS wall (D5).** Evaluation instances on domains the operator cannot edit lose SSO
  entirely. Mitigated only by documentation here; the real fix is an env-configured `defaultSSO`,
  which this change cannot take because it does not own `config/env.ts`.
- **The 404 on `/api/auth/sso/register` (D2).** Anyone following better-auth's own documentation
  against a yapm instance hits a 404 with no explanation. The docs page names the yapm path;
  a friendlier 410-with-a-pointer would need a Hono route in front of a path better-auth no longer
  serves, which reintroduces exactly the ordering fragility (B) was chosen to avoid.
- **Writing `ssoProvider.userId` from outside better-auth (D4).** Confined to one helper and one
  field, but it is a coupling to a table this repo does not own. A plugin upgrade that renamed that
  column would fail the drift test before it failed in production, which is the intended tripwire.
- **`domainVerified` is the plugin's own flag, and the availability probe trusts it.** If a future
  plugin version stopped writing it, `/api/auth-methods` would report SSO unavailable on a working
  instance — a fail-closed direction, and visible immediately on the login form.
- **SAML is gated but has no UI.** An operator with a SAML IdP must use the API path. Stated in the
  docs page rather than left to be discovered.

## Migration / Rollout

No data migration and no downtime step. On first boot after deploy, `getMigrations()` adds
`ssoProvider.domainVerified` (nullable, no default), so **every provider registered before this
change becomes unverified** and stops being usable for sign-in until its admin publishes the TXT
record. On main today no supported path exists to register one, so the expected population is zero —
but an instance where someone exploited the open endpoint will find those providers disabled, which
is the correct outcome and is called out in the docs page's upgrade note.
