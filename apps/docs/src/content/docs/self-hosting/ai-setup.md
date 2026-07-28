---
title: Enable AI (bring your own key)
description: Turn on yapm's optional, provider-agnostic AI by adding your own Anthropic, Gemini, or OpenAI key.
---

yapm's AI is **bring-your-own-key**: you point it at your own Anthropic, Google (Gemini), or
OpenAI account, and inference runs against your key. yapm hosts no model and adds no service — the
AI call runs **in-process** in the same yapm server container, so your three-container deployment
(`postgres`, `yapm`, `zero-cache`) is unchanged. AI is **off until you turn it on**, and every AI
feature degrades cleanly when it is off.

:::note
AI is optional. With no key configured and no `AI_*` variables set, the AI settings screen stays
available to admins but every feature simply shows its non-AI fallback. Boot is never affected.
:::

## Two ways to provide a key

**Per workspace, through the admin UI (recommended).** A workspace admin opens
*Settings → AI*, pastes a provider key, picks a model, and toggles AI on. UI-entered keys are
**encrypted at rest** (AES-256-GCM) and read only on the server — they never enter a synced query
or the browser bundle. This path needs `SECRETS_ENCRYPTION_KEY` set (the same key the GitHub
connector uses):

| Variable | From | Notes |
|---|---|---|
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` | base64 32 bytes; encrypts UI-entered keys at rest — **back this up**, losing it makes stored secrets unrecoverable |

Without `SECRETS_ENCRYPTION_KEY`, the AI screen shows a notice naming the variable and the key
fields are hidden, but instance-default env keys (below) still work.

**Instance-default, through the environment.** For a single-instance self-host that prefers env
over DB-resident secrets, set a provider key and a default provider directly. All are **optional**;
absent means AI stays off.

| Variable | From | Notes |
|---|---|---|
| `AI_ANTHROPIC_API_KEY` | Anthropic console | instance-default Anthropic key, or unset |
| `AI_GOOGLE_API_KEY` | Google AI Studio | instance-default Gemini key, or unset |
| `AI_OPENAI_API_KEY` | OpenAI dashboard | instance-default OpenAI key, or unset |
| `AI_DEFAULT_PROVIDER` | `anthropic` \| `google` \| `openai` | which of the above is the instance default; enables AI without a DB config row |
| `AI_DIGEST_ON_CYCLE_CLOSE` | `true` (default) \| `false` | gates the cycle-digest pre-compute job |

A per-workspace UI key wins over the instance-default env key for the same provider.

## Choosing a model

Model IDs and prices change often, so yapm treats the model as **runtime configuration**, never a
hardcoded list: in *Settings → AI* the model is a plain text field per provider. Enter a current
model id from your provider (a cheap, fast model is a good default — the cycle digest is a bounded
summarize-and-structure task, not a reasoning marathon). Pick a workspace **default provider** to
choose which configured provider runs.

## Product areas (optional)

The [cycle digest](/features/cycle-digest/) can describe **where** work landed — by product area,
not by file. That needs one thing from you: an ordered map from repository path prefixes to area
labels, in *Settings → AI → Product areas*. Each row is:

| Field | Meaning |
|---|---|
| **Path prefix** | A literal path prefix, e.g. `apps/server/src/billing/`. No globs, no regex — a prefix is what a directory tree needs, and a regex in a form field is a denial-of-service surface. |
| **Area** | The label the digest uses, e.g. `Billing`. Reuse a label across several prefixes freely. |
| **Sensitive** | The digest reports when the cycle touched this area. It reports; it does not judge. |
| **Internal** | Work landing *only* in internal areas is collapsed into one "N internal improvements" line. Good for tooling, CI config, and dependency chores. |

**Order is semantic: the first matching prefix wins.** Put the narrow rule above the broad one —
`apps/server/src/billing/ → Billing` before `apps/server/ → Backend`, or every billing change is
reported as generic backend work. The editor's move-up / move-down buttons are keyboard-operable for
exactly this reason.

A path no rule matches is labeled **`unmapped`**, which is a reserved label — yapm never falls
through to the raw path. `unmapped` is refused as an area name of your own: the editor blocks the
save and says why.

**An empty map is the off switch.** With no rules, yapm makes **zero** extra GitHub calls and the
digest is byte-for-byte what it was before. You do not opt out; you opt in.

### The GitHub rate budget this spends

Area labels come from GitHub's changed-file metadata, one request per pull request linked to an
issue in the closing cycle — whatever state that pull request is in. That draws on the same
per-installation primary rate budget (**5,000 requests/hour**) as the connector's reconciliation
sweep, so the draw is bounded four ways:

1. **Zero when the map is empty** — no rules, no requests.
2. **At most 50 pull requests per cycle.** Past that the digest states, in yapm's own words above
   the narrative, how many of the cycle's pull requests the grouping covers — it never presents a
   partial grouping as exhaustive. The cap is a constant, not an environment variable: it is a
   safety bound on a shared budget, not a preference.
3. **A remaining-quota floor of 500.** If the installation's reported remaining quota drops below
   that mid-run, enrichment stops for the rest of the run. Reconciliation is the connector's
   load-bearing job and a digest must never be the thing that starves it.
4. **One page of files per pull request.** yapm reads the first 100 changed files and does not
   paginate — a pull request touching more than that is already "big and everywhere". Such a pull
   request is banded `xl`, its area list is reported as partial, and the digest says so rather than
   presenting a first-100-files view as the whole change.

Requests are made **serially**, per GitHub's own guidance on secondary rate limits. If GitHub is slow
or erroring, the digest still completes — un-enriched, never failed.

Nothing from the response is persisted: no column, no cache table. yapm reads the metadata, converts
paths to labels, and drops it. **Diff content is never read** — see
[what the model sees](/features/cycle-digest/#what-the-model-sees-and-what-it-does-not).

## Spend and estimated cost

Because it is your key, **you pay for inference.** yapm surfaces an **estimated** per-run cost and
a per-workspace running total, computed from token usage against an updatable price table and
clearly labeled "estimated." You can set an optional **spend cap** in *Settings → AI*; once a
workspace's estimated spend reaches the cap, further runs are refused (they behave exactly like
AI-off).

## Privacy

The BYO-key model means your work-graph data is sent only to **your** provider under **your** key —
yapm never proxies it through a hosted service. Keys are encrypted at rest, decrypted only in
server memory for the duration of one call, and never logged. The AI is only ever fed **team-level
aggregates** — no per-person data reaches the model — and it has no outbound network tools, so it
cannot exfiltrate what it reads. **Your source code never reaches a provider:** yapm reads
changed-file metadata to derive product-area labels and never reads a diff, and the labels — not the
paths — are what the model is given.

## What "AI off" looks like

Turn AI off (or leave it unconfigured, hit the spend cap, or have a provider outage) and nothing
breaks:

- The [cycle digest](/features/cycle-digest/) shows its **raw linked-evidence** fallback — the
  cycle's shipped and carried issues with their linked PRs, CI/deploy status, and scope delta —
  instead of the AI narrative. Opening a cycle is never blocked on a model call.
- The AI settings screen stays available to admins so you can turn it back on at any time; enabling
  it takes effect without a restart.
