## Why

`apps/server/src/auth.ts` registers better-auth's SSO plugin as bare `sso()` — no
`providersLimit`, no `domainVerification`, no access control — and `apps/server/src/auth-routes.ts`
mounts the whole better-auth handler at `/api/auth/*` for GET and POST. The word `requireAdmin`
does not appear in that file. In the installed plugin (`@better-auth/sso@1.6.24`),
`POST /sso/register` is gated by `sessionMiddleware` and a per-user cap and nothing else, and
`POST /sign-in/sso` resolves a provider **purely by the email domain the caller types**.

Sign-up is open (`emailAndPassword: { enabled: true }`); workspace membership gates the *app*, not
account creation. So on any public instance **anyone who can sign up — including an authenticated
non-member sitting at the AccessGate — can bind their own IdP to any email domain, after which yapm
itself will redirect that domain's real employees, from yapm's own origin, to an
attacker-controlled authorization endpoint.** Every other configuration surface in the product
(`/api/v1/connectors`, `/api/v1/ai`) is admin-gated. This one is not. It is the most serious
authorization defect currently on main and it is fixed first.

The same code is dishonest in the other direction. `auth-routes.ts:67` reports `sso: true`
unconditionally, `use-auth-methods.ts:11` defaults it true, and `login-form.tsx:200-211` therefore
renders "Continue with SSO" on **every** instance — a button that leads nowhere, because yapm ships
no supported way to register a provider at all. README lists OIDC among shipped sign-in methods;
`openspec/specs/authentication/spec.md:8` says enabling a method SHALL be env-driven (it is not) and
`:22-25` says an operator can configure OIDC (today none can). Locking the endpoint without giving
operators a way in would turn a vulnerability into a lockout, so both halves ship together.

