---
title: Product digest
description: A product-facing summary of a completed cycle that a team reviews and shares with named readers outside the team, off by default behind four switches.
---

The **product digest** is a second summary of a completed cycle, written at product altitude —
outcomes and [product areas](/features/cycle-digest/#product-areas), not engineering internals — and
read by people who are **not on the producing team**. It is the only thing in yapm whose output
crosses a permission boundary, so almost everything about it is a refusal.

It is a different artifact from the [cycle digest](/features/cycle-digest/), which stays inside the
team and always will. Both are generated from the same facts; only the audience, the prompt and the
render differ.

**Off by default, four times over.** An operator sets `AI_PM_DIGEST`, an admin turns product digests
on for the workspace, an admin turns them on per team, and an admin names each reader. All four have
to agree. Any one of them is a complete stop.

## Nobody new

There is no "PM role". yapm's roles are still **admin**, **member** and **viewer**, and none of them
grants this. Being named on a team's reader list *is* the entitlement — that list, and nothing else,
decides who reads that team's product digests. A workspace admin who has not named themselves reads
no product digest either.

A reader outside the producing team reads **only the product digest**. They gain no access to that
team's issues, cycles, pull requests, labels, deployments, saved views, retrospectives or
team-internal cycle digests, and asking for one returns exactly what it returns for anybody else:
nothing at all, indistinguishable from asking for something that never existed.

## The team reads it first

A generated product digest reaches nobody until a human on the producing team releases it.

On the team's own [Cycles](/features/cycles/) view, beside the cycle digest, a **Shared with product**
card shows the full product-facing text — every word a reader outside the team would see. When the
run is ready, anyone on the team who can write chooses **Share with product**. Until they do,
nothing has left the team.

This runs the feature at human speed, deliberately. The failure it prevents is the one that cannot
be undone: **retraction stops further reads, it does not un-read.** Nothing in this feature — not
retraction, not the kill switch, not turning a team off — can recall a summary a reader has already
read. Both surfaces say so in those words rather than implying otherwise with a button label.

After sharing, the card shows **"Shared with N readers outside this team."** `N` is a snapshot, taken
when the team released it, not a running count — so it does not quietly change when an admin edits
the list afterwards. It is never a list of names: yapm shows the producing team a count, and no
reader roster exists on any surface in the product.

Two consequences of that snapshot being honest. **Sharing is refused while sharing is stopped** — if
an admin has turned the workspace off, turned the team off, or set the kill switch, the release does
not go through, because a digest released under a hold would claim it went to nobody and then quietly
become readable when the hold lifted. And **if yapm ever rewrites a digest, it un-shares it first**:
new text is never left standing on a release the team gave to the old text, so anything rewritten
goes back through the same human gate.

## Evidence is a label, not a link

Every item in a product digest carries the same evidence yapm demanded of it — an issue, a pull
request, a CI check, a deploy — rendered as plain text: `ENG-142 · PR #331`.

Those are deliberately **not links**. A reader outside the producing team can open none of the
targets, so a link would dead-end; and making the links work means granting that reader access to
the issues and pull requests behind them, which is a far larger disclosure than the sentence the
link was meant to make verifiable. The label is what the summary is accountable to, and it is enough
to ask the team about.

Only the work the summary actually cites gets a label. The cycle's other issues and pull requests
contribute nothing to the stored digest — a complete key-and-number index of the cycle would be a
disclosure of its own, and one nothing in the prose asked for.

Nothing remote is loaded from a product digest, and nothing in it links out.

## What the model sees

Exactly what the [cycle digest](/features/cycle-digest/#what-the-model-sees-and-what-it-does-not)
sees, for the same cycle: yapm's own counts, issue and pull-request titles as untrusted data, CI
conclusions, and — with a [product-area map](/features/cycle-digest/#product-areas) configured — area
labels, change-size bands and sensitive-area flags.

It does not see patch content. yapm never reads diffs, and it will not start reading them for this:
a summary that quoted your source would need a secret scanner to be safe, and the guarantee worth
keeping is that the worst a bad run can produce is a bad paragraph, never a leak. That guarantee
matters more here than anywhere else in yapm, because here the paragraph leaves the team.

The same three deterministic checks run before anything is stored: an item that cites no real
work-graph entity is dropped, output that names a person is rejected, and an item whose text carries
a file path, a filename extension, a code fence or a code identifier is dropped. **Be honest about
the ceiling:** without a product-area map, the model is working from issue and pull-request titles,
and the summary will read like it. The area map is what gives a product digest something to say.

## The reader is told, with a link and nothing else

A named reader does not have to keep checking. When a team releases a product digest, every named
reader who is still in the workspace gets an [**inbox row**](/features/notifications/) in yapm. The
row's title is the team's name and the cycle's name, its key column is empty — a digest has no issue
key — and the phrase beside it reads *"Shared with you"*. It names no publisher — telling somebody
outside the team which individual released a digest is accountability pointed the wrong way — and it
carries no content.

Optionally, and **off by default**, they also get one email. Outside the app there is no row to read
the subject from, so the mailed notice states the whole sentence: *"A cycle digest was shared with
you"*. That message carries the team's name, the cycle's name and **a link**. Never the digest itself, and that is a decision rather than an
oversight: a mailed message sits outside the kill switch, outside retention and outside the audit
record at the same time. An admin who stops all sharing stops every further read in yapm and cannot
reach an inbox. So the notice carries a link, and a reader who is no longer entitled follows it into
an absent surface.

Entitlement is re-checked when the message is sent, not just when it was written: a reader removed
from the list, a team switched off, the kill switch set, or the digest retracted in between means
nothing goes out — and the notice waits rather than being spent, so re-releasing still reaches
them. See
[the disclosure model](/self-hosting/ai-disclosure/) for the operator's side of this.

## Auditable, and retention-bounded

Both words, used narrowly.

**Auditable** means every policy change, generation, release and retraction is recorded, and a
workspace admin can read that record in *Settings → AI → What has been disclosed*. It reports what
was disclosed and **to how many readers**. It does **not** mean reads are recorded — nothing records
those, and the section says so in the same breath.

**Retention-bounded** means those records are deleted after a configured window, one year by default.
It does not mean digests expire; only the audit records do.

The audit view is admin-only and team-level: totals are grouped by team, and there is no per-person
aggregate anywhere in it.

## Team-level, and no read log

The product digest is about the work, never a person — the data behind it carries no assignee,
author or reviewer dimension at all, exactly as the cycle digest does.

yapm also does **not** record who read a product digest or when. A per-reader read log would be a
surveillance surface pointed at people outside the team, and the trust question the producing team
actually has — *how far did this go?* — is answered by the count on their own cycle view.

## When AI is off

There is no fallback surface, and that is the deliberate choice. Everywhere else in yapm, an AI
feature that cannot run falls back to the raw linked evidence underneath it — but a reader outside
the producing team **has no raw evidence to fall back to**, because every entity behind the prose
belongs to a team they are not on.

So for this one feature, degrading means the surface is **cleanly absent**: no navigation entry, no
route, no empty state, and — for a reader nobody has named — no query issued. That is exactly what
they see under the default configuration.

The absence covers being named, too. A reader who is on a team's list but has never been sent
anything gets no entry and no surface either, rather than an empty state: "nothing has been shared
with you yet" would tell them that a channel exists and that the team on the other side of it has
chosen not to use it, which is not yapm's to say. The entry appears the moment a team shares
something, and disappears again if they retract it.

## Turning it on

1. An operator sets `AI_PM_DIGEST=true` (it requires `AI_DIGEST_ON_CYCLE_CLOSE`, and yapm refuses to
   start if you set one without the other). See [Enable AI](/self-hosting/ai-setup/).
2. In *Settings → AI → Product digests*, an admin turns product digests on for the workspace.
3. In the same block, an admin turns a specific team on and names the workspace members who may read
   that team's product digests.
4. When one of that team's cycles closes, yapm writes a product digest and the team reviews it.
5. Somebody on the team shares it. Only then does anybody outside the team read anything.

**Stop all sharing** is beside the workspace switch. It blocks every read immediately, whatever else
is set. It does not un-read.

Optionally, an operator also sets `AI_PM_DIGEST_READY_EMAIL=true` to email each named reader a link
when a digest is released. It requires `AI_PM_DIGEST`, it needs an
[email transport](/self-hosting/email/), and it carries a link only. See
[the disclosure model](/self-hosting/ai-disclosure/).

Generating a product digest is a second model call on your own key, on the same cycle's facts, and
it counts toward the workspace [spend cap](/self-hosting/ai-setup/). A team with product digests off
costs nothing at all: yapm checks the switch before it calls the model.
