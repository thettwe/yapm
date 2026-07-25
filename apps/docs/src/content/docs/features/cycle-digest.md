---
title: Cycle digest
description: A team-internal, evidence-linked AI summary of a completed cycle, with a raw-evidence fallback when AI is off.
---

The **cycle digest** is a short, team-internal summary of what a just-completed cycle delivered:
a TL;DR headline, then evidence-linked items grouped into sections (what shipped, carried work,
notable risks). It appears on the [Cycles](/features/cycles/) view for the team that owns the
cycle. Every claim links to the exact work-graph entity it came from — the issue, PR, CI check, or
deploy — so you verify it with one click rather than taking it on faith.

The digest is a read-only summary for the **team**. It is not a stakeholder- or PM-facing report,
and it never leaves the team boundary.

## How it is produced

When a cycle closes, yapm pre-computes the digest **off the hot path** on the same background
worker that already rolls unfinished issues forward — so it is ready the moment you open the
completed cycle, and opening a cycle is never blocked on a model call. The pipeline:

1. yapm computes the cycle's facts — the shipped/carried counts and, for each issue, its linked
   PRs, CI conclusions, and deploy state.
2. The model **narrates** those facts into typed sections and items. The numbers are computed by
   yapm, not the model, so it cannot invent a metric.
3. yapm drops any item that does not cite a real work-graph entity (**cite evidence or omit**), and
   rejects any output that names a person, before the digest is stored.

## Team-level and blameless

The digest is about the **work and the product, never a person.** The data fed to the model is
team-level only — there is no assignee, author, or reviewer dimension anywhere in it — so the model
structurally *cannot* name an individual, and a deterministic check drops anything that slips
through. This is the same team-level, non-surveillance stance as the rest of yapm.

## Evidence links

Each item carries one or more evidence links:

- an **issue** opens in the issue detail panel, right where you are;
- a **pull request** or **CI check** links out to the entity on GitHub;
- a **deploy** is shown as a labeled reference.

Nothing remote is auto-loaded from the summarized content — the digest renders only text and
explicit links.

## When AI is off

The digest is an enhancement layer on a surface that stands alone. With AI off, unconfigured, over
its spend cap, or after a failed run, the same section shows the **raw linked-evidence fallback**
instead: the cycle's shipped and carried issues with their linked PRs and CI health, the related
deploys, and the scope delta (shipped / carried / canceled). That is strictly more than you had
before, and it never blocks opening the cycle. See
[Enable AI](/self-hosting/ai-setup/) to turn the AI narrative on.

## Who sees it

Any member of the cycle's team reads the digest, viewers included — it is read-only for everyone
and follows the same team-scoped visibility as the rest of a team's work. A non-member of the team
never sees it.
