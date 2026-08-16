# Design — config-wait

The input is a measurement, not a scope document: `openspec/changes/front-door/design.md:745-780`,
the hand check taken 2026-08-16 against the merged build on a live stack with the API server
`SIGSTOP`ped. That section passed its own task and filed two findings it explicitly declined —
"the threshold is not this change's to set … but whoever does own it should know that the landing
gate now sits behind it" (`:770-772`) and "the `Loading…` is in the accessibility tree and not on the
screen" (`:773-776`). This file argues both, names the owner, and says what it refuses to widen into.

The governing sentence: **a wait may be silent, or it may be long, and it may not be both.** Every
decision below falls out of taking that literally and then reading the code to find out how long
"long" actually is.

## Context

What exists and must be used rather than rebuilt:

- **The gate.** `apps/web/src/zero/runtime-config.tsx` — `RuntimeConfigGate` (`:66-156`), three
  phases (`:53-56`), a bounded fetch (`:37-51`), a retry effect (`:94-103`), an announce effect
  (`:105-109`), a `retry` callback (`:114-117`), the failure surface (`:121-142`) and the boot shell
  (`:149-155`).
- **Where it sits.** `apps/web/src/main.tsx:29-37` — above `ZeroRoot`, above `ThemeProvider`, above
  `RouterProvider`. There is no route, no session, no frame and no Zero client while this renders.
  `:25-27` records why, and none of that reasoning is disturbed here.
- **The endpoint.** `apps/server/src/app.ts:66` — `app.get('/api/config', …)`, `Cache-Control:
  no-store`, unauthenticated.
- **The schedule.** `apps/web/src/zero/backoff.ts` — `BACKOFF_BASE_MS = 1_000`, `BACKOFF_FACTOR = 2`,
  `BACKOFF_CAP_MS = 30_000` (`:4-6`), full jitter (`:16-18`), and `atBackoffCeiling` (`:20-22`).
- **The patience constant that already exists.** `apps/web/src/zero/recovery.ts:8-9` —
  `RETRY_OFFER_AFTER_MS = 15_000`, commented "offer the manual escape hatch once waiting stops
  feeling like a hiccup". Used at `apps/web/src/zero/provider.tsx:232` and `:244`, and depended on by
  `apps/web/src/components/auth/login-page.tsx:57-65`.
- **The words.** `Loading…` — `apps/web/src/components/authenticated.tsx:44`,
  `apps/web/src/components/auth/login-page.tsx:84`, and twelve more files under `apps/web/src`.
- **The requirement.** `openspec/specs/self-host-deploy/spec.md:495-539`, whose third paragraph
  (`:507-509`) is the sentence this change amends.
- **The recorded rationale for the current shape.**
  `openspec/changes/archive/2026-08-05-deployment-hardening/design.md:129-131` and `:266-269`.

Constraints inherited and not negotiable here: tokens only (`DESIGN.md:38`); keyboard-first; nothing
draws ink it has no fact for (`DESIGN.md:34`); the word diet (`DESIGN.md:33`); sub-100ms interactions,
which this change cannot help but improve because the interaction being measured is "look at the
page".

## Goals / Non-Goals

**Goals**

- Put a number on the wait from the code, not from a stopwatch, and then argue a different number.
- Make one surface stop telling two readers different things.
- Leave a boot that works exactly as fast and exactly as quiet as it is today.
- Take the threshold from somewhere, so that it is defensible without this document.

**Non-Goals**

- A loading-state system, a skeleton, a spinner or a progress bar (D3).
- Any change to the sync-credential path, the recovery loop or the statusline indicator.
- Any change to what the failure surface says (D9).
- A new environment variable to tune the threshold. Env-only configuration is for deployment
  (`CLAUDE.md`), and "how long a person looks at a blank page" is a product decision, not an
  operator's.

## What the caller actually sees, before and after

