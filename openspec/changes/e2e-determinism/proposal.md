# e2e-determinism

## Why

This is the **third** diagnosis of one failure, and the first one with a trace behind it.

`projects.spec.ts:248` fails on `main` and has failed on changes that carried no product code at
all. PR #41 was commissioned on the theory that specs poison each other through a shared
workspace; it built a per-test database reset, measured it, and reported honestly that it made
things worse. `e2e-multi-context` (PR #51, proposal merged, unbuilt) was then commissioned on the
theory that Zero's client reloads the page under a second browser context. **That theory is
falsified too**, and this change supersedes it.

The measurement `e2e-multi-context` asked for was taken. Node 24.19.0, matching `.node-version`;
an isolated compose project; `projects`, `pm-digest` and `retro` five times each:

| spec | baseline | failing tests |
|---|---|---|
| `projects.spec.ts` | **0/5 passed** | `:190` 4/5, `:248` 3/5 |
| `pm-digest.spec.ts` | 3/5 passed | `:306` 2/5 |
| `retro.spec.ts` | 5/5 passed | — |

Every marker the reload theory predicted is **zero**, locally and in CI:

| marker | local | CI (last 3 runs) |
|---|---|---|
| `reloading in` | 0 | 0 |
| `Zero reloaded the page.` | 0 | 0 |
| `SchemaVersionNotSupported` | 0 | **0** |
| `ClientNotFound` | 0 | 0 |
| `Ignoring mutation … already processed` | 0 | 0 |
| `Target.disposeBrowserContext` | **0** | **0** |

That last row matters twice over: it is the signature `inbox-daylight`'s tasks named as the known
flake and explicitly declined to fix or loosen. It does not occur.

**What the traces actually show.** Local and CI hang at the identical point — one unfinished
action, in the second browser context, on the same selector:

```
UNFINISHED [1-trace.trace]  click  {"selector":"internal:role=menuitem[name=/^Projects/u]","timeout":0}
span: 60.3s over 108 actions   (CI)
span: 60.2s over 108 actions   (local)
```

104 of those 108 actions complete in under 400ms. The sixty seconds are one action that never
completes. In CI the watcher context's final frame URL is `/teams/{id}/issues` — it never reached
Projects — and across its 48 frame snapshots **not one contains a `menu` or `menuitem` element**.
The `more▾` transient never opened.

**Why it opens for the first client and not the second.** `goToMore` clicks the deck's `more▾`
button and then immediately clicks a menu item. The deck is drawn on every route, so its button is
clickable the instant a route change begins — before the transient behind it can respond. The
calling test does not wait between `stop(watcher, 'Issues').click()` and `goToMore(watcher,
'Projects')`, so the opening click lands in that window, opens nothing, and the item never enters
the DOM.

**Why nobody could read the failure.** `playwright.config.ts` sets neither `actionTimeout` nor
`navigationTimeout`, so every action inherits `timeout: 0` and is bounded only by the 60s test
timeout. The item click therefore consumes the entire budget, and the error the run reports is
`browserContext.close: Test ended` raised by a hand-rolled `finally` — sixty seconds and three
frames away from the action that failed. Every prior diagnosis was made against that misleading
error.

**One local-only aggravator, recorded so it is not confused with the cause.** Locally the run
served **three** distinct Vite dep-optimizer bundles (`7798e96a`, `d0028597`, `b96f8a29`) and the
browser logged `Invalid hook call … more than one copy of React` and
`TypeError: Cannot read properties of null (reading 'useRef')` inside `<MenuRoot>`. CI served
**one** bundle (`533b8a4a`) and logged no React error at all, and still failed identically. The
duplicate React makes the local failure worse and more frequent; it is not what breaks CI.

**The fix is proven, not argued.** Bounding actions and retrying the transient until an item is
actually in the DOM takes `projects.spec.ts` from **0/5** to **3/3 passing**, and its runtime from
1.4–2.4 min to ~34s, because the hung action is gone rather than waited out.

Vision principles served: **keyboard-first** (the transient's contract is what is being asserted),
and the honesty principle the overhaul runs on — a suite may report only what it can prove, and a
teardown error standing in for an unopened menu is the test-tier version of a surface stating
something it cannot back.

## What Changes

- **Bound every action.** `actionTimeout` and `navigationTimeout` in `playwright.config.ts`, so a
  failure is reported at the action that failed, naming its selector, instead of at the teardown
  that follows it.
- **`goToMore` asserts the transient opened** before clicking into it, retrying the opener until a
  menu item is in the DOM — the only observable that says the transient is live.
- **The multi-client lifecycle**, carried from `e2e-multi-context` unchanged in intent: an
  `apps/web/e2e/fixtures.ts` `newContext` fixture whose teardown Playwright owns, all 17 hand-rolled
  `browser.newContext()` sites migrated onto it, their `finally` blocks deleted, and a repository
  gate that fails a direct call. Carried from PR #41 with credit.
- **An unrequested-reload watcher** that fails a test whose page reloads itself, naming the reload
  and its reason — kept from `e2e-multi-context` as a **tripwire**, not a fix: it is what would have
  falsified the reload theory in an afternoon instead of two changes.
- **The two Zero handlers** (`onClientStateNotFound`, `onUpdateNeeded`) passed from `ZeroRoot`, and
  `reference/zero.md` given the reload-on-error default it never recorded. Kept because the
  library's undocumented default *is* a real correctness gap — and recorded here as **not** the fix
  for this failure, so the next reader does not inherit a third wrong causal story.
- **The Vite dep optimizer frozen for the e2e run**, so no context loads across a re-optimization
  boundary and the local suite stops being harder than CI.
- **`zz-isolation.spec.ts`** carried over from PR #41, adapted to the isolation model this change
  ends with.

**Not taken:** the CI startup-ordering fix (`e2e-multi-context` design D3). Its own guard said it
was to be taken only if the count showed the race was real. `SchemaVersionNotSupported` is **0**
across the last three CI e2e jobs, so it is ruled out, and taking it anyway is the masking D3
warned about.

## Impact

- **Affected specs:** `ci-pipeline` (the E2E tier's contract), `local-first-sync` (the client's
  sync-recovery policy).
- **Affected code:** `apps/web/playwright.config.ts`, `apps/web/e2e/*` (11 spec files, `support.ts`,
  new `fixtures.ts`, new `README.md`), `apps/web/src/zero/provider.tsx`, `apps/web/vite.config.ts`,
  `scripts/lib/boundaries.mjs`, `PROCESS.md` §3, `reference/zero.md`.
- **Supersedes:** `e2e-multi-context` (PR #51). That change's proposal and design are kept as the
  record of a falsified hypothesis; nothing of its code survives because none was written.
- **No new table, no migration, no new container, no product behaviour change** beyond the two
  sync-recovery handlers.
