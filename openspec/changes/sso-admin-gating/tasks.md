## 1. Close the hole: the plugin's options and the removed paths

- [ ] 1.1 `apps/server/src/auth.ts`: change `sso()` to `sso({ providersLimit: SSO_PROVIDERS_LIMIT,
      domainVerification: { enabled: true } })` with `SSO_PROVIDERS_LIMIT` a named module constant
      (a small number, never `0` — the plugin reads `0` as "registration disabled" and would refuse
      the admin surface too, index.mjs:2552). Keep `satisfies BetterAuthOptions`.
- [ ] 1.2 Same file: add `disabledPaths` to the returned options with **exactly** the seven
      provider-management paths from design §D1 — `/sso/register`, `/sso/update-provider`,
      `/sso/delete-provider`, `/sso/providers`, `/sso/get-provider`,
      `/sso/request-domain-verification`, `/sso/verify-domain`. Export the array as a named constant
      so the test can assert it and so a reader can see the sign-in paths are not in it. A comment
      states the one constraint the code cannot express: these are paths, matched exactly after
      `normalizePathname`, and **no callback path may ever be added here**.
- [ ] 1.3 Same file: widen `AuthService` with narrow SSO methods — `registerSsoProvider`,
      `updateSsoProvider`, `deleteSsoProvider`, `requestSsoDomainVerification`, `verifySsoDomain` —
      each taking `(headers, body)` and delegating to `auth.api.*`. Do **not** widen the interface to
      expose the `auth` instance; the existing comment explains why and the pg tests fake this
      interface.
- [ ] 1.4 Boot the dev stack (`POSTGRES_HOST_PORT=5450 ZERO_CACHE_HOST_PORT=4858
      YAPM_HOST_PORT=3010 docker compose -p yapm-sso -f docker/docker-compose.dev.yml up`) from
      `down -v` and capture the **real** `ssoProvider` DDL better-auth emits (`\d+ "ssoProvider"`
      or `information_schema`). Record it in `reference/kysely-stack.md` beside the `user` DDL and
      in `design.md` under `## Decisions made during implementation`. Do not write this DDL from
      memory.

## 2. The database seam — redacted reads, the availability probe, workspace ownership

- [ ] 2.1 `packages/schema/src/db/types.ts`: add `SsoProviderTable` and the `ssoProvider: SsoProviderTable`
      entry, spelled from the DDL captured in 1.4 (camelCase, quoted, `domainVerified` nullable).
- [ ] 2.2 `packages/schema/src/db/sso.ts` (new), exported from `db/index.ts`:
      `hasUsableSsoProvider(db)` (one count of rows with `domainVerified = true`),
      `listSsoProvidersRedacted(db)` returning `{ providerId, issuer, domain, domainVerified,
      discoveryEndpoint, clientIdLastFour }` and **nothing else** — no `clientSecret`, no
      `privateKey`, no `decryptionPvk` — and `claimSsoProvider(db, providerId, userId)` for the
      ownership transfer of design §D4. A comment records the constraint: this file is the only
      place in yapm that reads a better-auth-owned config table, and the only field it ever writes
      is the ownership pointer.
- [ ] 2.3 `packages/schema/src/db/schema-drift.test.ts`: add `createAuthSsoProviderTable` mirroring
      `createAuthUserTable`, using the 1.4 DDL, and add the `ssoProvider` entry to `KYSELY_DB`. Add
      `ssoProvider` to the "server-only tables are excluded from the Zero schema" list with a
      sentence saying why it must never sync (it holds client secrets).

## 3. The admin surface

- [ ] 3.1 `apps/server/src/sso/admin-routes.ts` (new), `SSO_API_BASE = '/api/v1/sso'`. Copy the
      `requireAdmin` middleware shape from `apps/server/src/connectors/admin-routes.ts` exactly —
      session → `workspace_member` row → 401/403 — and register it as route middleware on every
      handler so authorization is evaluated before `:providerId` is resolved (design §D3).
- [ ] 3.2 Handlers: `GET /` (status + redacted list via 2.2), `POST /providers` (register),
      `POST /providers/:providerId` (update), `DELETE /providers/:providerId`,
      `POST /providers/:providerId/domain-verification`, `POST /providers/:providerId/verify`. Zod
      body schemas at the door, following the `configBody`/`keyBody` style in
      `apps/server/src/ai/admin-routes.ts`. Every mutating handler calls `claimSsoProvider` first,
      then the matching `AuthService` method. Map the plugin's `APIError` statuses onto typed JSON
      errors; never leak the plugin's message verbatim if it names another provider.
- [ ] 3.3 `apps/server/src/app.ts`: add an optional `ssoAdmin?: Hono` and mount it beside
      `aiAdmin`. `apps/server/src/index.ts`: construct and pass it.
- [ ] 3.4 `apps/server/src/auth-routes.ts`: `/api/auth-methods` reports
      `sso: await hasUsableSsoProvider(db)`. Replace the stale comment that says SSO is always
      available with what is now true. Leave the route anonymous — the flag is exactly as sensitive
      as the `github` flag beside it.

