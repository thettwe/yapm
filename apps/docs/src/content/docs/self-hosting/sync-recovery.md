---
title: Sync connection & recovery
description: How yapm's browser-to-zero-cache sync connection drops, what people see while it is down, and how it repairs itself without a reload.
---

yapm is local-first: the browser holds a replica and every read comes from memory. Staying in sync
means holding one **WebSocket from the browser directly to `zero-cache`**, authorised by a
short-lived sync token the app mints for the signed-in user. That socket will drop — laptops sleep,
Wi-Fi changes, `zero-cache` restarts on a deploy, a proxy times an idle connection out — so
recovering from a drop is normal operation, not an error path.

**There is nothing to configure — recovery adds no environment variable.** This page exists so you
know what you are looking at when a browser says "Reconnecting…", and what to check when it does
not stop.

## What people see

The sync state sits at the right-hand end of the [statusline](/features/app-frame/) — band 3 of the
app frame — on every signed-in screen, and nowhere else: there is exactly one connection indicator
in the product. It is a polite live region, so a screen reader announces each transition, and it
takes every colour from your active theme tokens — it is legible in all three presets, light and
dark.

| Label | Meaning | Reads | Writes |
|---|---|---|---|
| **Synced** | Everything on this screen is current. | ✅ | ✅ |
| **Connecting** | First connection of the session. | ✅ | queued |
| **Reconnecting…** | Reconnecting after a drop. | ✅ | queued |
| **Offline — retrying** | The socket is down; the browser is redialling. | ✅ | ❌ |
| **Sign-in expired — reconnecting** | The sync token was refused; a fresh one is being minted. | ✅ | ❌ |
| **Sync error — retrying** | `zero-cache` returned a protocol error; recovery is running. | ✅ | ❌ |
| **Restoring local data** | The server no longer recognises this browser's sync state (idle for a long time, or state discarded server-side); the local replica is being rebuilt. Clears itself. | ✅ | queued |
| **Update required** | This tab's app version can no longer talk to your `zero-cache` — typically mid-upgrade. A **Refresh** button appears; nothing reloads on its own. | ✅ | ❌ |
| **New version available** | Another tab already runs newer app code. This tab still syncs; refresh when convenient. | ✅ | ✅ |

Reads never stop: everything already synced keeps rendering and navigating. Writes are refused
while disconnected rather than silently queued and lost — that is Zero's model, and the statusline is
what makes it honest.

Once retries have been going for a while, a keyboard-reachable **Retry now** button appears beside the
state. It fires the next attempt immediately and resets the schedule; nobody has to wait out a
back-off window, and nobody has to reload. The same control is offered as **Retry sync now** in the
command palette (**⌘K**) while it is available, so reaching it never depends on how long the page you
are on happens to be.

If the app cannot reach the server *before* it knows who you are, the full-page loading state turns
into **"Can’t reach the server — retrying"** with the same Retry button. Pressing it when an attempt
is already on the wire joins that attempt instead of starting over, so it can only make the wait
shorter. A failed request is never treated as a sign-out — you are only sent to the sign-in page
when the server explicitly answers that there is no session.

## What happens automatically

**The token is refreshed before it expires.** The sync token lives **1 hour**. The browser re-mints
at 75% of the token's remaining lifetime, clamped to 1–30 minutes — so on a one-hour token the
clamp binds and the refresh lands **30 minutes in**, with half the lifetime still to spare. Timers
do not fire faithfully across a laptop sleep, so the browser also re-checks whenever the tab
becomes visible again or the network comes back, and re-mints then if more than half the lifetime
is spent. In the common case the credential is already fresh when the socket reconnects, so the
connection never breaks at all.

**A broken connection is repaired without a reload.** From the two states Zero does not retry out
of on its own (`needs-auth` after a refused credential, `error` after a protocol failure), yapm
re-mints the token and explicitly resumes the connection. From `disconnected`, Zero's own 5-second
redial does the work and yapm only refreshes the credential it will present.

**A backgrounded tab goes quiet.** Zero closes the socket of a tab that has been hidden for five
minutes, on purpose. That is not a fault, so yapm does not retry against it — a tab left in the
background generates no token traffic at all. Bringing the tab back to the front reconnects it and
re-checks the credential's age in one step.

**Retries back off.** Attempts are spaced by exponential back-off with full jitter — 1 second base,
doubling, **capped at 30 seconds** — and the schedule only resets once a connection has *held* for
a few seconds. So an instance that is genuinely down (a deploy, a stopped container) degrades to a
calm ~30-second poll per tab rather than a hot loop, and it comes back on its own the moment the
server does. The jitter matters when a laptop wakes and every tab retries at once.

## What changes during an upgrade

Zero's client library would, by default, answer a version mismatch or lost client state with a
silent `location.reload()` — the page taken out from under whoever is using it, half-typed edit
included. yapm overrides both defaults, so **the app never reloads itself**:

- While you deploy a new app image, a tab still running the old code shows **Update required**
  with a keyboard-reachable **Refresh** button. Whoever is in the tab chooses the moment; an
  in-flight write is never discarded by a reload they did not ask for.
