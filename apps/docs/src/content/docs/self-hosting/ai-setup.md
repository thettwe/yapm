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
cannot exfiltrate what it reads.

## What "AI off" looks like

Turn AI off (or leave it unconfigured, hit the spend cap, or have a provider outage) and nothing
breaks:

- The [cycle digest](/features/cycle-digest/) shows its **raw linked-evidence** fallback — the
  cycle's shipped and carried issues with their linked PRs, CI/deploy status, and scope delta —
  instead of the AI narrative. Opening a cycle is never blocked on a model call.
- The AI settings screen stays available to admins so you can turn it back on at any time; enabling
  it takes effect without a restart.
