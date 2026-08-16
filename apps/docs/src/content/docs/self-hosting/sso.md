---
title: Single sign-on (OIDC)
description: Register an OIDC identity provider as a workspace admin, prove you own its email domain, and let your team sign in with your own IdP — free, unlimited, and in the same three containers.
---

yapm signs your team in through **your** OpenID Connect identity provider — Okta, Entra ID, Keycloak,
Authentik, Google Workspace, anything that speaks OIDC. It is **free and unlimited**: no seat count,
no SSO tier, no licence key, and no upgrade prompt anywhere in the flow. It also adds **no
container** — the SSO plugin runs in-process in the same `yapm` server, and domain verification
resolves a DNS record from that same process, so your deployment stays `postgres` + `yapm` +
`zero-cache`.

Two things are true of it that are worth knowing before you start:

- **Only a workspace admin can register or change a provider.** Registering one binds an email
  domain to an authorization endpoint — the strongest configuration action in the product — so it
  requires the same authority the [GitHub connector](/self-hosting/github-connector/) and
  [AI setup](/self-hosting/ai-setup/) require. A member, a viewer, or a signed-in account that
  belongs to no workspace is refused.
- **A provider signs nobody in until you have proved you own its email domain** with a DNS TXT
  record. Until you do, the provider exists in settings and the login form shows **no SSO button** —
  because a button that cannot complete is worse than no button.

:::caution[Upgrading an existing instance]
The first boot after this release adds a `domainVerified` column to the provider table, and it is
**unverified for every provider that already exists**. If your instance was running an older build
and somebody registered a provider through better-auth's own endpoint, that provider stops signing
anyone in until an admin publishes its TXT record and verifies it. Open *Settings → Single sign-on*
and check the list — a provider you do not recognise there should be removed, not verified.
:::

## Before you start

- A **workspace admin** account on your yapm instance.
- An **OIDC application** in your identity provider (created in step 1 below).
- The ability to publish a **DNS TXT record** on the email domain your people sign in with. If you
  are evaluating yapm against a throwaway IdP on a domain whose DNS you cannot edit, you cannot
  complete SSO on this release — use email/password until you can.

## 1. Create the application in your IdP

Create a standard OIDC **web application** (authorization code flow) and set its redirect URI to:

```
https://<your-yapm-domain>/api/auth/sso/callback/<provider-id>
```

`<provider-id>` is a short slug you choose in step 2 — lowercase letters, digits and hyphens,
starting with a letter or digit, e.g. `acme-okta`. It ends up in this URI **and** in a DNS label, so
keep it short.

yapm shows you the exact redirect URI to paste **after** you register the provider, so if you would
rather not guess, register first with a placeholder redirect URI in your IdP and correct it
afterwards. Capture the **client ID**, the **client secret**, and the **issuer URL** (most providers
also publish a discovery document at `<issuer>/.well-known/openid-configuration`).

## 2. Register the provider in yapm

Open *Settings → Single sign-on* from the account menu in [the deck](/features/app-frame/)
(`/settings/sso`). It is
visible to workspace admins only.
The whole surface is keyboard-operable: Tab through the fields, press Enter to submit.

| Field | What to enter |
|---|---|
| **Provider id** | The slug from step 1, e.g. `acme-okta`. It cannot be changed later — delete and re-register instead. |
| **Email domain** | The domain your people's email addresses end with, e.g. `acme.com`. Several domains are allowed, comma-separated; **each one needs its own TXT record.** |
| **Issuer URL** | Your IdP's issuer, e.g. `https://acme.okta.com`. |
| **Discovery URL** (optional) | The full `.well-known/openid-configuration` URL. Leave blank to let yapm discover it from the issuer. |
| **Client ID** | From step 1. Only its **last four characters** are ever shown again. |
| **Client secret** | From step 1. **Write-only** — never returned to the browser or to any API response, exactly as provider API keys work in [AI setup](/self-hosting/ai-setup/). Rotating it means entering the new one, never reading the old one back. |

:::note[Where the client secret lives]
Unlike the AI provider keys yapm stores itself, the SSO client secret is written by better-auth's SSO
plugin into its own `ssoProvider` table, and that plugin stores it **as plain JSON text** — it is not
encrypted with `SECRETS_ENCRYPTION_KEY`. yapm never returns it to a browser and never logs it, but
anyone with read access to your Postgres can read it, and it is in your
[database backups](/self-hosting/backup-restore/). Treat a database dump as carrying an IdP
credential, and rotate the secret in your IdP if a dump is ever exposed.
:::