Vision principles served: **free means free** (constraint #7) — SSO stays free, unlimited and
un-upsold, it merely becomes *administered*; and the codebase's own settled rule that an
unconfigured capability is **cleanly absent, never an empty state that advertises itself**
(archived `pm-digest-governance` §I4, `pm-digest-boundary` §D9).

## What Changes

- **BREAKING (surface removal).** The seven better-auth SSO **provider-management** paths are
  removed from the public handler via better-auth's `disabledPaths`, so they answer 404 to
  everyone: `/sso/register`, `/sso/update-provider`, `/sso/delete-provider`, `/sso/providers`,
  `/sso/get-provider`, `/sso/request-domain-verification`, `/sso/verify-domain`. `disabledPaths`
  matches an **exact** normalized pathname, so no sign-in or callback path can be caught by it.
- The **sign-in and callback paths stay anonymous-reachable and untouched**: `POST /sign-in/sso`,
  `GET /sso/callback/:providerId`, `/sso/callback`, `/sso/saml2/callback/:providerId`,
  `/sso/saml2/sp/acs/:providerId`, `/sso/saml2/sp/slo/:providerId`, `/sso/saml2/logout/:providerId`,
  `GET /sso/saml2/sp/metadata`. design.md §D1 enumerates both lists and says which is which.
- **NEW admin surface `/api/v1/sso`**, beside `/api/v1/connectors` and `/api/v1/ai` and built from
  the same `requireAdmin` middleware shape: list, register, update, delete, request domain
  verification, verify domain. Authorization is checked **before any existence check**, so a
  non-admin cannot learn whether a provider id exists. Every handler delegates to `auth.api.*`
  server-side, so all of better-auth's OIDC discovery and config validation still runs.
- `sso()` gains its own hardening: **`providersLimit`** (a small named constant, not the plugin's
  default 10) and **`domainVerification: { enabled: true }`**, which requires a DNS TXT record on
  the email domain before that provider may be used to sign in. It needs no new service —
  the plugin resolves the record with `node:dns/promises` in-process. design.md §D5 records the
  cost this imposes on evaluation instances.
- **SSO providers become workspace configuration rather than per-user property.** The plugin scopes
  a provider row to the `userId` that registered it; yapm has exactly one workspace and presents
  providers as workspace config, so the admin list reads every provider (redacted) and a write by a
  different workspace admin transfers the row's `userId` before delegating. design.md §D4.
- **`GET /api/auth-methods` reports `sso` honestly**: available only when at least one **verified**
  provider is registered. A half-configured provider therefore yields *no button* rather than a
  button that errors. `useAuthMethods` defaults `sso` to **false**, matching `github`.
- **NEW `/settings/sso`**, an admin-only settings route beside `/settings/ai` and
  `/settings/connectors`: register an OIDC provider, see the DNS TXT record to publish, verify it,
  and delete. Keyboard-first, tokens only, AA in all three themes light and dark. Client secrets are
  write-only — the surface renders the last four of the client id and never any secret material,
  exactly as the connectors and AI surfaces do.
- **No migration.** better-auth's `getMigrations()` owns the `ssoProvider` table and adds its
  `domainVerified` column at boot. The hand-written Kysely `DB` interface gains an `ssoProvider`
  entry (the `user` precedent) and `schema-drift.test.ts` gains the matching DDL, captured from
  live Postgres rather than assumed.
- Prose reconciled: README's sign-in claim, and `openspec/specs/authentication` requirements 8 and
  22-25, describe what actually ships. A new self-hosting docs page is the discoverable
  configuration path whose absence created this situation.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `authentication`: registering, updating, deleting and domain-verifying an SSO provider becomes
  **workspace-admin-only**, refused with an authorization answer evaluated before any existence
  check; the SSO **sign-in** path remains reachable to anonymous callers and is stated as a separate
  requirement so a future tightening cannot silently take it; a sign-in method is reported as
  available only when it is actually usable, replacing "enabling a method SHALL be env-driven" with
  what is true (env for GitHub, a registered-and-verified provider for SSO); and an OIDC provider
  becomes configurable by a documented, admin-authenticated path.

## Impact

- `apps/server/src/auth.ts` — `sso({ providersLimit, domainVerification })`, `disabledPaths`, and
  the narrow SSO methods added to the `AuthService` interface (the raw `Auth<Options>` stays hidden,
  as that interface's comment requires).
- `apps/server/src/sso/admin-routes.ts` (new) — the `/api/v1/sso` admin surface.
- `apps/server/src/auth-routes.ts` — `/api/auth-methods` reports SSO availability from the database.
- `apps/server/src/app.ts`, `apps/server/src/index.ts` — mounting and wiring.
- `packages/schema/src/db/sso.ts` (new) + `db/index.ts` — the redacted workspace-wide provider read,
  the availability probe, and the ownership transfer. No secret material ever leaves this file.
- `packages/schema/src/db/types.ts` — the hand-written `ssoProvider` table type.
- `packages/schema/src/db/schema-drift.test.ts` — better-auth's `ssoProvider` DDL, captured live.
- `apps/web/src/settings/sso.ts` (new), `apps/web/src/settings/sso-view.tsx` (new),
  `apps/web/src/routes/settings.sso.tsx` (new), `apps/web/src/routeTree.gen.ts`,
  `apps/web/src/components/user-menu.tsx`.
- `apps/web/src/auth/use-auth-methods.ts`, `apps/web/src/components/auth/login-form.tsx` — the
  SSO button appears only when SSO works.
- No new dependency, no new container, no new env var, no migration, no Zero schema change, no
  mutator, no ZQL.

Docs: `apps/docs/src/content/docs/self-hosting/sso.md` (new — the configuration path, the DNS TXT
step, and the copy-pasteable admin request for operators who prefer the API), the docs sidebar in
`apps/docs/astro.config.mjs`, `README.md`'s "What works today" sign-in claim (surgical — the sibling
`deployment-hardening` build owns the rest of that file), `ROADMAP.md` row 25, and
`openspec/specs/authentication/spec.md` via this change's delta.

## Non-goals

- **No SAML configuration.** The plugin's SAML **sign-in** endpoints keep working, are anonymous and
  are untouched, but `/settings/sso` registers OIDC only. SAML's configuration surface is an order of
  magnitude larger and nothing in v1 asks for it. *(Superseded in part by design.md §L11: as built
  there is no SAML registration path at all — the admin body requires `oidcConfig` — so the docs page
  says so and names the OIDC-bridge workaround, rather than pointing at an API that would reject it.)*
- **No new env var and no changes to `apps/server/src/config/env.ts`, `.env.example`, `docker/`,
  `SECURITY.md` or `apps/web/src/zero/provider.tsx`** — the concurrent `deployment-hardening` build
  owns those files.
- **No second notion of "admin".** The gate resolves the caller's `workspace_member.role`, which is
  the same fact `requireAdmin` already encodes in the connectors and AI surfaces.
- **No organization-scoped SSO.** better-auth's organization plugin is not installed; yapm has one
  workspace and provider rows carry no `organizationId`.
- **No provider registry table, no yapm-side copy of provider config.** better-auth owns
  `ssoProvider`; yapm reads it redacted and never duplicates it.
- **No seat cap, licence check, plan gate or upsell anywhere in this change.** Admin-gating a
  configuration surface is not a paywall, and the delta spec says so in a scenario.
