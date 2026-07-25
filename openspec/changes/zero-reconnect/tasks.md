## 1. Reproduce and instrument

- [ ] 1.1 Bring up an isolated stack for this change — `docker compose -p yapm-zr -f docker/docker-compose.dev.yml up -d` with `POSTGRES_HOST_PORT=5441 ZERO_CACHE_HOST_PORT=4849 YAPM_HOST_PORT=3001`, `DATABASE_URL=postgres://yapm:yapm@localhost:5441/yapm`, `VITE_ZERO_CACHE_URL=http://localhost:4849` — and confirm the app boots and syncs. Never run a bare `down`; tear down only with `-p yapm-zr … down -v`.
- [ ] 1.2 Reproduce the failure deterministically: sign in, then force the expired-credential path (temporarily shorten `SYNC_TOKEN_EXPIRATION`, or mint and inject a stale JWT) and capture the zero-cache log line `InvalidConnectionRequest: "No validated connection is available for shared query work."` plus the client's `error` state. Record the transcript in `design.md` under "Decisions made during implementation" if the observed sequence differs from the root-cause chain.

## 2. Server: credential rejection protocol

- [ ] 2.1 Widen `apps/server/src/zero/context.ts` to report a three-way outcome — authenticated / credential absent / credential rejected — without changing the resolved `AuthContext` shape any caller already consumes.
- [ ] 2.2 In `apps/server/src/zero/routes.ts`, return `401 {error:'unauthorized'}` from `/query` and `/mutate` when the credential is *rejected*, before invoking `handleQueryRequest`/`handleMutateRequest`; keep `200 + userID: null` when it is *absent*; keep a non-auth resolver failure as a 500. App still boots and syncs.
- [ ] 2.3 Verify against the live stack that an expired token now yields a client `needs-auth` (not a group-wide `InvalidConnectionRequest`), and that a signed-out client is unaffected.

## 3. Server: token expiry hint

- [ ] 3.1 Extend `issueSyncToken` in `apps/server/src/auth.ts` to return the token together with its `exp`, read via the existing local JWKS verification — no new dependency and no hardcoded copy of `SYNC_TOKEN_EXPIRATION`.
- [ ] 3.2 Add `expiresAt` (epoch seconds) to the `/api/zero/token` response in `apps/server/src/auth-routes.ts`, additively — existing fields and status codes unchanged.

## 4. Client: session fetch with three outcomes

- [x] 4.1 Replace `fetchSyncSession()`'s boolean-ish result in `apps/web/src/zero/provider.tsx` with a discriminated `session | no-session | unavailable` result: `no-session` only on HTTP 401/403; `unavailable` on a thrown error, abort/timeout, any other non-OK status, or a malformed body; add `AbortSignal.timeout(10_000)`.
- [x] 4.2 Make `unavailable` preserve the previous session state instead of collapsing to `LOGGED_OUT`, and expose an `unavailable` flag on `useSyncSession()` so surfaces can distinguish "signed out" from "cannot reach the server". App behaves identically on the happy path.

## 5. Client: recovery state machine

- [x] 5.1 Add the pure backoff scheduler (base 1s, factor 2, cap 30s, full jitter, reset on success) as a standalone testable unit in `apps/web/src/zero/`.
- [x] 5.2 Replace `SyncAuthRefresher` with a `SyncRecovery` component mounted inside `ZeroProvider` that owns every re-mint: act on `needs-auth` and `error` (re-mint, then `zero.connection.connect({auth})` via `useZero()`); on `disconnected` past a 20s grace, re-mint only (never call `connect()` — it does not reconnect from `disconnected`); do nothing on `connecting`/`closed`; reset the schedule on `connected`.
- [x] 5.3 Handle the identical-token case: when the re-minted JWT equals the current one and the state is terminal, call `zero.connection.connect()` explicitly, because an unchanged `auth` prop makes `ZeroProvider` a no-op and would leave the client parked.
- [x] 5.4 Route `useSyncControl().refresh()` (membership changes) through the same scheduler so a role change and a reconnect can never run two token fetches concurrently; its existing contract and call sites are unchanged.

## 6. Client: proactive refresh

- [x] 6.1 Consume `expiresAt` and schedule a re-mint at 75% of the remaining lifetime, clamped to [60s, 30min]; fall back to a fixed 45-minute timer when the field is absent.
- [x] 6.2 Re-check on `visibilitychange → visible` and on `online`, re-minting when more than half the lifetime has elapsed; ensure timers and listeners are cleaned up on unmount and never stack.

## 7. Client: visible reconnecting state