- A browser that has been away long enough for its server-side sync state to be discarded shows
  **Restoring local data** briefly while the replica rebuilds, then returns to **Synced** on its
  own. No action needed, yours or theirs.

Both states are rendered distinctly from an outage — they are not fixed by waiting for a
reconnect, and the statusline does not pretend they are. There is still nothing to configure.

## What you will see in the logs

An idle browser reconnecting with an expired token is **expected traffic**. In `zero-cache` it
looks like this:

```
closing connection: TransformFailed (zeroCache): ... non-OK status 401
```

That is the healthy path: the app answers `401` when a credential is presented and fails
verification, the browser mints a new one, and the connection comes back. A request carrying **no**
credential still gets `200` with a null user — that is the signed-out path, and it is unchanged.

What you should **not** see any more is either of these:

```
Unauthorized: Connection userID does not match validated server userID.
InvalidConnectionRequest: No validated connection is available for shared query work.
```

Those are the old failure. Builds before sync recovery answered an expired credential with `200`
and a null user id, which `zero-cache` reads as an assertion that the socket belongs to nobody: it
drops that connection from the client group, and the group's next piece of shared background work
then fails **every** client on that view-syncer — the symptom being a tab hung at "Loading…" until
it is hard-refreshed. If you still see those lines, you are running an older app image, or
something between `zero-cache` and the app is rewriting the response.

Inside the **app** container, Zero's query and mutate handlers now log at your `LOG_LEVEL` instead
of always printing at `info`, so a server configured quiet stays quiet. `LOG_LEVEL=silent` is
honoured as `error` — that is the quietest level Zero's logger offers. The `zero-cache` container
keeps its own separate `ZERO_LOG_LEVEL`, forwarded by both compose files and listed in
`.env.example` (`info` by default; set `ZERO_LOG_LEVEL=debug` in your `.env` and recreate the
container while diagnosing).

## When it stays reconnecting

Work down this list; each step rules out one layer.

1. **Is `zero-cache` up and reachable from the browser?** The browser connects *directly* to it, not
   through the app. From the affected machine and network,
   `curl -f <ZERO_CACHE_PUBLIC_URL>/keepalive` — that is the same endpoint the container's own
   healthcheck uses.
   `docker compose --env-file .env -f docker/docker-compose.yml logs zero-cache` shows the server
   side.
2. **Is `ZERO_CACHE_PUBLIC_URL` the browser-reachable origin?** The SPA fetches it at runtime from
   the app's own `GET /api/config` — `curl -s http://your-host:3000/api/config` shows exactly what
   the browser is told. An in-network hostname like `http://zero-cache:4848` or a stale
   `http://localhost:4848` cannot work from anyone else's browser. Changing it is an env change and
   a container restart; there is nothing to rebuild.
3. **Does your proxy pass WebSockets?** yapm needs no reverse proxy, but if you added one it has to
   forward the `Upgrade`/`Connection` headers to `zero-cache` and allow long-lived idle
   connections. A proxy that closes idle sockets after 60 seconds produces a permanent
   reconnect-every-minute cycle, visible as a regular heartbeat of connections in the logs.
4. **Can `zero-cache` reach the app?** `zero-cache` calls back into the app at `ZERO_QUERY_URL` and
   `ZERO_MUTATE_URL` (`http://yapm:3000/api/zero/...` on the bundled compose) to authorise queries
   and mutations. From the `zero-cache` container:
   `docker compose --env-file .env -f docker/docker-compose.yml exec zero-cache curl -f http://yapm:3000/readyz`.
   If that fails, every connection stalls at validation no matter how healthy the socket is.
5. **Do `ZERO_QUERY_API_KEY` and `ZERO_MUTATE_API_KEY` match?** Both containers read the same two
   variables, so they can only disagree if you set them per-service. A mismatch makes the app
   answer `403`, which the browser reads as an auth failure — so every tab parks on **"Sign-in
   expired — reconnecting"** and re-minting never helps, even though sign-in is perfectly healthy.
   That mismatch between the message and the reality is the tell.
6. **Are the clocks right?** The sync token is a JWT with `exp` and `iat`, minted and verified by
   the app container, and the browser schedules its refresh against `exp` using the *device's*
   clock. A badly wrong clock on either side makes tokens look expired the moment they are issued
   (constant re-minting) or keeps a stale one past its expiry (a drop the browser did not
   anticipate). Recovery still repairs both, but the churn is the symptom — check `date -u` in the
   app container and on the affected device.
7. **Is `BETTER_AUTH_URL` your real external origin?** It supplies the sync token's issuer and
   audience. If it still says `http://localhost:3000` on a deployment served from a domain, tokens
   are minted for the wrong audience and rejected on arrival.

If all seven check out and a tab is still cycling, capture
`docker compose --env-file .env -f docker/docker-compose.yml logs zero-cache` around the failure and
open an issue — include the sync label people saw, which is the client's half of the story.