On success the page shows the **redirect URI** to register with your IdP, and the provider appears
in the list marked *Domain not verified*.

Registration reaches your IdP's discovery endpoint, so a typo in the issuer fails here rather than
silently at sign-in time.

## 3. Prove you own the domain

Under an unverified provider, yapm shows the DNS record to publish:

| Record | Value |
|---|---|
| **Name** | `_better-auth-token-<provider-id>.<domain>` — e.g. `_better-auth-token-acme-okta.acme.com` |
| **Type** | `TXT` |
| **Value** | Press **Show record value**. Copy it with the copy button beside it. |

Publish it in your DNS, wait for propagation, then press **Verify**. yapm resolves the record from
the server process — no service to deploy, no port to open, only outbound DNS.

If verification fails with *"The DNS TXT record was not found"*, that is almost always propagation:
check with `dig +short TXT _better-auth-token-acme-okta.acme.com` from the yapm host and try again in
a few minutes. The record value is minted on demand and is good for **seven days**; pressing **Show
record value** again returns the same one until it expires, at which point you press it once more and
publish the new value.

A provider bound to several comma-separated domains needs the record under **every** one of them —
verification resolves them all, and the settings page lists a record per domain for exactly that
reason. Changing the domain list later — even to add one — sends the provider back to unverified and
takes the SSO button off the login form until you repeat this step, so publish the new record
*before* you change the domain.

## 4. Sign in