## 4. The web surfaces

- [ ] 4.1 `apps/web/src/auth/use-auth-methods.ts`: `DEFAULT_METHODS.sso` becomes `false` and
      `asMethods` reads `record.sso === true`, matching `github`. Update the comment.
- [ ] 4.2 `apps/web/src/components/auth/login-form.tsx`: no code change is expected — verify that
      `methods.sso` already gates the button and that `hasProviders` collapses the divider when both
      providers are absent. If it does not, fix it; do not restructure the form.
- [ ] 4.3 `apps/web/src/settings/sso.ts` (new): typed client for `/api/v1/sso`, following
      `apps/web/src/settings/connectors.ts` — one `request<T>` helper, a `SsoRequestError` carrying
      the status, and interfaces mirroring the server's redacted shapes.
- [ ] 4.4 `apps/web/src/settings/sso-view.tsx` (new): the admin surface of design §D8 — provider
      list, register form, the TXT record with a copy control and a Verify button for an unverified
      provider, delete confirm. Non-admin (403) renders the same absence the AI and connectors views
      render, not an error. Tokens only, AA in all three themes light and dark, every control
      keyboard-reachable, status/alert regions for verification results.
- [ ] 4.5 `apps/web/src/routes/settings.sso.tsx` (new), copying `settings.ai.tsx` verbatim in shape;
      regenerate `routeTree.gen.ts`. Add the menu item to `apps/web/src/components/user-menu.tsx`
      beside Connectors and AI.

## 5. Tests

- [ ] 5.1 **The falsifiable check.** `apps/server/src/sso/admin-routes.pg.test.ts`, live Postgres,
      real `createAuth` + `migrateAuth()`, one file asserting in both directions:
      (a) a signed-in workspace **member**, a **viewer**, and an authenticated **non-member** each
      get `403` from `POST /api/v1/sso/providers` and **no `ssoProvider` row is created** — asserted
      for a provider id that does not exist and one that does, so the answer is proven independent
      of existence; (b) an anonymous caller gets `401`; (c) a workspace **admin** gets `200` and the
      row exists; (d) `POST /api/auth/sso/register` returns **404** for that same admin session;
      (e) with `domainVerified` set true, an **anonymous** `POST /api/auth/sign-in/sso` carrying a
      matching email domain still returns the provider's authorization URL. (e) is in the same file
      as (a)-(d) deliberately — spec requirement "Locking administration does not lock sign-in".
      Register with `oidcConfig.skipDiscovery: true` and explicit endpoints so the test needs no
      outbound network.
- [ ] 5.2 `apps/server/src/auth-routes.pg.test.ts` (or a sibling): `/api/auth-methods` reports
      `sso: false` with no provider, `false` with a registered-but-unverified provider, and `true`
      once `domainVerified` is set.
- [ ] 5.3 Unit test in `apps/server/src/auth.test.ts` (new or existing): the exported
      `disabledPaths` constant contains every one of the seven management paths and **none** of the
      sign-in/callback paths listed in design §D1. This is the regression guard against someone
      adding `/sso/callback` to the list.
- [ ] 5.4 Unit test for `listSsoProvidersRedacted`: given a row whose `oidcConfig` JSON contains a
      `clientSecret`, the returned object has no key whose name or value carries it. Assert on the
      serialized object, not on the type.
- [ ] 5.5 `apps/web/src/components/auth/login-form.test.tsx`: with `sso: false` no
      `login-sso` testid renders; with `sso: true` it does and activating it starts the flow.
- [ ] 5.6 `apps/web/src/settings/sso-view.test.tsx`: unverified provider renders the TXT record and
      the Verify control; a 403 renders the admin-only absence; no secret string reaches the DOM.
- [ ] 5.7 `pnpm turbo lint typecheck test build`, then the compose smoke test on
      `-p yapm-sso` with the assigned ports. Report actual output.

## 6. Documentation

- [ ] 6.1 `apps/docs/src/content/docs/self-hosting/sso.md` (new): the whole configuration path —
      who may do it (workspace admin), the `/settings/sso` walkthrough, the DNS TXT step and why it
      exists, and a **copy-pasteable** `curl` against `/api/v1/sso/providers` with an admin session
      cookie for operators who prefer the API. Include the SAML note (API-only, no UI) and the
      upgrade note from design §"Migration / Rollout": any provider registered before this change
      is now unverified and must be verified before it can sign anyone in.
- [ ] 6.2 `apps/docs/astro.config.mjs`: add the page to the Self-hosting sidebar. Expect to rebase —
      the concurrent `deployment-hardening` build also adds pages to this list.
- [ ] 6.3 `README.md`: the "What works today" sign-in claim only — say OIDC/SSO is
      admin-configured, and leave the rest of the file to the sibling build. One line, surgical.
- [ ] 6.4 `ROADMAP.md`: row 25 for this change, in the established voice.
- [ ] 6.5 `design.md` gains its `## Decisions made during implementation` section: at minimum the
      captured DDL (1.4), anything the plugin did differently from what §D1-§D8 predicted, and the
      final `providersLimit` value with its reasoning.
