## Why

Hold a live session, load yapm against a server that has stopped answering, and you look at an
**entirely blank cream page for up to a minute and a half** before anything appears. Measured
2026-08-16 against the merged build on a live stack, with the API server `SIGSTOP`ped so that
requests *hang* rather than fail fast, and recorded in
`openspec/changes/front-door/design.md:745-780` — "Task 10.6's hand check: the wait ends, but a
sighted caller watches nothing for ~100s". That hand check passed on its own terms: the wait ends
and the surface it ends on is a good one. It also filed two findings and declined both as out of
its scope. This change is those two findings.

**The wait is a minute and a half, and the code says so.** `apps/web/src/zero/runtime-config.tsx:82`
reveals the failure surface only `if (atBackoffCeiling(currentAttempt))`, and
`apps/web/src/zero/backoff.ts:20-22` puts that first at attempt **5** (`1_000 * 2 ** 5 = 32_000 ≥
BACKOFF_CAP_MS`). Six attempts, each bounded at `RUNTIME_CONFIG_TIMEOUT_MS = 10_000`
(`runtime-config.tsx:12`), separated by five full-jitter gaps of `U[0,1s) … U[0,16s)`
(`backoff.ts:16-18`). Against a hung endpoint that is **60s of timeouts plus 0–31s of backoff: a 60s
floor, a ~91s ceiling, a ~75s mean.** The hand check's stopwatch read ~100s from page load, which is
the same order and the same complaint.

**The same rule fires in under a second against a server that is merely down.** A refused connection
rejects immediately, so the six attempts cost nothing but their gaps — the identical surface, saying
the identical thing, arrives anywhere in **0–31s**. The comment above the guard
(`runtime-config.tsx:79-81`) says it exists so the page is not "a page that cried wolf". Keyed on an
attempt counter it cries wolf on a refusal and stays mute through a hang. **The counter is a proxy
for patience, and it is wrong in both directions.**

**And what the two readers get is inverted.** `runtime-config.tsx:151` renders the wait into a
`className="sr-only"` live region: a screen-reader user is told `Loading…`, a sighted user is shown
an empty page. That is the exact inverse of the principle `explanation-at-rest` shipped one change
earlier, where visual silence must not become accessibility silence. The position being moved is
recorded, and it is honest — `openspec/changes/archive/2026-08-05-deployment-hardening/design.md:266-269`
argued that "a silent indefinite wait is the one state assistive technology cannot observe at all",
and fixed it for that reader. It fixed it for one of two. `design.md` §D3 argues why the second
reader was missed and why the fix is the smallest one available.

Both defects sit **under** the front door. `front-door`'s landing decision renders behind this gate
(`apps/web/src/main.tsx:29-37` puts `RuntimeConfigGate` above `ZeroRoot`, `ThemeProvider` and the
router), so the sign-in surface inherits this worst case and adds its own 15s bound on top of it —
about 106 seconds, composed, before a caller reaches anything they can press.

Vision principles served: **speed is the feature** — "if yapm is slow, nothing else matters", and a
blank screen is the slowest thing a product can show; **deployable in minutes** — the caller staring
at cream is usually an operator who just mis-set a variable, and telling them within 15 seconds
instead of 91 is the difference between a diagnosis and a reload; **reality over ritual** — the app
knows it is waiting and already says so to one reader, so drawing the same words costs it no new
fact.

This change is not one of `SCOPE-legibility.md`'s seven lettered changes. It is the finding C1
recorded and declined, taken as its own change because C1's spec delta now sits behind it, and
authored under the same process the family chose — **proposals first, no product code**
(`SCOPE-legibility.md:47-48`).

## What Changes

**The first beat is unchanged, and deliberately so.** For `BOOT_ANNOUNCE_DELAY_MS`
(`runtime-config.tsx:18`, one second) the gate still draws nothing and announces nothing. The
recorded reason survives intact — "the fetch is same-origin and usually resolves inside a frame, and
a spinner that flashes for 20ms reads as a glitch" (`runtime-config.tsx:144-147`) — and it is what
keeps this change from trading a blank screen for a flashing one. A boot that resolves normally is
byte-for-byte what it is today.

**After that beat, the app draws the sentence it is already saying.** The `sr-only` on
`runtime-config.tsx:151` goes, and the same `Loading…` renders where a reader can see it, in the same
node, in the same polite live region, at the same moment. **No new word, no new token, no new
component**: `Loading…` is what `apps/web/src/components/authenticated.tsx:44` shows on the
authenticated pending surface, what `apps/web/src/components/auth/login-page.tsx:84` shows behind the
landing decision, and what twelve more files under `apps/web/src` already draw. Fifteen files render
that word; the gate is the only one that announces it without drawing it.