Once one provider is verified, `GET /api/auth-methods` reports SSO available and the login form
renders **Continue with SSO**. A person types their work email, yapm matches the domain to your
provider, and the browser goes to your IdP. Your IdP returns them to yapm's sign-in page, which is
where yapm decides where they land — the same decision every other way in takes, so an SSO sign-in
opens on [a team's work](/features/app-frame/#where-signing-in-lands) like any other.

With no verified provider, that button does not exist. That is the whole point of the honesty half
of this feature: yapm advertises a sign-in method only when the method works.

## Rotating the client secret

When your IdP issues a new secret, open *Settings → Single sign-on*, paste it into **New client
secret** on the provider, and press **Replace secret**. There is no reveal control and no read-back:
the field starts empty every time, and the only thing it can do is replace. Over the API it is
`POST /api/v1/sso/providers/<id>` with `{"oidcConfig":{"clientSecret":"…"}}`.

Rotating the secret does **not** reset domain verification and does not sign anyone out.

## Configure it from the API instead

Everything the settings page does is a request to `/api/v1/sso`, admin-gated the same way. This is
the supported path for scripting an install.

First, get a session cookie as a workspace admin:

```bash
YAPM=https://yapm.example.com

curl -s -c yapm-cookies.txt -X POST "$YAPM/api/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@acme.com","password":"…"}'
```

Register a provider:

```bash
curl -s -b yapm-cookies.txt -X POST "$YAPM/api/v1/sso/providers" \
  -H 'content-type: application/json' \
  -d '{
    "providerId": "acme-okta",
    "issuer": "https://acme.okta.com",
    "domain": "acme.com",
    "oidcConfig": {
      "clientId": "0oa1b2c3d4",
      "clientSecret": "…",
      "discoveryEndpoint": "https://acme.okta.com/.well-known/openid-configuration"
    }
  }'
```

The response carries `redirectURI` to register with your IdP and `domainVerificationToken` — the TXT
record value from step 3. It carries **no** client secret.

The rest of the surface:

| Request | Does |
|---|---|
| `GET /api/v1/sso` | `{ configured, providers: [...] }` — the redacted list, no secret material |
| `POST /api/v1/sso/providers` | Register (above) |
| `POST /api/v1/sso/providers/<id>` | Update — every field optional; sending `oidcConfig.clientSecret` rotates the secret. **Changing `domain` resets verification** — see the caution below |
| `DELETE /api/v1/sso/providers/<id>` | Remove the provider |
| `POST /api/v1/sso/providers/<id>/domain-verification` | Mint (or re-read) the TXT record value |
| `POST /api/v1/sso/providers/<id>/verify` | Resolve the record and mark the domain verified |

Every one of them answers `401` with no session and `403` to a signed-in non-admin — **before** it
looks up whether the provider exists, so the answer is the same for a provider id that exists and
one that does not.

:::caution[Changing `domain` turns the SSO button off until you re-verify]
An update that changes `domain` — including one that only **adds** a second comma-separated domain —
resets `domainVerified` to `false`. The provider stops signing anyone in and **Continue with SSO**
disappears from the login form workspace-wide until every listed domain has its own TXT record
published and verified again (step 3). Publish the records first, then change the domain, then
verify — that way the gap is minutes rather than however long DNS takes.

Changing `issuer`, `clientId`, `discoveryEndpoint` or any of the endpoint URLs after people have
already signed in through the provider is refused with `409` — those fields decide which external
account a yapm user is, and moving them would silently re-point existing linked accounts. Register a
second provider instead, then remove the old one.
:::

### better-auth's own SSO endpoints answer 404

yapm removes better-auth's seven provider-management paths from its router entirely:
`/api/auth/sso/register`, `/update-provider`, `/delete-provider`, `/providers`, `/get-provider`,
`/request-domain-verification` and `/verify-domain`. They are `404` for everyone, including a
workspace admin. If you followed better-auth's documentation and got a 404, that is why — use
`/api/v1/sso` above.

The **sign-in** paths are untouched and remain reachable without a session, because the browser
arriving at them has not signed in yet: `POST /api/auth/sign-in/sso`, `/api/auth/sso/callback/<id>`,
and every `/api/auth/sso/saml2/*` endpoint.

## SAML: not configurable on this release

The underlying library speaks SAML 2.0, and every SAML **sign-in** endpoint is present, anonymous
and untouched (`/api/auth/sso/saml2/callback/<id>`, `/sp/acs/<id>`, `/sp/slo/<id>`, `/logout/<id>`,
and the service-provider metadata at `/api/auth/sso/saml2/sp/metadata?providerId=<id>`). What does
**not** exist is a way to register a SAML provider: `/api/v1/sso/providers` accepts an `oidcConfig`
and only an `oidcConfig`, and the library's own registration path is removed along with the other six
management paths.

That is a deliberate limit, stated rather than implied. A SAML configuration surface is an order of
magnitude larger than OIDC's — certificates, metadata documents, signing and encryption algorithm
allow-lists — and shipping an unvalidated passthrough for it would be worse than shipping nothing.
**If you need SAML, use an OIDC bridge in your IdP**, which every major provider offers. Ask for
first-class SAML if you want it prioritised; nothing in the design here forecloses it.

## Limits and rules worth knowing

- **Five providers per admin account.** A defence-in-depth cap, not a licence: the limit is counted
  per registering account, and yapm re-points a provider at whichever admin last changed it. An
  admin who has touched five providers cannot register a sixth — have a colleague register it.
- **Providers are workspace configuration, not personal property.** Any workspace admin can update,
  verify or delete any provider, so an admin leaving never strands your SSO setup.
- **Nothing about a provider is synced to browsers.** The provider table is server-only; it is
  excluded from the sync schema by a test, because it holds client secrets.
- **Non-admins see nothing.** *Settings → Single sign-on* renders the same "admins only" absence the
  AI and connectors screens render — not an error, and not an empty state describing something they
  cannot fix.

## Troubleshooting

| Symptom | Cause |
|---|---|
| No **Continue with SSO** on the login form | No provider is registered, or none is verified. Check *Settings → Single sign-on*. |
| **Verify** says the record was not found | DNS has not propagated, or the record is on the wrong name. Confirm with `dig +short TXT _better-auth-token-<id>.<domain>`. |
| `403` from `/api/v1/sso` | The session is not a workspace admin. Another admin can change a role in the **Members** list on the workspace home page. |
| `409 provider_exists` on register | That provider id is already taken. Delete it first, or pick another slug. |
| `409 provider_limit_reached` on register | This admin account has registered the five providers it may. Remove one, or have a colleague with the admin role register this one. |
| `502 issuer_unreachable` on register | yapm could not read the issuer's discovery document — a wrong issuer URL, or no outbound route from the server to your IdP. `curl` the `.well-known/openid-configuration` URL from the yapm host to tell the two apart. |
| `400 invalid_provider_config` on register | The provider id is reserved (it collides with a built-in or social provider name), or the issuer/discovery URL is not a valid absolute URL. Pick another slug. |
| `502 domain_verification_failed` on **verify** | The TXT lookup ran and found no matching record — see the row above about propagation. |
| `404` from `/api/auth/sso/register` | Expected — that path is removed. Use `POST /api/v1/sso/providers`. |
| Sign-in bounces back with an IdP error about the redirect URI | The URI in your IdP does not match `https://<your-yapm-domain>/api/auth/sso/callback/<provider-id>`. The settings page prints the exact value after registration. |
