---
title: Cycle digest
description: A team-internal, evidence-linked AI summary of a completed cycle, with a raw-evidence fallback when AI is off.
---

The **cycle digest** is a short, team-internal summary of what a just-completed cycle delivered:
a TL;DR headline, then evidence-linked items grouped into sections (what shipped, carried work,
notable risks). It appears on the [Cycles](/features/cycles/) view for the team that owns the
cycle. Every claim links to the exact work-graph entity it came from — the issue, PR, CI check, or
deploy — so you verify it with one click rather than taking it on faith.

The digest is a read-only summary for the **team**, and it never leaves the team boundary. The
separate, off-by-default [product digest](/features/pm-digest/) is the artifact a team can choose to
share with named readers outside it — a different summary of the same cycle, reviewed and released by
the team before anybody else reads it.

## How it is produced

When a cycle closes, yapm pre-computes the digest **off the hot path** on the same background
worker that already rolls unfinished issues forward — so it is ready the moment you open the
completed cycle, and opening a cycle is never blocked on a model call. The pipeline:

1. yapm computes the cycle's facts — the shipped/carried counts and, for each issue, its linked
   PRs, CI conclusions, and deploy state.
2. If a [product-area map](#product-areas) is configured, yapm asks GitHub which files each linked
   pull request touched, converts those paths into area labels, and discards the file list.
3. The model **narrates** those facts into typed sections and items. The numbers are computed by
   yapm, not the model, so it cannot invent a metric.
4. yapm drops any item that does not cite a real work-graph entity (**cite evidence or omit**),
   rejects any output that names a person, and drops any item that discloses a file path, before the
   digest is stored.

## Product areas

A digest that says *"seven issues shipped"* is a count. A digest that says *"Billing and Checkout
moved, one large change landed in a sensitive area, plus four internal improvements"* is a briefing.
**Product areas** are what turn one into the other.

An admin maps repository path prefixes to area labels — `apps/server/src/billing/ → Billing`,
`apps/web/ → Web` — in *Settings → AI*. When a cycle closes, yapm asks GitHub which files each pull
request linked to one of the cycle's issues touched — whatever state that pull request is in —
converts every path into its area label, and **throws the file list away**. Nothing about it is
stored, and the model is only ever shown labels.

With a map configured, the digest gains four things:

- **Area grouping** — work described by the area it landed in, with the issue and PR count per area
  computed by yapm.
- **Change-size bands** — each issue carries a coarse band (`xs` / `s` / `m` / `l` / `xl`) rather
  than a line count, so "a big change" is a fact rather than the model's opinion.
- **Sensitive-area flags** — mark an area *sensitive* and the digest reports that the cycle touched
  it. It reports, it does not judge.
- **The internal-improvements collapse** — mark an area *internal* (tooling, CI config, chores) and
  work landing only there is collapsed into a single "N internal improvements" line instead of one
  item per issue. Those issues stay in the cycle's own evidence; only the narration collapses. The
  collapse is a claim that *every* area the work touched is internal, so yapm withholds it whenever
  it could not place the work completely — an unmapped path, or a pull request larger than the one
  page of files yapm reads. Uncertain work is narrated, never quietly filed as routine.

Work under a path no rule covers is labeled **`unmapped`** — never the raw path. So a partial map is
useful immediately, and an incomplete one is honest about its gaps rather than silently wrong. If
yapm could only map some of the cycle's pull requests, the digest says so in a line yapm writes
itself — *"Area grouping covers 50 of 60 pull requests"* — rather than presenting a partial grouping
as the whole picture. Like every number in the digest, that one is counted by yapm, not the model.

**An empty map costs nothing.** Areas are off until an admin writes a rule: with no rules, yapm makes
no extra GitHub call and the digest is exactly what it was before. See
[Enable AI → Product areas](/self-hosting/ai-setup/) to configure the map.

## What the model sees, and what it does not

The digest's safety properties are structural — enforced by what is *never assembled*, not by asking
the model nicely.

**It sees:** the cycle name; the yapm-computed counts; per-issue titles and statuses, each issue's
CI conclusions and the evidence ids of its linked PRs and checks; and, when a map is configured, the
area labels, the change-size bands, the sensitive-area list and the internal-improvement count.
Everything numeric is computed by yapm and handed over to be restated. Issue titles are
human-authored text, passed through as **untrusted data** the model may summarize and must never
obey.

**It never sees:**

- **Patch content — diffs are never read.** yapm reads changed-file *metadata* only, and the diff
  text GitHub returns alongside it is dropped at the boundary, before any part of yapm can hold it.
  This is a deliberate limit, not an oversight: a digest that quoted your source would need a secret
  scanner to be safe, and the guarantee worth keeping is that the worst a bad run can produce is a
  bad paragraph, never a leak.
- **Any file path yapm derived.** The path→area substitution happens *before* the model is called
  and it is total, so nothing yapm computes from your repository reaches the model as a path,
  filename or extension. What yapm cannot unsay is a path a human typed into an issue title — that
  travels with the title, as untrusted data — so as a backstop yapm drops any generated item whose
  text contains a path, a filename extension, a code fence or a code identifier.
- **Any person.** No assignee, author, reviewer or commit-author dimension exists anywhere in the
  data — see below.
- **The internet.** The AI step has no tools and no outbound network access, so it cannot fetch or
  send anything.

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
