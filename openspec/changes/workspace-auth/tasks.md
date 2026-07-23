# workspace-auth — tasks

## 1. Dependencies and configuration

- [x] 1.1 Add `better-auth` and `@better-auth/sso` to the pnpm catalog and to `apps/server` (runtime); `jose@^6` added for local JWKS verification. `pnpm peers check` shows no jose issue and the v5/v6 pair coexists (server resolves 6.2.4, Zero 5.10.0). `packages/schema` deliberately does NOT depend on better-auth (drift test reproduces the `user` DDL; see design log).
- [x] 1.2 Extend `apps/server/src/config/env.ts` (Zod) with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_ORIGIN`, optional `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, optional `SMTP_URL`, and optional `YAPM_BOOTSTRAP_ADMIN_EMAIL`; each in `EXPECTED_FORMAT`. Defaults keep an empty `.env` booting; optional vars treat empty strings as unset (SSO/OIDC needs no static env — see design log).
- [x] 1.3 Add the new env vars to `turbo.json` `passThroughEnv` for `dev`, and to `docker/docker-compose.yml` with `${VAR:-default}` placeholders documented as "change in production" (the dev compose has no app container; host-run dev uses turbo passThroughEnv).

## 2. Data layer (packages/schema)

- [x] 2.1 Extend the hand-written `DB` interface (`src/db/types.ts`) with `workspace_member`, `team`, `team_membership`, `invite` tables and the better-auth-owned `user` table (read surface), keeping client-minted `id: string` PKs and snake_case app columns.
- [x] 2.2 Write forward-only migration `0002_workspace_auth` adding the four tables (FKs, unique keys on `workspace_member(user_id)`, `team(key)`, `team_membership(team_id,user_id)`, `invite(token)`), extending `workspace`, and remapping any seeded role `owner`→`admin`; register it in `migrations/index.ts`.
- [x] 2.3 Update `WORKSPACE_ROLES` to `['admin','member','viewer']` in `src/zero/context.ts`; add `canManage` (admin) and make `AuthContext.role` nullable for authenticated non-members; keep `canWrite = role ≠ 'viewer' && role ≠ null`.

## 3. Zero schema and sync definitions (packages/schema)

- [x] 3.1 Add `workspace_member`, `team`, `team_membership`, `invite`, and read-only `user` to the Zero schema with relationships (workspace→members/teams/invites, team→memberships, membership→user), mapping timestamps to `number().from(...)`.
- [ ] 3.2 Rewrite `queries.ts` with membership/role row-level permissions: `workspace.current`, member roster, `user` profiles (members only), teams + rosters (members only), invites (admins only), all driven by `ctx` with `denyAll` for non-members; add a `teamScoped` `whereExists` helper for future work data.
- [ ] 3.3 Rewrite `mutators.ts`: workspace rename (admin), member role-change/remove/leave with last-admin protection, team create/rename/archive (admin) and join/leave (self-serve), invite create/revoke and accept — each checking auth before existence, minting UUIDv7 at the call site.
- [x] 3.4 Extend the schema-drift test to cover the four new tables and the `user` read surface; keep it a hard CI failure.

## 4. Authentication server (apps/server)

- [x] 4.1 Add `src/auth.ts`: `betterAuth` on the shared Kysely instance (`{db, type:'postgres'}`), `emailAndPassword` (verification off), `socialProviders.github` (when configured), `@better-auth/sso`, `bearer()` + `jwt({ expirationTime:'1h', issuer/audience })`, session `expiresIn:30d/updateAge:1d`. Exposes a narrowed `AuthService` (`handler`, `getSessionUser`, `migrateAuth`, `issueSyncToken`, `verifySyncToken`) plus `buildAuthOptions`.
- [x] 4.2 Mount better-auth on Hono (`src/auth-routes.ts`): CORS before the route, `app.on(['POST','GET'], '/api/auth/*', ...)`, a `requireSession` middleware, and `GET /api/zero/token` returning `{token, userID, role}`. Verified against real Postgres (sign-up → token, unauth → 401).
- [x] 4.3 Call `migrateAuth()` in boot order after the Kysely `Migrator` and before serving; single-path with the unguarded-migration caveat documented. Verified: boot created `session/account/verification/jwks/ssoProvider`.
- [x] 4.4 Replace `resolveAnonymousContext` with `createSessionContextResolver`: verify the forwarded Bearer JWT locally against the JWKS (loopback fetch, issuer/audience checked), extract `sub` as `userID`, look up `workspace_member.role`, return `{userID, role|null}`; `X-Api-Key` gate kept. Verified: valid token → real userID + no deny; no/invalid token → deny + `userID:null`.
- [x] 4.5 First-admin bootstrap on the completed-sign-in token call: advisory-locked insert-if-no-members via the Schema-phase `bootstrapFirstAdmin`, honoring `YAPM_BOOTSTRAP_ADMIN_EMAIL`. Verified: first email sign-up → one `admin` member.
- [x] 4.6 Invite-accept path `POST /api/invites/accept` → `acceptInvite` (`packages/schema/src/db/invite.ts`): membership + optional team membership, enforcing expiry/revoke/email-binding and single-use vs reusable link semantics. Verified via DB tests (7 cases) and HTTP smoke (401/400/404).

## 5. Web app (apps/web)

- [ ] 5.1 Add a better-auth client + session provider; feed the Zero client its JWT from `/api/zero/token` and refresh on sync 401/403 via `zero.connection.connect({auth})`.
- [ ] 5.2 Add sign-in / sign-up / sign-out surfaces (email/password, GitHub, SSO), fully keyboard-operable with announced validation errors.
- [ ] 5.3 Add the access-gate screen for authenticated non-members (explain invite requirement + sign-out).
- [ ] 5.4 Add member management UI (list, change role, remove, leave; last-admin guard reflected), keyboard-operable.
- [ ] 5.5 Add team management UI (create/rename/archive, join/leave, manage roster), keyboard-operable.
- [ ] 5.6 Add invite management UI (create email/link invite with role+optional team, copy link, revoke), keyboard-operable.

## 6. Tests and verification

- [ ] 6.1 Unit-test the shared mutators' authorization (viewer/non-member rejection, last-admin protection, auth-before-existence, UUIDv7 at call site) and the permissioned queries (non-member `denyAll`, admin-only invites) in `packages/schema`.
- [x] 6.2 Unit-test the auth-context resolution (`apps/server/src/zero/context.test.ts`: no header, non-Bearer, invalid token, member, non-member `role:null`, verified-`sub`-not-client) and the first-admin bootstrap gate (`packages/schema/src/db/seed.test.ts`: non-matching email short-circuits before the DB; case-insensitive/trimmed match proceeds). Bootstrap concurrency was proven against real Postgres in the Schema phase (advisory-locked insert-if-no-members); the Auth phase re-verified one `admin` from the first real sign-up.
- [ ] 6.3 e2e (Playwright) against the real stack: email sign-up → first-user-becomes-admin → create team → invite (link) → second user accepts → sees only permitted rows → viewer cannot write; include the keyboard-only sign-in and member-management paths.
- [ ] 6.4 Update the boundary-guard/CI expectations if needed and run `pnpm turbo lint typecheck test build` plus the compose smoke test; confirm exactly three services.