- [x] 7.1 Extend `apps/web/src/zero/connection.ts` so the summary carries the recovery state (`idle | retrying | waiting`) and recovery-aware labels (`Reconnecting…`, `Offline — retrying`, `Sign-in expired — reconnecting`, `Sync error — retrying`) alongside the existing `state`/`writable`/`detail` fields.
- [x] 7.2 Rework `apps/web/src/components/connection-status.tsx`: polite live region for the label, a keyboard-operable **Retry now** `<button>` once the delay reaches the top of the range or recovery has failed for >15s, a new `data-recovery` attribute for tests, and the existing `data-connection` values left untouched so no current e2e assertion changes.
- [x] 7.3 Replace the hardcoded `bg-emerald-500`/`bg-amber-500` dots with `--color-status-*` tokens (`bg-status-done` / `bg-status-in-progress` / `bg-status-urgent` / `bg-muted-foreground`); verify in all three presets, light and dark.
- [x] 7.4 Replace `authenticated.tsx`'s indefinite "Loading…" with an actionable state once a credential request has come back `unavailable`: same `role="status"` + Retry treatment, still redirecting to `/login` only on a real `no-session`.

## 8. Unit tests (Vitest, no DB)

- [x] 8.1 Backoff scheduler: delays stay within `[0, min(cap, base·2^n)]`, grow, never exceed the cap, and reset to base after a success.
- [x] 8.2 Recovery action table: `needs-auth`/`error` re-mint and connect; `disconnected` re-mints only after the grace and never calls `connect()`; `connecting`/`closed` do nothing; `connected` resets the schedule.
- [x] 8.3 Identical-token fallback calls `zero.connection.connect()` when the state is terminal and the minted token is unchanged.
- [x] 8.4 Session classifier: 401/403 → `no-session`; 500, 404, thrown error, abort/timeout, malformed body → `unavailable`; valid body → `session`.
- [x] 8.5 Proactive-refresh scheduling from `expiresAt` (75% clamped to [60s, 30min]), the missing-`expiresAt` fallback, and the visibility/online re-check threshold.
- [x] 8.6 Connection summary maps every Zero state × recovery state to the right label, `writable` flag, and `data-recovery` value.

## 9. Integration tests (Vitest, live Postgres)

- [ ] 9.1 `/api/zero/query` and `/api/zero/mutate`: presented-but-invalid bearer → 401 with no `QueryResponse` body; absent credential → 200 with `userID: null`; valid credential → 200 with the verified subject.
- [ ] 9.2 A non-auth resolver failure still surfaces as a server error, not a 401.
- [ ] 9.3 `/api/zero/token` returns `expiresAt` in the future and consistent with the configured token lifetime, alongside the unchanged `token`/`userID`/`role`.

## 10. Reconnection e2e (Playwright)

- [ ] 10.1 Add `apps/web/e2e/reconnect.spec.ts`: sign in, install a page-lifetime sentinel, drop the connection (`context.setOffline` and/or `page.routeWebSocket` against the zero-cache URL), assert the pill reports reconnecting with `data-recovery`, restore, then assert `data-connection="connected"`, data converging, and the sentinel intact — proving no page reload.
- [ ] 10.2 Add the credential-failure case: `page.route('**/api/zero/token', …)` fails the request, assert the user stays signed in on the retry surface (never `/login`), then let it succeed and assert full recovery — including via the keyboard-only **Retry now** path.
- [ ] 10.3 Confirm the new spec runs in the existing CI `e2e` job with no new service, port, or job.

## 11. Documentation

- [ ] 11.1 Add `apps/docs/src/content/docs/self-hosting/sync-recovery.md` — the connection states a user can see, automatic re-mint + bounded backoff, the 1h sync-token lifetime and proactive refresh, and what to check when it stays reconnecting (zero-cache logs, `ZERO_QUERY_URL` reachability from the container, clock skew) — and register it in the Starlight sidebar in `apps/docs/astro.config.mjs`.
- [ ] 11.2 Update `reference/zero.md` with the facts harvested from the 1.8.0 sources for this change: the `/query` validation round trip and `server-validated` userID matching, the background-connection requirement for shared query work, `connect()`'s terminal-state-only rule, and the 401-vs-200 rejection contract restated at the endpoint level.
- [ ] 11.3 Update `ROADMAP.md` with a row for this change, and `PROCESS.md` §3 so the E2E tier explicitly lists reconnection/recovery; update `README.md` only where this change makes it stale. No `.env.example` or `TECHSTACK.md` change (no new env var, no version change) — confirm by inspection.
- [ ] 11.4 `pnpm --filter @yapm/docs build` passes.

## 12. Verification

- [ ] 12.1 `pnpm turbo lint typecheck test build` passes; `node scripts/check-boundaries.mjs` and `node scripts/check-catalog.mjs` pass.
- [ ] 12.2 The compose smoke test passes against the isolated `yapm-zr` project/ports.
- [ ] 12.3 Manual close-the-loop on the live stack: idle past the token lifetime, confirm the app reconnects on its own with a visible reconnecting state and no reload; then stop zero-cache, confirm the retry cadence backs off to the cap without pinning the CPU, restart it, and confirm recovery.
- [ ] 12.4 Walk every scenario in this change's specs and confirm each is true; log anything ambiguous under `design.md` → "Decisions made during implementation".
- [ ] 12.5 Tear down with `docker compose -p yapm-zr -f docker/docker-compose.dev.yml down -v`.
