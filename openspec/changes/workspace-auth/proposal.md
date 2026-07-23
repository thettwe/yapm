# workspace-auth

## Why

The foundation change proved the Zero sync pipeline with a single throwaway `workspace` row that every client can read and every caller can rename. yapm cannot be used by a real team until it knows *who* the caller is and *what* they are allowed to see. This change turns the walking-skeleton `workspace` into the real identity-and-access model — users, one workspace, teams, roles, invites — and replaces "all rows visible to everyone" with row-level sync permissions driven by membership. It is the schema-risk foundation the roadmap sequences second, before any work-tracking entity, because every future table (issue, PR link, deploy) hangs off this graph and inherits its permission story.

Serves vision principles: **#5 Free means free** (email/password, GitHub OAuth, and OIDC/SSO are all free and unpaywalled; the viewer role is free and unlimited with no seat cap), **#6 Deployable in minutes** (auth is in-process and Postgres-backed — zero new containers, no SMTP required to start), and **#1 Speed is the feature** (permissions are expressed inside the synced-query definitions so authorized reads still resolve locally in sub-100ms).

## What Changes

- **Redesign the placeholder `workspace` table into the real model.** One workspace per instance (the instance root), with the identity/authorization graph built around it: `user` (better-auth), `workspace_member` (the role edge), `team`, `team_membership`, and `invite`.
- **Roles** `admin` / `member` / `viewer` at the workspace level (replacing foundation's `owner`/`member`/`viewer` placeholder). Viewer is a first-class, free, unlimited read-only role. Team membership is an orthogonal edge that gates which teams' work data a user syncs.
- **better-auth on its native Kysely layer, in-process** (**no new container**): email/password, GitHub OAuth, and OIDC/SSO — **all free, none gated**. Auth tables migrate at boot via `getMigrations()`. Email verification defaults **off** so a fresh self-host needs no SMTP.
- **Sessions and a Zero sync JWT.** better-auth issues the session (bearer + cookie) and a short-lived JWT that zero-cache forwards to the `/query` and `/mutate` endpoints; the server derives the auth context (verified `userID` + workspace role) from it, replacing foundation's `resolveAnonymousContext`.
- **First-admin bootstrap.** On a fresh instance the first authenticated user becomes `admin` atomically (advisory-locked), with an optional `YAPM_BOOTSTRAP_ADMIN_EMAIL` override for locked-down instances.
- **Invitations** by **both** single-use email invite and reusable shareable link, each carrying a role (and optionally a team); accept, revoke, and expiry. Works with or without SMTP (the link is always copyable).
- **Row-level sync permissions.** Every synced query and every mutator enforces membership/role in `packages/schema`: a user syncs only the rows they can see (the workspace, member profiles, teams, and — established here for future work data — their teams' rows). Reads are denied by returning an empty query; auth is checked before existence so private rows never leak.
- **Sign-in / member / team / invite UI**, all keyboard-operable, plus an access-gate screen for authenticated non-members.

## Capabilities

### New Capabilities

- `authentication`: better-auth sign-up/in/out with email/password, GitHub OAuth, and OIDC/SSO (all free); session issuance; short-lived Zero sync JWT; server-side auth-context resolution from the verified session; email verification off by default.
- `workspace-membership`: the real single `workspace` entity; `workspace_member` role edge (admin/member/viewer); first-admin bootstrap; member listing, role changes, and removal; access gating for authenticated non-members.
- `teams`: `team` and `team_membership` entities; create/rename/archive teams; join/leave; admin management of team rosters; team membership as the visibility edge for future work data.
- `invitations`: `invite` entity supporting single-use email invites and reusable shareable links; role (and optional team) on invite; accept, revoke, expiry.

### Modified Capabilities

- `local-first-sync`: server-controlled synced queries gain **real row-level permissions** (membership/role joins, deny-by-empty, auth-before-existence) in place of the foundation's single-tenant "all rows visible"; shared mutators become role-gated across the real membership model.
- `self-host-deploy`: boot-time migrations additionally run better-auth's `getMigrations()`; new Zod-validated env vars for auth secret, base URL, GitHub OAuth, OIDC/SSO, optional SMTP, and bootstrap admin — with the three-container contract explicitly preserved (auth is in-process).

## Impact

- **Schema** (`packages/schema`): redesigned `workspace`; new `workspace_member`, `team`, `team_membership`, `invite` Kysely tables + Zero schema + drift test; new synced queries and mutators with membership joins; role enum change `owner`→`admin`.
- **Server** (`apps/server`): mount better-auth on Hono (`/api/auth/*`), add `/api/zero/token`, replace `resolveAnonymousContext` with JWT/session verification resolving `{userID, role}`, first-admin bootstrap on sign-in, invite-accept endpoint/mutator.
- **Web** (`apps/web`): sign-in/up/out surfaces, session provider feeding the Zero client its JWT (with refresh on 401/403), members/teams/invites admin UI, access-gate screen.
- **Dependencies**: `better-auth` + `@better-auth/sso` (already anticipated in the catalog); watch the documented `jose` v5/v6 collision (Zero wants 5, better-auth wants 6).
- **Config**: new env vars documented and defaulted so `docker compose up` still boots with an empty `.env`; no new service in `docker-compose.yml`.

## Non-goals

- **Issues and any product-work entities** — that is `issue-core`, the next change. This change only lands the identity/access graph and the team-membership edge future work data will join against.
- **GitHub issue/PR sync** — that is `github-sync`. GitHub here is only an OAuth sign-in provider, not a data integration.
- **Billing of any kind** — no seat counting, no plans, no license keys, no upsell UI (free means free).
- **Multiple workspaces per instance, custom/granular permission schemes, per-team roles, SCIM/directory provisioning, and audit logs** — out of scope for v1.