**The reveal moves from the attempt counter to the clock.** `atBackoffCeiling(currentAttempt)`
(`runtime-config.tsx:82`) is replaced by elapsed time since the first attempt, bounded at
`RETRY_OFFER_AFTER_MS` — **15 seconds**, `apps/web/src/zero/recovery.ts:9`, "offer the manual escape
hatch once waiting stops feeling like a hiccup". The number is **inherited, not invented**: it is
what `apps/web/src/zero/provider.tsx:232` already ORs into the statusline's retry offer, what
`login-page.tsx:57-65` already bounds the landing wait with, and what `front-door`'s own spec delta
already wrote down as "the bound on the connection SHALL be the one the statusline already applies"
(`openspec/changes/front-door/specs/app-frame/spec.md:32-33`). A boot sequence with two waits and two
different ideas of patience is one of them being wrong.

Because 15s is longer than one 10s request timeout, **the endpoint is never named before at least one
bounded attempt has actually failed** — and it is named at the same 15s whether the endpoint hangs or
refuses. One clock, one answer, every failure mode. `design.md` §D5 and §D6 argue the number and the
mechanism; §D6 also records the trap, which is that an elapsed bound needs its own timer (the shape
`provider.tsx:240-245` already uses) or the reveal lands on the next rejection at ~20s instead.

**The 10s request timeout stays, the backoff stays, and the failure surface's copy stays.** Nothing
about `fetchRuntimeConfig` (`runtime-config.tsx:37-51`), the retry schedule
(`runtime-config.tsx:94-103`) or the "yapm can't reach its own configuration" surface
(`runtime-config.tsx:121-142`) changes. `atBackoffCeiling` and `BACKOFF_CAP_MS` stay exported and
stay in use at `provider.tsx:232`; only this one call site stops asking the counter a question the
counter cannot answer.

**Pressing Retry now does not un-name the endpoint.** Today the failure surface persists across a
failed retry because `phase: 'failed'` is only ever set, never cleared (`runtime-config.tsx:82-87`,
`:114-117`). A naive rewrite that derives the surface from elapsed-since-last-attempt would make it
vanish on press and return 15s later, which is worse than the bug being fixed. The requirement says
so and a test holds it.

Non-goals — deliberately not built:

- **A general loading-state change.** One surface: the pre-config boot shell in
  `apps/web/src/zero/runtime-config.tsx`. `SyncPending` (`authenticated.tsx:40-48`), `Loading`
  (`login-page.tsx:80-88`), the invite page's wait (`apps/web/src/components/auth/invite-page.tsx:46`) and the eleven in-page
  `Loading…` states are **already visible** and are not touched. The defect is that one surface
  disagrees with them, not that the product needs a loading-state system.
- **A skeleton or a progress indicator.** The gate sits above the router and knows nothing about the
  page it is about to render (`main.tsx:29-37`), so a skeleton would be ink drawn for a fact it does
  not have — `DESIGN.md:34`. §D3 costs it.
- **Changing what the failure surface says.** The hand check called that copy good and this change
  agrees; showing it sooner is the whole intervention.
- **Shortening `RUNTIME_CONFIG_TIMEOUT_MS`.** A tighter request bound makes the client noisier
  against a slow-but-alive server and buys nothing once the reveal is on a clock (§D7).
- **Touching the sync-credential path.** `SYNC_TOKEN_TIMEOUT_MS` (`apps/web/src/zero/session.ts:7`),
  the recovery loop and the statusline indicator are unchanged. This change *reads* one constant
  from `recovery.ts`; it amends nothing there.
- **A new env var, dependency, container, route, table, query, mutator or migration.** None.
  `packages/schema` and `packages/ui` are not touched at all.

## Capabilities

### New Capabilities

<!-- none: this change amends the requirement that already mandates the boot shell's behaviour -->

### Modified Capabilities