Today, against an endpoint that **accepts the connection and never answers** (the `SIGSTOP` case —
the hand check's case, and the harder one):

```
 t=0      10s        ~10.5s     20.5s      ~22s       32s        ~35s   45s ...  ~91s
 ├─fetch#0─┤         ├─fetch#1───┤         ├─fetch#2───┤         ├─fetch#3─┤ ...  │
 │  10s    │ U[0,1s) │   10s     │ U[0,2s) │   10s     │ U[0,4s) │   10s   │      │
 │                                                                               │
 └──────────────────── screen: nothing at all, the whole way ────────────────────┤
      ▲                                                                          ▼
   t=1s: "Loading…" enters the accessibility tree — and only there        retry surface
                                                            (attempt 5, atBackoffCeiling)

  6 attempts × 10s = 60s of timeouts   +   5 jittered gaps, 0–31s
  ── floor 60s · mean ~75s · ceiling ~91s ──
```

Today, against an endpoint that **refuses the connection**. `RUNTIME_CONFIG_URL = '/api/config'`
(`runtime-config.tsx:8`) is same-origin, and the process that answers it at `app.ts:66` is the one
that serves the bundle at `app.ts:106` (`mountSpa`), so a refusal is not simply "the server is down" — the bundle would not have loaded from a
process that was already refusing. It is the process dying *after* the bundle loaded, or something in
front of it — a proxy, a CDN, a cached bundle — still serving static files while the app process
behind it is gone. No frequency is claimed for it either way; the point is that it is reachable and
that today's rule fires in a completely different place when it is. Each attempt fails in
milliseconds, so only the gaps cost anything:

```
 t=0                                                         ...up to 31s
 ├#0┤ U[0,1s) ├#1┤ U[0,2s) ├#2┤ U[0,4s) ├#3┤ U[0,8s) ├#4┤ U[0,16s) ├#5┤
 │                                                                    ▼
 └──── screen: nothing ────────────────────────────────────────── retry surface

  ── floor ~0s · mean ~15.5s · ceiling ~31s ──
```

**The same surface, saying the same words about the same failure, arrives anywhere between a
fraction of a second and a minute and a half depending on which way the server broke and how the
dice fell.** That is the finding the hand check could not see, because it only ran one of the two
modes.

After:

```
 t=0            1s                                    15s
 ├─────────────┬──────────────────────────────────────┬────────────────────────►
 │  nothing    │  "Loading…"  drawn AND announced      │  retry surface
 │  drawn or   │  (one node, one live region)          │  (unchanged copy,
 │  announced  │                                       │   still retrying)
 │             │                                       │
 └─ the same-origin fetch normally resolves in here, and nothing is ever drawn

  identical in both failure modes, and never before one 10s request timeout has failed
```

The boot shell itself, at t = 3 seconds:

```
        today                                   after
┌──────────────────────────────┐      ┌──────────────────────────────┐
│                              │      │                              │
│                              │      │                              │
│                              │      │                              │
│           (cream)            │      │          Loading…            │
│                              │      │                              │
│                              │      │                              │
│                              │      │                              │
└──────────────────────────────┘      └──────────────────────────────┘
 screen : nothing                      screen : Loading…
 a11y   : status → "Loading…"          a11y   : status → "Loading…"
          ^^^^^^ the two disagree               ^^^^^^ they do not
```

One node moves out of `sr-only`. That is the entire visual change in this proposal.

## Decisions

### D1 — The number comes from the code, and the code says 60–91 seconds

**Ambiguous:** the mission input says "~100 seconds", measured by hand from page load. A design that
argues against a stopwatch reading is arguing against measurement error.

**Chosen:** derive it. `runtime-config.tsx:82` reveals the failure surface when
`atBackoffCeiling(currentAttempt)` is true; `backoff.ts:20-22` is `backoffCeiling(attempt) >=
BACKOFF_CAP_MS`, i.e. `1_000 * 2 ** attempt >= 30_000`, first satisfied at **attempt 5**. So six
attempts run before the surface appears. Each is bounded at `RUNTIME_CONFIG_TIMEOUT_MS = 10_000`
(`:12`, `:40`), and the effect at `:94-103` spaces attempt *n* from attempt *n−1* by
`backoffDelay(n−1)` = `U[0, min(1000·2^(n−1), 30000))` — so gaps of `U[0,1s)`, `U[0,2s)`, `U[0,4s)`,
`U[0,8s)`, `U[0,16s)`, summing to at most 31s with a 15.5s mean.

**Hung endpoint: 60s floor, ~75s mean, ~91s ceiling. Refused endpoint: ~0s floor, ~15.5s mean, 31s
ceiling.**

**Why this matters more than the discrepancy:** the hand check's ~100s sits just above the computed
ceiling, and the gap is unremarkable — a wall-clock reading taken by hand across a ninety-second
window, starting at navigation rather than at the first `fetch`, and taken under `StrictMode` in a
dev build. The argument does not turn on it. What the derivation adds is the *second* distribution,
which no stopwatch would have found: the refusal case, where the current rule fires too **early**.
That is what turns "the threshold is too long" into "the threshold is not a threshold".

### D2 — `self-host-deploy` owns this, and the three obvious candidates do not

**Ambiguous:** the brief named `local-first-sync`, `app-frame` and `authentication` as the candidates
to check. All three were read.

**Chosen:** `self-host-deploy`, sole owner, one requirement.

**Why:** the decisive test is PROCESS.md §1 hazard 3 — a sentence that looks like trimmable prose on
one surface "may be *required* by a different capability's spec … Removing either is an **amendment
to that capability**, argued there — not an application of your own rule." Today's behaviour is not
an accident of `runtime-config.tsx`; it is mandated in words at
`openspec/specs/self-host-deploy/spec.md:507-509`. Wherever else a new requirement went, that
sentence would still be there saying the opposite, and the capability would ship contradicting
itself. So the amendment happens where the mandate lives.

The three candidates, each declined on its own text rather than by elimination:

- **`app-frame`.** Its Purpose (`app-frame/spec.md:4-8`) is "The three-band frame every
  **authenticated** surface renders inside". The boot shell is none of that: `main.tsx:29-37` puts
  the gate above `RouterProvider`, so there is no route, no team context, no session, and no band. A
  requirement about it inside `app-frame` would be a pre-router surface filed under the router's
  chrome.
- **`authentication`.** The endpoint is unauthenticated *by requirement* — `self-host-deploy/spec.md:502`,
  "a single unauthenticated endpoint under `/api`" — and `app.ts:66` implements it with no guard. The
  gate runs before any session is known and does not read one. Nothing here is an auth question.
- **`local-first-sync`.** The nearest miss, and worth stating why it misses. It owns the backoff
  (`local-first-sync/spec.md:84`), the bounded credential request and the "hung credential request
  cannot wedge the app" scenario (`:132-135`) — which is *the same defect one layer up*, already
  fixed. But its own text scopes those clauses to the sync credential, and scopes the visible
  recovering state to an indicator that "SHALL be visible on every authenticated surface" living "in
  the application frame's statusline" (`:86`). This gate exists precisely because no sync client, no
  statusline and no authenticated surface can exist yet. This change **borrows** that capability's
  number (D5) and amends nothing in it.

**The objection worth answering:** is a deployment capability a strange home for a first-paint
accessibility contract? It would be, if the paint were not already specified there — but
`self-host-deploy/spec.md:507-509` and its "The pre-config paint is deliberate" scenario (`:524-528`)
are the only place in the specs that says what the browser draws before it knows where sync lives.
Splitting the paint from the requirement that mandates it would create two owners for one surface,
which is the failure `local-first-sync/spec.md:86` avoided by making the statusline "the **only**
connection indicator in the application".

### D3 — The first paint is one quiet line, not a skeleton and not the retry surface

**Ambiguous:** four candidate first-paints — nothing (today), a skeleton of the app frame, a visible
quiet line, or the retry surface immediately.

**Chosen:** a visible quiet line, one second in.

**Why a skeleton is wrong.** The gate does not know what page is coming. It renders above the router
(`main.tsx:29-37`), so the caller may be about to land on a team's Home, the sign-in form, an invite
page or the access gate. Drawing a masthead and a deck would be ink laid down for a fact the app does
not have — `DESIGN.md:34`, "**Nothing draws ink it has no fact for**". Worse, a skeleton is a promise
that content is imminent, and the state where it would be seen longest is the one where content is
not coming at all. It would be the most confident thing on screen and the least true.

**Why the retry surface immediately is wrong.** It is a claim ("yapm can't reach its own
configuration") and at t=0 the app has no evidence for it. `runtime-config.tsx:79-81` already made
this argument and it survives untouched: "before that the honest reading is 'the server has not
answered yet', and a page that says so on a slow first paint is a page that cried wolf." Everything
in D5 and D6 is about *when* the evidence arrives, not about whether it is needed.

**Why one line is allowed, given the word diet.** `DESIGN.md:33` — "Explanatory prose on a work
surface is a bug" — and B1 `explanation-at-rest` generalised it to every surface in the product. That
same change wrote the carve-out this uses, and wrote it as a requirement:
`openspec/changes/explanation-at-rest/specs/reality-vocabulary/spec.md:94-96` — "**An empty state's
single quiet line** naming what will appear. There is no drawn fact to hang an affordance on, and the
line is the surface's only content. That line SHALL NOT render on the same surface once it has rows
to draw." The boot shell is the emptiest state in the product: it has no rows, no facts and no page.
Its one line names what will appear, and it is gone the instant anything does. This change is
therefore *inside* B1's rule, not an exception to it — which is worth saying plainly, because a
family whose whole purpose is removing text is about to add some.

**And it is not new text.** The words are already written, already announced, already in the DOM
(`runtime-config.tsx:152`). The change is `className="sr-only"` coming off one paragraph. There is no
copywriting decision here at all, which is D4.

### D4 — The word is `Loading…`, because the fix is to draw what the app already says

**Ambiguous:** a visible line invites a better sentence. "Starting yapm", "Reaching the server",
"Waiting for configuration" are all more informative than `Loading…`, and the last two are more
honest at t=12s.

**Chosen:** `Loading…`, unchanged, in the same node.

**Why:** the maintainer's complaint that started this family is that yapm "becomes too complicated
and too text heavy and so many things to learn" (`SCOPE-legibility.md:13-14`). `Loading…` is what
fifteen files in `apps/web/src` already render, including both surfaces that sit directly behind this
one — `authenticated.tsx:44` and `login-page.tsx:84`. A boot shell that invented a sixteenth phrasing
for the same state would add a word to learn in the change whose purpose is subtraction.

The second reason is stronger. Stated as "make the visible copy match the accessible copy", this
change has exactly one correct implementation and no room for taste; stated as "write a better boot
message", it has a hundred and each one re-opens the question of whether the two modalities should
say the same thing. **The fix is to draw the sentence the app is already saying**, and keeping the
sentence identical is what makes that literally true.

A more specific line at t=12s was considered and declined: a message that changes while a caller
reads it is a second thing happening on a page whose whole problem is that nothing happens, and the
honest escalation already exists — it is the failure surface, three seconds later, which names the
endpoint and offers a button.

### D5 — The threshold is 15 seconds, and it is inherited rather than invented

**Ambiguous:** "argue a number rather than picking one." Two defensible constructions exist.

The **evidence** construction: the reveal should land at the first moment when "the server is not
answering" is better supported than "the server is slow". One bounded 10s probe has failed; a second
timing out puts it beyond argument. That is ~20–21s (two 10s timeouts plus one `U[0,1s)` gap).

The **consistency** construction: yapm has already answered "how long may a wait go unexplained?"
once, and written the answer down. `recovery.ts:8-9` — `RETRY_OFFER_AFTER_MS = 15_000`, "offer the
manual escape hatch once waiting stops feeling like a hiccup."

**Chosen: 15 seconds, the constant that already exists.**

**Why the inherited number beats the derived one, on three grounds:**

1. **It is the number the surface *behind* this one already uses.** `login-page.tsx:57-65` bounds the
   landing wait on `recovery.retryOffered`, which `provider.tsx:232` sets at `RETRY_OFFER_AFTER_MS`;
   and `front-door` wrote it into the spec — `openspec/changes/front-door/specs/app-frame/spec.md:32-33`,
   "The bound on the connection SHALL be the one the statusline already applies, so the surface clears
   itself once the connection holds." A boot sequence with two consecutive waits and two different
   ideas of patience has one of them wrong, and there is no argument for the earlier one being the
   more patient.
2. **The 20s construction's extra evidence buys nothing the caller can use.** At 15s the surface
   already says the true thing — the endpoint has not answered for fifteen seconds and retrying
   continues — and it does not claim the server is dead. The second probe's confirmation would change
   no word on the page.
3. **The false alarm is bounded and self-clearing.** The cost of showing it early is exactly one
   pessimistic sentence in front of a slow-but-alive server, and it removes itself: a scheduled
   attempt that succeeds sets `phase: 'ready'` (`runtime-config.tsx:73-76`) and the app boots with no
   reload and no press. That is the same property `front-door` required of its own bounded wait, and
   it is why an earlier reveal is cheap while a later one is not — **a caller who has left cannot be
   un-left, and a reload restarts the whole schedule from zero.** The asymmetry is the argument.

**The property that keeps it honest:** `RETRY_OFFER_AFTER_MS` (15s) is greater than
`RUNTIME_CONFIG_TIMEOUT_MS` (10s), so the endpoint is never named before at least one bounded attempt
has genuinely failed. That relation is load-bearing and invisible — someone raising the request
timeout to 20s would silently reintroduce wolf-crying — so it is asserted as a test (tasks §5.5), not
left as a coincidence between two files.

**What it costs, stated rather than buried:** against a refused endpoint where the dice fell short,
today's surface can appear in a few seconds and after this change it will take 15. That is slower,
and it is the right trade: a claim about the server's health should not arrive faster or slower
according to `Math.random()`.

### D6 — The trigger is elapsed time, and the attempt counter is dropped rather than OR'd

**Ambiguous:** `provider.tsx:232` uses `atBackoffCeiling(attempt) || elapsed >= RETRY_OFFER_AFTER_MS`.
Copying that line wholesale is the obvious move, and it is wrong here.

**Chosen:** elapsed time alone, at this call site. `provider.tsx:232` is not changed.

**Why the disjunct must go:** the attempt half is what produces D1's refusal distribution. Against an
endpoint that refuses connections, six attempts complete in the time of five jittered gaps —
`atBackoffCeiling(5)` can be true within a couple of seconds, and the page names the endpoint before
anyone has finished reading it. Keeping the OR keeps that behaviour exactly. The whole point is that
one clock gives one answer in every failure mode; a disjunction with a dice roll gives two.

**Why `provider.tsx:232` is right to keep its OR, so this is a principled difference and not a
divergence:** there, the flag being set is `retryOffered`, which *adds a button* to a statusline that
is already telling the reader what is wrong. Offering an escape hatch early is free. Here the flag
replaces the entire screen with a diagnosis. Different consequence, different rule. The constant is
shared; the predicate is not.

**The implementation trap, recorded because it is easy to land wrong:** today the only thing that can
set `phase: 'failed'` is the rejection handler (`runtime-config.tsx:77-90`). An elapsed-time test
evaluated only there fires on the first rejection *after* 15s — which against a hung endpoint is the
second timeout, at ~20.5s, not 15s. The reveal needs **its own timer**, in the shape
`provider.tsx:240-245` already uses (`setTimeout(…, Math.max(0, RETRY_OFFER_AFTER_MS - elapsed))`),
started from a first-attempt timestamp held in a ref like `provider.tsx:222`. Tasks §2 says so, and
§5.2 asserts the 15s reveal against a fetch that never settles, which is the case a rejection-only
implementation fails.

### D7 — The request timeout, the backoff and the retry loop are all unchanged

**Ambiguous:** if the wait is too long, the obvious lever is the 10s per-request bound.

**Chosen:** `RUNTIME_CONFIG_TIMEOUT_MS` stays at 10_000; `backoff.ts` is not touched; the loop keeps
running forever after the surface appears.

**Why:** the two constants answer different questions. The request timeout answers "how long may one
attempt occupy the wire" — a question about the server, where 10s is generous and matches
`SYNC_TOKEN_TIMEOUT_MS` (`session.ts:7`) exactly. The reveal answers "how long may a person be given
no explanation" — a question about the reader. Conflating them is how the attempt counter came to be
a patience threshold in the first place. Once the reveal is on its own clock, shortening the request
bound buys the caller nothing and costs a slow-but-alive server an extra abandoned request.

The backoff stays because it protects the server, and it is the one part of this machinery doing the
job it was designed for: `backoff.ts:1-3` and `:8-9` — a cap so a persistent fault does not become a
hot loop, full jitter so waking tabs do not herd. Neither property has anything to do with what the
screen shows, which is exactly the confusion this change removes.

### D8 — "Only after retries are exhausted" is not true of the build, and the restatement says so

`self-host-deploy/spec.md:509` reads "SHALL name the endpoint only after **retries are exhausted**".
Retries are never exhausted. `runtime-config.tsx:88-89` increments the attempt counter on every
failure forever, `:97` keeps scheduling (capped at 30s by `backoffCeiling`), and the surface itself
says "Still retrying" (`:132`). What the code actually does is name the endpoint once the *backoff
schedule* reaches its ceiling and then keep going.

This is a small inaccuracy with a real consequence: read literally, "exhausted" describes a terminal
state, and a reader auditing the requirement would look for a give-up path that does not exist. The
restatement replaces it with what is true — the endpoint is named at a bound, and retrying continues
past it — and adds the property that makes an early reveal safe: **naming the endpoint does not end
the wait.** The surface keeps its control, keeps retrying, and gives way to the application on its
own when the configuration lands.

### D9 — Pressing Retry now must not un-name the endpoint, and an elapsed clock could break that

Today the failure surface survives a failed retry by accident of structure: `phase: 'failed'` is only
ever *set* (`runtime-config.tsx:82-87`), and `retry` (`:114-117`) resets the attempt counter without
touching the phase. The comment at `:111-113` explains what the reset achieves and says nothing about
the phase, because with an attempt-keyed reveal it did not need to.

An elapsed-time rewrite can lose this for free. Derive the surface from "time since the most recent
attempt started" and pressing **Retry now** makes the diagnosis vanish, replaced by `Loading…`, for
fifteen seconds, after which it reappears — a page that punishes the one action it offered. The clock
therefore runs from the **first** attempt and is not reset by `retry`, and the phase remains
set-once-cleared-only-by-success. It is written into the requirement as a scenario rather than left
as a property of the implementation, because it is the kind of behaviour a later refactor deletes
without noticing.

### D10 — One existing scenario is reworded, and it was already loose

`self-host-deploy/spec.md:524-528`, "The pre-config paint is deliberate": **WHEN** the SPA is loading
and the request has not resolved, **THEN** the application "renders a neutral boot state, renders no
error, and constructs no sync client".

Its WHEN has no upper bound, so it is stated of every moment before resolution — including t=91s,
where today's build is showing the failure surface and therefore *not* rendering a neutral boot
state. The scenario is already false at its own edges; nobody noticed because nothing ever tested
it there. The reword bounds the WHEN to the first beat and leaves the THEN verbatim.

The alternative — carrying it word for word and adding new scenarios beside it — was considered and
declined: it would leave the capability asserting a neutral boot state at the same moment another of
its own scenarios asserts a named failure, and a reader resolving that contradiction would have to
guess which was meant. Every other clause and all four remaining scenarios are carried verbatim.

**A note on scope, since a `## MODIFIED` block replaces its requirement whole:** the delta restates
the runtime-configuration requirement in full, including the paragraphs about build-time constants
and the development default, which this change does not touch and which must survive it intact. The
grep PROCESS.md §1 mandates was run — `grep -rl "browser-facing sync origin" openspec/changes/` —
and returns only `2026-08-05-deployment-hardening`, which is archived. **No in-flight change claims
this requirement, so `openspec/specs/self-host-deploy/spec.md` is the baseline and no archive
ordering is owed to anyone.** Tasks §8.1 re-runs the grep before archiving, because four siblings are
in flight and a fifth appeared while this was being written.

### D11 — What this change refuses to widen into

The brief says "do NOT widen this into a general loading-state change. One surface." Three widenings
were available and all are declined:

- **The other full-page waits.** `SyncPending` (`authenticated.tsx:40-48`) and `Loading`
  (`login-page.tsx:80-88`) are the same shape as the fixed boot shell and are **already visible with
  a live region**. They are the precedent, not the problem.
- **The in-page waits.** Eleven files draw `Loading…` inside a rendered page (`triage-view.tsx:430`,
  `issue-list.tsx:149`, `projects-view.tsx:172` and the rest). A reader looking at one of them is
  looking at a page with a masthead, a deck and a statusline; none of them is a blank screen and none
  of them is silent. Auditing their thresholds is a different change with a different argument.
- **`triage-view.tsx:413-419`'s pattern — an `sr-only` region *plus* a visible line.** That is the
  shape this change reaches by a different route (one node serving both), and generalising it into a
  rule for the product would be a `reality-vocabulary` amendment, argued there, over a surface
  inventory this change has not done.

The claim being made is narrow on purpose: **one gate, above the router, whose two readers disagree
and whose clock is a proxy.** Everything else stays as it is.

## Risks

- **A visible line at 1s on a slow-but-normal boot reads as a regression to someone used to the
  blank.** Mitigated by the beat being unchanged and by the line being the same word every other
  surface uses. If the same-origin fetch routinely took more than a second, the flash would be the
  complaint — but `runtime-config.tsx:16-17` and `:145-146` record the measured expectation that it
  resolves inside a frame, and the smoke test exercises exactly that path.
- **15s is a judgement, and a genuinely slow first boot could hit it.** The endpoint is served by the
  app process that already served the bundle the browser is running, so the case requires a process
  that is answering static files and not JSON. Where it happens, the surface is self-clearing (D5.3)
  and the caller loses one pessimistic sentence rather than access.
- **The reveal timer is the part most likely to be built wrong** (D6). It is the only new mechanism in
  the change and the failure mode is silent — a rejection-keyed implementation is off by 5.5s in one
  failure mode and correct in the other. Tasks §5.2 is written to fail against it.
- **An e2e spec that waits 15s costs the suite 15s.** Argued rather than assumed in tasks §6: it
  replaces a 100-second hand check, it is the only tier that can observe a real network stack, and
  PROCESS.md §3's big-feature rule is quoted against it rather than around it.

## Decisions made during implementation
