---
title: Email delivery
description: Configure outbound email with an SMTP relay or Resend over HTTPS — two transports, no extra container, and cleanly disabled when you configure neither.
---

yapm sends two kinds of mail: **notification digests** and **invite emails**. Both go through one
provider-neutral seam with **two transports**, and both are entirely optional.

**With neither transport configured, email is cleanly off.** Boot never fails, no email job is
registered, nothing is queued that could retry forever, invite links stay copyable, and the
[notification inbox](/features/notifications/) works in full. Email is only ever a convenience on
top of the app.

Adding email adds **no container**. Both transports run in-process inside the existing `yapm`
container — the SMTP transport is an outbound client, the HTTPS transport is a single outbound
request — and the sweeps run on the Postgres-backed job scheduler that already exists for
[cycle rollover](/features/cycles/). The deployment is still `postgres` + `yapm` + `zero-cache`.

## Pick a transport

| | `SMTP_URL` | `RESEND_API_KEY` |
|---|---|---|
| **How** | An SMTP relay | One HTTPS POST to Resend's API |
| **Reaches** | Mailgun, Resend, Mailjet, Postmark, SendGrid, SES — they all issue SMTP credentials | Resend |
| **Pick it when** | Anything, normally. One line covers nearly every provider. | **Your host blocks outbound SMTP ports.** Many PaaS providers do, and on those SMTP cannot be made to work at all — an HTTPS sender is the only path out. |

Start with `SMTP_URL`. Reach for `RESEND_API_KEY` when mail silently never arrives and your host's
documentation says ports 25/465/587 are blocked.

Neither path adds a vendor SDK: SMTP goes through `nodemailer`, and the HTTPS transport is a single
authenticated JSON request made with the platform `fetch`.

## Configuration

All of these are optional. Setting **either** transport makes `EMAIL_FROM` and `PUBLIC_URL`
required, and boot fails naming whichever is missing.

| Variable | Default | Notes |
|---|---|---|
| `SMTP_URL` | *(unset)* | `smtp://user:pass@host:587`. Ignored when `RESEND_API_KEY` is also set |
| `RESEND_API_KEY` | *(unset)* | A Resend API key. Takes precedence over `SMTP_URL` |
| `EMAIL_FROM` | *(unset)* | The From address, e.g. `yapm <notifications@example.com>`. **Required when a transport is set** |
| `PUBLIC_URL` | *(unset)* | The browsable base URL every email link is built from, e.g. `https://yapm.example.com`. **Required when a transport is set** |
| `NOTIFICATION_EMAIL_CRON` | `*/2 * * * *` | How often the digest sweep runs |
| `NOTIFICATION_RETENTION_DAYS` | `30` | How long a notification is kept before it is deleted |
| `NOTIFICATION_RETENTION_CRON` | `7 3 * * *` | When the retention sweep runs (03:07 daily) |

Every cron variable is parsed at boot with the same parser the scheduler uses, and a value that
cannot be parsed **fails boot naming the variable**. A typo used to boot a healthy-looking instance
with the sweep silently unregistered, which is the worst possible failure for a job you only notice
by its absence.

```bash
# .env — SMTP
SMTP_URL=smtp://apikey:re_xxxxxxxx@smtp.resend.com:587
EMAIL_FROM=yapm <notifications@example.com>
PUBLIC_URL=https://yapm.example.com
```

```bash
# .env — HTTPS, for a host that blocks outbound SMTP
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM=yapm <notifications@example.com>
PUBLIC_URL=https://yapm.example.com
```

Whatever address you put in `EMAIL_FROM`, its domain has to be one your provider will send for —
that is a provider-side domain verification step, not a yapm setting.

### Precedence when both are set

| `RESEND_API_KEY` | `SMTP_URL` | Result |
|---|---|---|
| set | unset | HTTPS transport |
| unset | set | SMTP transport |
| set | set | **HTTPS transport**, with one warning at boot naming `SMTP_URL` as ignored |
| unset | unset | Email disabled, with one info line at boot |

Resend wins the tie deliberately, and it is **never a boot failure**. A host that blocks SMTP is
precisely why the HTTPS sender exists, so an operator who has added `RESEND_API_KEY` on top of an
existing `SMTP_URL` has almost certainly done so because SMTP stopped working. Refusing to boot on
a configuration where neither value is malformed would be a footgun at exactly the moment they are
fixing things.

A *malformed* value is a different matter, so that "unset" and "wrong" are never confused for each
other:

