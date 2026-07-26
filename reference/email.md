# Reference: outbound email — `@react-email/render` 2.1.0 and `nodemailer` 9

Harvested during ROADMAP change #11 (`notifications`). Covers the two libraries the
[mailer seam](../TECHSTACK.md) depends on. Both postdate the model training cutoff, and **both are
routinely written wrong from memory** — see §1.1 and §3.1 for the two traps that cost real time.

**Verification policy applied:** every claim below was read from an installed `.d.ts` or
`package.json` inside this repo's own `node_modules`, or observed from a real build/typecheck run
during the change. Nothing here is from memory.

| Package | Installed | Where |
|---|---|---|
| `@react-email/render` | **2.1.0** | catalog; the only react-email runtime dependency of `packages/email` |
| `react-email` | **6.9.1** | catalog; **devDependency only** — the `email dev` preview CLI |
| `nodemailer` | **9.0.3** (MIT-0) | catalog; used by `apps/server/src/mail/smtp.ts` |
| `@types/nodemailer` | **8.0.1** | catalog, devDependency |

---

## 1. react-email v6: the component packages are gone

### 1.1 The trap — `@react-email/components` is deprecated

react-email **v6 folded every component into the single `react-email` package**. Installing
`@react-email/components@1.0.12` prints `deprecated` for it **and for ~20 sub-packages**
(`@react-email/body`, `@react-email/html`, `@react-email/tailwind`, …). The split `@react-email/*`
component family is the v5-and-earlier layout. Confirmed in the installed tree:
`node_modules/react-email/dist/index.d.mts` exports `Body`, `Button`, `Container`, `Head`, `Html`,
`Tailwind`, `Text` and the rest, and ends with `export * from "@react-email/render"`.

`@react-email/render` itself is **not** deprecated.

Neither obvious move is right:

- **`@react-email/components` at runtime** ships a deprecated family *and* drags in a second copy of
  `@react-email/render` (it pins 2.0.6 while the catalog wants 2.1.0), plus `tailwindcss` and
  `prismjs`.
- **`react-email` at runtime** puts esbuild, socket.io, chokidar, `@babel/traverse` and prismjs into
  the server's runtime tree to render two messages.

**What yapm does:** depend on `@react-email/render` alone and write plain intrinsic JSX. The cost is
near zero and was checked rather than assumed — `<Html>` compiles to
`jsx("html", {dir, lang, ...props})`, and `<Container>` / `<Section>` are thin sugar over a
`<table>` or `<div>` with inline styles. `packages/email/src/layout.tsx` writes that markup directly.

### 1.2 `render` is **async**

From `node_modules/@react-email/render/dist/node/index.d.mts`, verbatim:

```ts
declare const render: (node: React.ReactNode, options?: Options) => Promise<string>
declare function toPlainText(html: string, options?: HtmlToTextOptions): string
declare const pretty: (str: string, options?: Options$1) => Promise<string>
export { Options, plainTextSelectors, pretty, render, toPlainText, unstableToPlainText }
```

Any template helper that wraps `render` is therefore `Promise`-returning. Writing
`function renderInvite(input): RenderedMessage` is the natural-looking signature and does not
compile.

### 1.3 Plain text: derive it from the rendered HTML, not from a second render

`render(el, { plainText: true })` works, but it renders to HTML *and then converts* — a second pass
over the same tree. Calling the exported `toPlainText(html)` on the string you already have is
strictly stronger and half the work: the HTML and text parts do not merely come from the same call,
they come from the same **string**. Output was verified identical between the two routes.

```ts
export async function renderMessage(subject: string, element: ReactElement) {
  const html = await render(element)
  return { subject, html, text: toPlainText(html) }
}
```

### 1.4 JSX under TS7 + `nodenext` + `verbatimModuleSyntax` is fine

Verified by a real build, not assumed. `jsx: "react-jsx"` plus `lib: ["ES2024", "DOM"]` typechecks
and emits clean ESM (`import { jsx as _jsx } from "react/jsx-runtime"`), and the built `dist/index.js`
runs under Node 24 with no loader. Neither designed escape hatch (`React.createElement`, then plain
template functions) was needed.

Both settings are isolated to `packages/email/tsconfig.json`. Keeping them out of `apps/server`'s
tsconfig is the whole reason the templates live in their own package.