- `self-host-deploy`: "The browser-facing sync origin is runtime configuration" is the requirement
  that mandates today's behaviour in one sentence — `openspec/specs/self-host-deploy/spec.md:507-509`,
  the SPA "SHALL hold a neutral boot state while the value is in flight rather than rendering an
  error, and SHALL name the endpoint only after retries are exhausted." Three amendments, everything
  else carried verbatim: the boot state is silent only for a first beat and thereafter says it is
  waiting **on the screen and in the accessibility tree at once, in the same words**; the endpoint is
  named on a bound over **elapsed time** rather than a count of attempts, so a hung endpoint and a
  refused one are named on the same clock; and naming it does not end the wait — the surface keeps
  retrying, keeps its control, gives way to the application on its own, and does not disappear when a
  pressed retry also fails. The clause "only after retries are exhausted" is additionally **factually
  wrong about its own implementation** — retries are never exhausted, the loop runs forever and the
  surface says "Still retrying" — and the restatement fixes that (§D8).
  All five existing scenarios are carried. One is reworded: "The pre-config paint is deliberate"
  (`:524-528`) has its WHEN bounded to the first beat, because its THEN ("renders a neutral boot
  state, renders no error") is stated of a wait with no end and is therefore already loosely true of
  the current build at t=91s. §D10 says why the reword is smaller than it looks. Seven scenarios are
  added — the delta carries twelve where the baseline has five — including the keyboard-only one this
  requirement has never carried
  (`openspec/config.yaml` requires one wherever UI is involved).
- No other capability is modified, and §D2 argues that at length against the three the brief named:
  `app-frame` (whose Purpose scopes it to "every **authenticated** surface" — this shell has no
  session, no route and no bands), `authentication` (the endpoint is unauthenticated by requirement,
  `:502`), and `local-first-sync` (whose recovery clauses are scoped to the sync *credential* and to
  an indicator that lives "on every authenticated surface", `local-first-sync/spec.md:86` — this gate
  exists precisely because no sync client can be constructed yet).

## Impact

Product code, none of which this proposal writes:

- `apps/web/src/zero/runtime-config.tsx` — the whole change, in one file:
  - `:151` loses `className="sr-only"`; the boot shell (`:149-155`) gains the centring the failure
    surface at `:124` already uses, and the line takes `text-muted-foreground text-sm` — the exact
    classes `authenticated.tsx:43` and `login-page.tsx:83` use. `--muted-foreground` resolves to
    `--text-2` (`packages/ui/src/styles/globals.css:473`), which
    `packages/ui/src/styles/contrast.test.ts:170-177` already asserts at AA on every ground in all six
    theme blocks, so **no contrast pair is added**. The theme is already applied at this point:
    `apps/web/index.html:7-36` sets `data-theme` and the dark class before React mounts.
  - `:82` swaps `atBackoffCeiling(currentAttempt)` for an elapsed-time test, with a first-attempt
    timestamp and a reveal timer in the shape of `provider.tsx:222` and `:240-245`.
  - `:3` drops `atBackoffCeiling` from its import and takes `RETRY_OFFER_AFTER_MS` from
    `@/zero/recovery`, whose only non-React import is `import type` from `@rocicorp/zero`
    (`recovery.ts:1`) and is therefore erased — the gate still loads no sync code, which is the
    property it exists for.
  - `:10-18`, `:79-81` and `:144-148` are comment blocks stating the rules this change moves. They
    move with it; the no-spinner rule at `:144-147` survives and should say what now guards it.
- `apps/web/src/zero/backoff.ts`, `apps/web/src/zero/recovery.ts`, `apps/web/src/zero/provider.tsx`,
  `apps/web/src/zero/session.ts`, `apps/web/src/components/authenticated.tsx`,
  `apps/web/src/components/auth/login-page.tsx`: **unchanged.** `atBackoffCeiling` keeps its caller
  (`provider.tsx:232`) and its tests (`backoff.test.ts:62-65`).
- `apps/web/src/zero/runtime-config.test.tsx`: `:156-172` ("the boot wait is announced politely, a
  beat after it starts") gains the visibility half of its own claim; `:108-123` and `:128-154` both
  walk `BACKOFF_CAP_MS + 1_000` ten times to reach the failure surface (`:115-119`, `:133-137`) and
  can now advance past one bound instead. New cases: the reveal lands at the elapsed bound in both
  failure modes, it is never earlier than one request timeout, a failed retry does not hide the
  surface, and a config that lands late clears it without a reload.
- `apps/web/e2e/reconnect.spec.ts`: one added spec, modelled on `:354-374` ("a hung sync-token
  request is abandoned for an actionable retry"), which already hangs a route for 20s and asserts the
  actionable surface. The new one hangs `**/api/config` and needs **no account and no fixtures** —
  itself the evidence that this gate is above authentication. `tasks.md` §6 argues the addition
  against PROCESS.md §3's big-feature rule rather than adding it reflexively.
- `scripts/smoke.mjs` is untouched and must stay green: it loads the app against a healthy stack,
  where `/api/config` answers inside the first beat and this change draws nothing at all.
- No dependency, env var, container, table, migration, named query or mutator is added or changed.
  `.env.example`, `README.md`, `TECHSTACK.md`, `DESIGN.md` and `CLAUDE.md` are not made stale by it:
  no configuration surface moves, and the boot shell reuses patterns those documents already
  describe.
- `ROADMAP.md` is **not** edited on this branch — siblings in this family are authored in parallel and
  that file is the guaranteed conflict (`SCOPE-legibility.md:191-193`). The integrator takes the row.
- `openspec/SCOPE-legibility.md` is not edited: this change is not one of its seven, and the finding
  it acts on is already recorded in `front-door/design.md`.

Docs: `apps/docs/src/content/docs/self-hosting/sync-recovery.md` — §"What people see" (`:16` onward)
describes every state a browser can show *except* the one before the app knows where sync lives, and
`:46-50` describes the credential path's full-page retry as though it were the only one; §"When it
stays reconnecting" (`:128`) step 2 at `:138-141` already tells an operator to `curl /api/config`, and
now has a symptom to hang that instruction on. `apps/docs/src/content/docs/self-hosting/deploy.md:193-197`
— the "getting it wrong looks like" table, where an unreachable `/api/config` and a wrong
`ZERO_CACHE_PUBLIC_URL` look different and only the second is described.