- `SMTP_URL` must parse as a URL on the `smtp://` or `smtps://` scheme, and `EMAIL_FROM` must
  contain an address (bare, or in angle brackets after a display name). Either one wrong **fails
  boot immediately**, naming the variable and the expected format, before the server listens.
- `PUBLIC_URL` must be an absolute URL, on the same terms.
- `RESEND_API_KEY` is an **opaque credential with no syntax to check**. A wrong key cannot be
  detected at boot; it surfaces as a caught, logged authentication failure on the first send, and
  the affected notifications stay unstamped for the next sweep. Check the app log and your Resend
  dashboard if mail never arrives.

### `PUBLIC_URL` is not `BETTER_AUTH_URL`, and not `WEB_ORIGIN`

Three URL variables, three different jobs. They are frequently the same string in production and
legitimately differ in development, which is why they are separate:

| Variable | What it is |
|---|---|
| `PUBLIC_URL` | The browsable base URL a **human clicks in an email**. Every link in outgoing mail is built from it |
| `BETTER_AUTH_URL` | The origin better-auth **signs and verifies against** — OAuth callbacks, and the sync token's issuer/audience |
| `WEB_ORIGIN` | The SPA's browser origin, trusted for **CORS** |

`WEB_ORIGIN` defaults to `http://localhost:5173` in code and to `http://localhost:3000` in
`.env.example`, and **both are correct**: the code default serves `pnpm dev`, where the SPA is Vite
on its own port, and `.env.example` feeds the compose deployment, where the app serves the built
SPA same-origin on 3000. Neither is a bug; each is right for the deployment it describes.

`PUBLIC_URL` exists so email never has to guess at any of that. Configure email without it and boot
stops with the variable named, rather than quietly mailing your team a batch of `localhost` links.

## What gets sent

**Notification digests.** A sweep on `NOTIFICATION_EMAIL_CRON` collects notifications that are
unread, not yet emailed, past a two-minute debounce and less than 24 hours old; re-checks the
recipient's **current** team membership and their own
[email preference](/features/notifications/#your-preference); groups everything waiting for one
person into **one** message; sends it; and stamps exactly the rows it sent.

The debounce is a constant relative to the cron rather than a variable of its own, so lengthening
`NOTIFICATION_EMAIL_CRON` needs no matching adjustment.

One sweep is bounded to 500 notifications, and that ceiling is applied to rows that are genuinely
emailable — the membership and preference checks are part of the selection, not a filter applied to
its results. A person who has turned email off therefore consumes none of the budget, however much
has accumulated for them, and cannot delay anyone else's message.

Four independent brakes keep this from becoming a mail storm — the per-event natural key that makes
a repeated mutation write one row, the debounce, per-recipient batching, and (the most effective
one) **never emailing something the recipient already read in the app**.

**Invite emails.** Creating an email invite sends the invite through the same seam. With no
transport configured the invite still succeeds and its link is still shown for the admin to copy —
the copyable link is built from the browser's own origin and never depends on email at all.

**What is never in an email:** any excerpt of a comment or issue body. A message names the actor,
the action and the issue title, and links to the app. An email leaves the app's permission model
behind, so nothing beyond "do I need to open this?" is put in one.

## Failure behaviour

A transport that breaks degrades; it does not take anything down.

- The sweep catches transport errors **inside** the job, logs them, and leaves the affected rows
  **unstamped** — so they are picked up again by the next window once the transport recovers.
- The worker never throws, so the shared scheduler and the other jobs in the process — cycle
  rollover, connector reconciliation, notification retention — are unaffected.
- No job retries forever, and a send failure never becomes an unhandled rejection.
- The invite send route answers `sent: false` on a transport failure. The invite itself has already
  been created and its link is already on screen.

Retention runs **whether or not email is configured**: it is what bounds each client's synced set,
not an email feature.

## Verifying it

1. Set the variables and restart the app container. Boot logs one line either way — the transport
   it selected, or that email is disabled.
2. Assign an issue to another user. Their [inbox](/features/notifications/) lights up immediately;
   the email follows within roughly two cron windows (about four minutes on the defaults) **as long
   as they have not read it in the app first** — reading it in-app suppresses the mail, by design.
3. If nothing arrives, check in this order: the app logs for a transport error; your provider's own
   delivery log; whether `EMAIL_FROM`'s domain is verified with that provider; and whether your
   host blocks outbound SMTP — if it does, switch to `RESEND_API_KEY`.

Every link in the message should resolve against `PUBLIC_URL`. If you see `localhost` in a
delivered email, `PUBLIC_URL` is set to a development value.