### 1.5 Email cannot use design tokens

Email clients strip `<style>` blocks and do not resolve CSS custom properties, so an email must
carry literal hex in inline `style` attributes. This is the one place in the repo where the
tokenized-styling rule cannot reach. `packages/email/src/theme.ts` holds the Warm-light token values
copied from `packages/ui/src/styles/globals.css`, in one file, named after the tokens they came
from, so the copy is auditable rather than scattered. There is no theme switcher and no dark variant
in email — one rendering, and the medium is why.

---

## 2. Resend over HTTPS: no SDK needed

Sending is one authenticated JSON POST:

```
POST https://api.resend.com/emails
authorization: Bearer ${RESEND_API_KEY}
content-type: application/json

{ "from": …, "to": [ … ], "subject": …, "html": …, "text": … }
```

Non-2xx → throw with the status and the response body. Node's built-in `fetch` covers it in a dozen
lines; the `resend` package pulls `postal-mime` and `standardwebhooks` for the same request. **No SDK
is in the catalog, deliberately.**

Take the HTTPS transport when the host **blocks outbound SMTP ports** (many PaaS providers do), where
SMTP cannot be made to work at all.

---

## 3. nodemailer 9

`nodemailer@9.0.3` is **MIT-0** with **zero runtime dependencies** (verified from the installed
`package.json`: `dependencies` is `{}`).

### 3.1 `@types/nodemailer@8.0.1` is compatible, despite the major skew

The types' major trails the runtime's, which looks alarming and is not. A minimal
`createTransport(url).sendMail({from, to, subject, html, text})` typechecks under the app's strict
config with no error, and the named ESM import resolves at runtime against the CJS package —
`createTransport('smtp://…')` yields an `SMTPTransport`. **No local `.d.ts` shim is needed.**

### 3.2 Declare a two-method local interface anyway

`SmtpMailer` declares its own `SmtpTransport` interface rather than importing nodemailer's
`Transporter`. Not distrust of the types: it makes the injected test double a five-line object
literal instead of a mock of a 40-member class, and it keeps the single nodemailer type in the seam
down to `createTransport`'s return. The same reason `ResendMailer` takes an injectable `fetch`.

CI has no SMTP server and no API key, and never needs one.

### 3.3 `createTransport` does not validate the URL — it throws an unattributable `TypeError`

`createTransport` accepts *either* an options object *or* a connection URL, and it decides which by
duck-typing rather than by parsing. Anything it does not recognise as an SMTP URL is treated as an
options object, and the first property assignment onto that string throws. Observed against the
installed `nodemailer@9.0.3`:

```
createTransport('not-a-url')                    → TypeError: Cannot create property 'mailer' on string 'not-a-url'
createTransport('https://relay.example.com:587') → TypeError: Cannot create property 'mailer' on string 'https://…'
createTransport('relay.example.com:587')         → TypeError: Cannot create property 'mailer' on string 'relay.example.com:587'
createTransport('smtp://u:p@host:587')           → ok  (port 587, secure false)
createTransport('smtps://u:p@host:465')          → ok  (port 465, secure true — implicit TLS)
```

A well-formed URL on the wrong scheme fails exactly like a non-URL, and **the message names neither
the variable nor the expected format** — the operator gets `Cannot create property 'mailer'` and no
hint that `SMTP_URL` is what is wrong.

So `SMTP_URL` is validated in `envSchema` (scheme must be `smtp:` or `smtps:`) rather than left to
the transport. That is not belt-and-braces: it is the difference between failing at boot with the
variable named and failing later with a message about a property called `mailer`.

`EMAIL_FROM` is validated there for the same class of reason, one step further out — both transports
*accept* a From with no address in it and the provider rejects it at send time, in their log rather
than ours. `RESEND_API_KEY` gets no check: it is an opaque credential with no syntax, so a wrong key
is only ever a caught, logged 401 on the first send.

---

## 4. `SMTP_URL` reaches nearly every provider

Mailgun, Resend, Mailjet, Postmark, SendGrid and SES all issue SMTP relay credentials, so the single
SMTP implementation covers most self-hosters. This is why SMTP is the default transport and the
HTTPS one is the escape hatch rather than the other way round.
