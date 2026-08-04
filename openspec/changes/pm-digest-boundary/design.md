# Design — pm-digest-boundary

## Context

This is the first yapm change whose output is read by someone the producing team did not choose.
Everything expensive about it is irreversible: a migration, a second authorization axis, an audit
table, and a permission model people will build on. Everything cheap about it is the prose. So the
irreversible half ships while the blast radius is small, which is the whole reason SCOPE reordered
change 21 (product areas) ahead of this one — the substance already exists on the team-internal
digest, and this change is judged on the boundary rather than on the writing.

Constraints that are settled and not re-litigated here (maintainer decisions, SCOPE §4/§5/§9):

- Build the second authorization axis properly. Widening `cycle_digest`'s reader was considered and
  declined.
- The audience unit is **the team, carrying an explicit member list**, stored in
  `connector_config.config`. Not project-scoped, not role-based.
- **Nobody new.** Membership of a team's audience list *is* the entitlement. No PM role; the
  `admin | member | viewer` model is untouched.
- **Default-on human review-and-publish gate.**
- Patch content in front of the model is **declined, not deferred**.

## Goals / Non-Goals

**Goals.** One synced `pm_digest` entity. One new read predicate beside `teamScoped`, never inside
it. Four default-off switches in the existing admin-gated jsonb. A server-only `ai_disclosure_audit`
table outside the sync schema. One extra `generateStructured` run in the existing job over the
existing facts. A reader surface that does not exist by default, and a producing-team surface that
shows the text before anyone outside sees it.

**Non-goals.** Retention, an audit *view*, and the ready-email — all change 23, which also owns the
words "auditable" and "retention-bounded" in user-facing copy. Evidence links for the PM. A
per-reader read log. A project-scoped audience.

## Decisions

### D1 — `pm_digest` is a separate row, and it relates to nothing

`reference/zero.md:1884`: *"there is no `select()` — ZQL always returns the whole row."* A query
serving a PM over `cycle_digest` hands them the team-internal `content` column. Separate row,
forced, not chosen.

The second half is not forced by anything and is the more dangerous one: **no query over `pm_digest`
may traverse a relationship.** `withLinkedDelivery` and `retros.detail` both rely on "team-scoping is
inherited — the subtree is only reached through an already team-scoped row". That reasoning does not
transfer: a `.related('cycle')` on the PM query would sync a `cycle` row to a reader with no team
membership, and it would review as ordinary Zero. So the row is **self-sufficient**: the team name,
the cycle name and dates, and every evidence label are baked into `content` by the server at
generation time. A future relationship is a second disclosure, and the spec says so.

### D2 — `pmAudienceScoped`, beside `teamScoped`, with no admin bypass

`teamScoped` has 17 call sites across ~15 named queries. The one-line widening is the failure mode
SCOPE names, and the `notifications.mine` comment is the precedent for how to write against it: name
the deviation, say what the wrong shape would look like, and make the falsifiable check assert the
*surprising* case.

```ts
export function pmAudienceScoped<TTable extends keyof Schema['tables'] & string, TReturn>(
  q: Query<TTable, Schema, TReturn>,
  ctx: AuthContext | undefined,
): Query<TTable, Schema, TReturn>
```

Behaviour: deny (`denyAll`) unless `isMember(ctx)`; deny when `ctx.pmAudienceTeamIds` is absent or
empty; otherwise `.where('teamId', 'IN', ids).where('publishedAt', 'IS NOT', null)`.

Three properties, each deliberate:

1. **No admin bypass.** `teamScoped` returns `q` unfiltered for `role === 'admin'`. This predicate
   does not, because the maintainer's answer to "who is the PM" is *nobody new* — the list is the
   entitlement, full stop. An admin already reads every team's internal digest through `teamScoped`,
   so this is not a security gain; it is a *definition* that stays true when someone later asks why
   the two predicates differ.
2. **The published filter lives in the predicate, not in the query.** A second query over
   `pm_digest` that forgets `publishedAt` would be an unreviewable disclosure. Putting it inside the
   predicate makes forgetting impossible.
3. **`.where('teamId', 'IN', ids)` — `IN` is a real ZQL operator** (`reference/zero.md` §9.3, RHS
   must be an array), and `IS NOT null` is the documented null comparison. No array-element
   filtering is involved, which ZQL does not have.

### D3 — the audience travels on `AuthContext`, resolved server-side, exactly as `role` does

`defineQuery` takes `({args, ctx})` and returns a ZQL query **synchronously**. It cannot read
Postgres, and the switches live in `connector_config.config`, which is not in the Zero schema. So the
entitlement has to arrive as data.

`AuthContext` gains one optional field:

```ts
readonly pmAudienceTeamIds?: readonly string[]
```

Optional so every existing construction site — including `SYSTEM_AUTH_CONTEXT` — compiles unchanged,
and so **a credential minted before this change denies** rather than throwing.

It is resolved in exactly the two places `role` already is:

- `apps/server/src/zero/context.ts` — `createSessionContextResolver` gains a
  `lookupPmAudience(userID)` alongside `lookupRole(userID)`. This is the **authoritative** copy: it
  is what `/query` evaluates against.
- `apps/server/src/auth-routes.ts` — the sync-credential response gains the same array, so the web
  client's `AuthContext` (built in `apps/web/src/zero/provider.tsx` from `{userID, role}`) can
  evaluate the query locally against its replica.

**Why the client copy is not a hole.** The client's context is advisory: it only decides what the
local replica renders, and the replica only ever contains rows the *server's* evaluation returned.
A client that forges `pmAudienceTeamIds` sees the same nothing a client that forges `role: 'admin'`
sees today. That equivalence is the argument, and the falsifiable check exercises the server path.

**Kill-switch latency, stated honestly.** The server resolves per `/query` request, so flipping the
kill switch stops new rows within one query refresh and zero-cache removes the rows the query no
longer returns. What it cannot do is un-read a digest a PM already read — which is precisely the
argument for D5.

`provider.tsx` already memoizes `context` on its values and documents a `refresh({fresh: true})`
path "for a caller that just changed what the server bakes into the credential". The admin policy
surface uses it.

### D4 — four switches, one resolver, one shape

`aiConfigDataSchema` (the `ai` `connector_config` row's `config` jsonb) gains:

```ts
pmDisclosure: z.object({
  enabled: z.boolean().default(false),          // workspace switch
  killed:  z.boolean().default(false),          // admin kill switch
  teams:   z.record(z.string(), z.object({      // keyed by team id
    pmVisible: z.boolean().default(false),
    audience:  z.array(z.string()).default([]), // workspace-member user ids
  })).default({}),
}).default({ enabled: false, killed: false, teams: {} })
```

A record rather than an ordered array, unlike `areas`: order is not semantic here, and a record makes
a per-team edit a merge instead of a wholesale replace (the `areas` decision does not transfer).

All four switches collapse into **one** server function,
`resolvePmAudienceTeamIds(db, userId): Promise<string[]>` (`packages/schema/src/db/pm-disclosure.ts`):
`[]` when the user is not a workspace member, when there is no `ai` config row, when `!enabled`, or
when `killed`; otherwise the sorted team ids where `pmVisible === true` and `audience` contains the
user. One predicate in ZQL, one resolver in SQL, and the switches have exactly one meaning each.

**Not `connector_installation.repo_mapping`**: typed `Record<string, string>` and read with
`repo_mapping ->> ${repoFullName}` at `db/connector.ts:386`. Growing its value shape breaks a live
SQL read.

### D5 — the publish gate, and what it can and cannot promise

`pm_digest.published_at` is null until a human sets it. Two shared mutators in
`packages/schema/src/zero/mutators.ts`:

- `pmDigest.publish({ id })` — requires `canWrite`, team access to the row's team, `status ===
  'ready'`, and `publishedAt === null`. Sets `publishedAt = now`.
- `pmDigest.unpublish({ id })` — same gate, sets `publishedAt = null`.

Neither mints an id, so the UUIDv7-at-the-call-site rule is satisfied trivially and rebase is a
no-op. The server overrides in `createServerMutators()` do the two things a client cannot: stamp
`audience_size_at_publish` from the resolved audience, and write the audit row. They reach raw
Kysely through the existing `(tx as ServerTransaction).dbTransaction.wrappedTransaction` seam, the
same one `claimIssueNumber` and the retro tally use.

**Publish authority is the producing team, not the admin who configured the audience.** The team owns
the work; the admin owns the policy. A workspace admin can still publish because `assertTeamAccess`
already grants them every team — that is the existing write model, not a new grant.

Honest limit, and the UI must say it: retraction stops further reads. It does not un-read. That is
the entire argument for making the gate default-on, and the reason the failure mode is stated in
copy rather than implied by a button label.

### D6 — the artifact reuses `digestContentSchema` verbatim

The PM content shape is **literally `DigestContent`** — `{headline, sections[{title,
items[{kind, summary, evidenceRefs[], confidence}]}]}`. The kinds (`shipped | carried | risk |
highlight`) and evidence kinds (`issue | pull_request | ci_check | deployment`) are already the right
vocabulary at PM altitude.

The alternative — a new PM content shape — would have forced `dropItemsDisclosingPaths` to be
generalized onto `AiArtifact` (it is currently typed to `DigestContent`), which means re-typing
injection-critical code for no behavioural gain. Reusing the shape reuses all three validators
**unchanged**, with zero refactor:

```
dropUncitedItems → dropItemsNamingMembers → dropItemsDisclosingPaths
```

What differs between the two artifacts is the **system prompt**, the **audience**, and the
**render** — not the shape. That is also what makes "the content is deliberately unremarkable"
literally true rather than a claim.

The stored blob extends it with yapm-authored fields the model never sees, exactly as change 21 did
with `areaCoverage`:

```ts
storedPmDigestContentSchema = digestContentSchema.extend({
  subject: z.object({ teamName, cycleName, startDate, endDate }),
  evidenceLabels: z.record(z.string(), z.string()),   // evidence id -> "ENG-142 · PR #331"
})
```

`evidenceLabels` is computed after generation from `facts.issues`, and the render reads only from it.
A model-invented id has already been dropped by `dropUncitedItems`, and an id with no label renders
as nothing rather than as a bare uuid.

### D7 — one job, one extra call, its own toggle

The PM run happens **inside the existing `CYCLE_DIGEST_QUEUE` worker**, immediately after the
internal digest, over the **same `CycleFacts` object already built** — no second fact read, no second
queue, no new container. It is skipped entirely when the team's `pmVisible` is off, so an unwanted
disclosure costs no model call and no tokens.

`AI_PM_DIGEST` (default `false`) is its own env toggle; see I1 below for why, and for the boot-time
dependency on `AI_DIGEST_ON_CYCLE_CLOSE`.

`getWorkspaceAiSpendUsd` gains a fourth arm for `pm_digest` — one more entry in the union, not a
second `sum('estimated_cost_usd')`, which `scripts/check-boundaries.mjs` rule 4 would fail.

### D8 — the sync schema carries only what is safe for both readers

One row, two audiences, no column projection ⇒ **every synced column must be safe for the PM.** Four
columns exist in Postgres and are excluded from the Zero schema:

| Column | Why it does not sync |
|---|---|
| `input_token`, `output_token` | run internals; the workspace total is the operator's number |
| `estimated_cost_usd` | needed by the spend accessor in SQL; a PM has no use for a team's spend |
| `published_by` | the one identity column on the row. Syncing it tells a PM which individual released it. Accountability belongs in the audit record, not in the disclosure |

`retro_ai_draft.claimed_at` and `team.ai_retired_spend_usd` set the precedent, and
`schema-drift.test.ts`'s `ZERO_OMITTED_COLUMNS` is where the asymmetry is asserted from both sides.
`ai_disclosure_audit` is omitted **as a whole table**, asserted the way `retro_card_author` is.

The rule to state in review: *a new column on `pm_digest` must be safe for a reader outside the
team, or it is server-only.*

### D9 — audit rows say that, not what

```
ai_disclosure_audit(
  id, workspace_id, team_id?, actor_id?, event, pm_digest_id?, detail jsonb, created_at
)
event ∈ {policy_changed, generated, published, unpublished}
```

`actor_id` is null for a generation (the system principal is not a `user` row). `detail` carries
yapm-computed metadata only — resulting audience size, which switch changed and its new value, the
run's terminal status. **Never content, never prose, never a summary.** An audit record that quotes
the disclosure is a second copy of the disclosure sitting outside the kill switch.

The CHECK text is exported once as `AI_DISCLOSURE_EVENT_CHECK` (a plain string, wrapped in
`sql.raw`), following `AI_ARTIFACT_STATUS_CHECK` — `context.ts` reaches the client bundle and must
not acquire a Kysely import.

No read surface ships here. Change 23 owns the view, the retention sweep, and the vocabulary.

### D10 — three surfaces, and one of them is absence

1. **`/digests` — the PM reader.** Route and navigation entry both gated on
   `pmAudienceTeamIds.length > 0`, read from the sync-session state the provider already exposes. When
   empty: no entry, no route, no empty state, **no `useQuery` call**. Renders the yapm-authored
   subject line, the headline, sections, items, and each item's baked plain-text evidence label, plus
   the "AI-generated · <model>" framing. No links from summarized content, no remote media.
2. **The producing team's cycle view** gains a "Shared with product" card beside the existing digest
   panel: the full PM-facing text, a **Publish** control, and after publish a "Shared with N readers
   outside this team" line and a **Retract** control whose copy states that retraction does not
   un-read.
3. **Admin AI settings** gains a PM-disclosure block: workspace switch, kill switch, and a per-team
   row with `pmVisible` and an audience picker over workspace members. Admin-only over the existing
   `ai/admin-routes.ts` surface, keyboard-first, theme tokens only.

All three are `pm-digest` capability scenarios; none of them touches the `cycle-digest` spec.

## Risks / Trade-offs

- **A second authorization axis is a second thing to keep true.** Mitigated by: the predicate's
  comment naming the drift; the falsifiable check asserting that the `teamScoped` queries still
  return zero rows for the same principal in the same test; the published filter living inside the
  predicate; and the no-relationship rule stated in the spec.
- **The client's advisory context.** Argued in D3. The equivalence with `role` is the whole defence,
  and the check exercises the server path, not the client's.
- **Human speed.** A digest sits unpublished until someone acts, which for a team that stops
  publishing means the feature quietly stops. Accepted: an unrecallable disclosure is worse than an
  unread one.
- **An injected PR title can still bias the narrative**, and a PR title can name an unreleased
  feature. Bounded and enumerable. The correct comparison is granting the PM a repository read.
- **Content thinness.** With change 21 shipped the model sees issue titles, PR titles, yapm-computed
  area labels, size bands and counts. That is genuinely more than titles, and it is still not a
  product spec. The proposal says so.

## Open Questions

None blocking. Two questions the maintainer explicitly delegated are answered in I1 and I2 below.
Two remain for a human and are named in the build plan rather than resolved here: whether a digest
built from this data is worth disclosing at all (read three real published digests), and whether the
"Shared with N readers" marker is enough transparency for the producing team.

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

### I1 — SCOPE §9 item 12: `AI_PM_DIGEST` is its own toggle, and it fails fast when it cannot run

**Decided at proposal time, because it changes the env schema and the scheduler shape.**

`AI_DIGEST_ON_CYCLE_CLOSE` reads generic but is wired to exactly one thing: whether the `digest`
block is attached to `cycles` in `apps/server/src/index.ts:182`. Reusing it for the PM run would mean
one variable controlling a team-internal artifact and a cross-boundary disclosure, which is exactly
the coupling `AI_RETRO_DRAFT` was created to avoid — its own comment says the two are "gated
separately because a team may want one and not the other and both spend on the same BYO key". That
argument is strictly stronger here: one of these two crosses a permission boundary.

So: **`AI_PM_DIGEST`, default `false`.** Not merely a second toggle — the *default* differs, and it
must, because `AI_DIGEST_ON_CYCLE_CLOSE` defaults to `true` and inheriting that default would have
turned disclosure generation on for every existing instance at upgrade.

The honest complication: the PM run reuses the internal run's `CycleFacts` inside the same job, so
`AI_PM_DIGEST=true` with `AI_DIGEST_ON_CYCLE_CLOSE=false` describes a job that is never registered.
Rather than silently doing nothing, this **fails at boot with both variable names**, via a
cross-field refinement on the env object — the `.env`-only, Zod-validated, fail-fast-by-name
convention. An operator who wants only the PM digest is asking for something this architecture does
not offer, and saying so at boot is cheaper than a support thread.

Note the layering: the env toggle is the *instance floor*, the workspace switch and per-team
`pmVisible` are the *workspace ceiling*, and the falsifiable "both switches off ⇒ nothing" check is
enforced by configuration alone, so it holds regardless of how the instance is configured.

### I3 — `pm_digest` declares ONE relationship after all, and the rule became narrower and enforceable

**Ambiguous:** D1 and task 2.1 say the row has *no relationships of any kind*. That turned out to be
incompatible with task 4.4, which requires the producing team to read the same row through
`teamScoped` — because `teamScoped` scopes by a **correlated `whereExists('team', …)`**, and ZQL
cannot correlate across a relationship the schema does not declare. Written with no relationships,
`pmDigestReview.byCycle` throws at query-build time (`Cannot read properties of undefined (reading
'team')`). The two halves of the design could not both be true.

**Chosen:** declare exactly one relationship, `team`, and replace the blanket rule with a narrower
one that is actually enforceable: **no query over `pm_digest` may call `.related(...)`**, asserted in
`queries.test.ts` over every PM query's AST, and `schema-drift.test.ts` asserts the relationship set
is exactly `['team']`.

**Why.** `whereExists` is a filter — it syncs no row — so the disclosure risk D1 named (a
`.related('cycle')` handing a reader a row their entitlement never covered) is untouched by its
existence. There is deliberately **no `cycle` relationship**, so the row a PM would most plausibly be
given by accident is not reachable at all. The alternatives were worse: a second axis on
`AuthContext` carrying the caller's team memberships duplicates the membership model in the
credential, and routing the review query through `cycle.related('pmDigest')` makes `pm_digest`
reachable *from* a cycle query, which is strictly more surface. Losing the review query was not an
option — it is the review half of the review-and-publish gate, which is maintainer decision 4.

### I4 — `published_by` and `actor_id` are `text` with no foreign key

**Ambiguous:** the build plan specifies `published_by → user(id) on delete set null` and
`actor_id → user(id) on delete set null`. Every other user-shaped column in this repo
(`issue.creator_id`, `attachment.uploader_id`, `retro.facilitator_id`, `notification.recipient_id`)
is `text` with **no** FK, and `0017_attachments` records why: `user` is better-auth's table, created
by ITS migrator at boot **after** the Kysely migrator runs, so a reference to it fails outright on a
fresh instance.

**Chosen:** `text`, no FK, matching the shipped convention. For `ai_disclosure_audit.actor_id` this
is better than the specified behaviour rather than merely equivalent: an audit record whose actor
silently became null when the account was deleted is a worse audit record.

### I5 — the run's token counts and cost are written through the raw seam, in the same transaction

**Ambiguous:** `input_token`, `output_token` and `estimated_cost_usd` are excluded from the Zero
schema (D8), so `tx.mutate.pm_digest` cannot write them — but `getWorkspaceAiSpendUsd` needs the cost
or the cap under-fires. The retro and cycle digests never hit this, because their equivalents *do*
sync.

**Chosen:** `upsertPmDigest` writes the synced columns through `tx.mutate` and then the three
server-only columns through `(tx as ServerTransaction).dbTransaction.wrappedTransaction`, **in the
same transaction**. A second, separate transaction was rejected: a crash between the two would drop
a cost that was really spent, which is precisely the silent cap under-fire `cycle-digest.ts` calls
out by name.

### I6 — `pmDigest.publish` and `.unpublish` are `destructive` in the agent tool registry

**Ambiguous:** `buildMutatorToolSpecs` throws for any mutator missing a classification, so the two
new mutators had to be classified. Nothing in the plan said which.

**Chosen:** both `destructive`. `publish` is the strongest case for that classification in the whole
map — it is the one write in the product that moves content across a permission boundary, and it
cannot be undone. `unpublish` is destructive too: it takes away an artifact people may be relying on
and clears the audience-size snapshot the producing team was shown. Neither is a step a
least-privilege agent run may take on its own.

### I7 — a CI-check evidence id inherits its pull request's label

**Ambiguous:** `buildPmEvidenceLabels` must produce a label per evidence id, and `CycleFacts` carries
`ci_check` refs with no label of their own. Left unlabelled they would render as nothing.

**Chosen:** a CI check inherits the label of the pull request it ran on (`ENG-142 · PR #331`), since
"the check on that PR" is the only thing about it a reader outside the team could act on. An issue
with no number still yields no label at all rather than a bare uuid — inventing one would be a
number the model did not get from yapm.

### I2 — SCOPE §9 item 14: the producing team reviews first, and then sees a count

**Decided at proposal time, because it is a schema field and a surface.**

The question SCOPE raises — *what does the producing team learn about what was disclosed about their
work?* — has a much better answer here than a notification, because the review-and-publish gate
(maintainer decision 4) already makes the team the first reader. So the answer is in three parts,
ordered by how much of the trust problem each solves:

1. **Nothing is disclosed that the team has not read.** The gate is not only a safety control; it is
   the transparency mechanism. A team cannot be surprised by a sentence they released themselves.
2. **After publication, a yapm-computed marker on the team's own cycle view**: *"Shared with N
   readers outside this team."* `N` is `pm_digest.audience_size_at_publish`, stamped server-side at
   publish and synced. It is a **snapshot**, not a live count — the honest reading of "how many
   people did we disclose this to", and it does not silently change when an admin later edits the
   list.
3. **No reader is ever named, and no read is ever logged.** A reader list on a team's cycle view is
   a per-person surface pointed at people outside the team, and a read log is worse. VISION #8 bans
   per-person *metrics*; the spirit here is broader, and a count satisfies the trust need without
   creating a surveillance surface. This is a deliberate refusal, not an omission.

What is deliberately *not* built: a notification to the team when their digest is published (they
published it), and a per-team disclosure history (change 23's audit view is the right home, and it
is admin-scoped).

### I8 — the route is registered for everybody; the audience gate lives inside it

**Ambiguous:** task 9.1 says the route "MUST NOT render when the sync-session audience is empty".
The literal reading is a route that only exists for named readers — but TanStack Router's route tree
is a static, generated module that every client downloads, so a conditionally-registered route would
put a permission fact into a table shipped to everyone, and its absence from that table would be
readable without ever calling the server. That is the permission oracle this change exists to avoid,
relocated into the bundle.

**Chosen:** `/digests` is registered unconditionally like every other route, behind `Authenticated`
like every other route, and the audience decides what the route COMPONENT renders. When the audience
is empty the component returns nothing: no shell, no heading, no empty state — and, the part that
matters, **no `useQuery` is constructed at all**, because the gate (`PmDigestsGate`) sits above the
view (`PmDigestView`) rather than inside it. The unit test asserts the query count is zero rather
than asserting the DOM is empty, since an empty DOM is compatible with a query that fired and
returned nothing, and those two are not the same disclosure.

The navigation entry reads the same `pmAudienceTeamIds` from the same sync-session state, so the
entry and the surface cannot disagree about whether the reader has anything to read.

### I9 — one narrative renderer, drawn by both audiences

**Ambiguous:** the reader surface and the producing team's review card render the same content, and
nothing in the plan says whether they share a component.

**Chosen:** they share `PmDigestNarrative`, and that is a correctness property rather than an economy.
"The team is the first reader" is only true if the team is shown the same text — a second render
could drift and nobody would notice, because the two surfaces are never on screen together and no
single person is likely to hold both entitlements. One component means there is no second render to
drift.

It is deliberately NOT the team-internal `digest-panel.tsx` renderer, which resolves evidence into
clickable issues and external links. That resolution is the thing a PM must not get.

### I10 — the review card renders nothing when there is no row, and no publish control off `ready`

**Ambiguous:** what the producing team's cycle view shows when the workspace or the team has
disclosure off.

**Chosen:** nothing at all. With the switches off no `pm_digest` row is ever written, so the query
returns nothing and the card is absent — the same absence a team gets before a cycle closes. A
placeholder saying "product sharing is off for this team" would be a per-cycle advertisement for a
setting that lives in one admin page, on a surface a team reads every cycle.

For a row that exists but has nothing to release (`pending`, `failed`, `ai_off`) the card says what
happened, and every one of those sentences ends "Nothing has left this team" — the only fact the
team needs to be certain of. No publish control is rendered; the mutator would reject it anyway, and
a control that exists to fail is worse than no control.

A `ready` published row also renders no publish control, only Retract, so the audience-size snapshot
the team is shown can never be silently overwritten by a second release.

### I11 — the admin block writes one team at a time, and re-mints the caller's own credential

**Ambiguous:** the audience picker edits a map; the plan does not say whether a write sends the whole
map or one team.

**Chosen:** one team per write — `{ teams: { [teamId]: { audience: [...] } } }` — matching the
server's merge semantics exactly. Sending the whole map would make editing one team's readers a
rewrite of every other team's, and two admins editing two different teams would silently clobber each
other. The unit test asserts the request body carries the edited team alone.

Two smaller calls fall out of that:

- **An optimistic draft over the fetched policy.** The block is REST-backed, so without it every
  click waits a round trip — which for a checkbox reads as a broken control. The draft is re-seeded
  from the server's answer on every reload, so a rejected write reverts to what is actually stored
  rather than to what was clicked.
- **`refresh()` after every successful write**, which is the provider's `remint({ fresh: true })`
  path. The audience is baked into the sync credential, so an admin who names themselves would
  otherwise see nothing change until a reload — and would reasonably conclude the setting did not
  work. This is the case the provider's own comment says that path exists for.

### I12 — the docs page ships, the Playwright spec does not

**Ambiguous only in sequencing.** Task 10.9's E2E is the one deliverable of this change that could
not be verified in this pass: it needs `docker compose` and a Playwright run, and this pass was
explicitly scoped to the fast gates because the open PR runs the full suite in CI.

**Chosen:** write the feature page and leave 10.9 unchecked and honestly reported rather than pushing
a spec that has never been executed. A blind E2E against a surface whose whole point is conditional
absence is more likely to redden CI than to prove anything, and a red suite costs the next reader
more than a missing test they were told about.

### I13 — the Playwright spec ships after all, and I12 is superseded

**I12 deferred task 10.9 on the grounds that a spec which has never run is worse than a missing
one. That reasoning was about a pass with no owner for it; this pass has one, so the trade is
different.** PROCESS.md §3's big-feature rule is met on four counts here rather than the two that
trigger it (a new synced entity, new mutators, a new permission surface, signature UI), and the two
properties that matter most are properties of the ASSEMBLED stack rather than of any module:

- **Default-off absence.** A unit test can assert a component returned `null`. Only a running client
  with a live sync connection can assert that the row never arrived — and "not rendered" and "not
  received" are different disclosures. `pm-digest.spec.ts` reads the client's own IndexedDB replica
  for that, on `retro-ai.spec.ts`'s precedent, and asserts the replica is non-empty first so the
  claim cannot pass by being vacuous.
- **The publish gate.** Generation, policy and release are three subsystems — a pg-boss job, an
  admin HTTP surface, and a Zero mutator with a server override. The gate is only real if it holds
  across all three at once, and nothing below e2e assembles all three.

**Chosen:** ship it, and say plainly that CI is its first execution. It is written to fail loudly
rather than flakily — every wait is on a state assertion with a timeout, never a sleep — and the
alternative (a shipped permission boundary whose default-off absence was never observed in a
browser) is the worse of the two risks now that the surfaces exist to point it at.

Two things it deliberately does not do: it does not generate (the model call needs a provider key no
e2e has, and `apps/server/src/ai/pm-digest.test.ts` covers what the model receives headless), and it
does not seed `published_at` — publication is the permission event this change exists to gate, so
causing one has to go through the shipped mutator.

Task **10.8**'s zero-cache half lives here too rather than in a fourth pg test: "both tables
replicate" is only observable from a client, and the spec asserts the asymmetry directly — the
reader's replica holds exactly one `pm_digest` row that reached it through zero-cache, and no
`ai_disclosure_audit` row anywhere in its bytes. The static half (the migration applies, the four
omitted columns exist in Postgres and not in the Zero schema, both CHECK texts) is already asserted
in `schema-drift.test.ts`.

### I14 — `main` moved under the branch, and the merge is resolved here rather than left for review

**Not anticipated by the specs.** While this change was being built, the sibling change 19
(`retro-ratification`) landed on `main` as `e467947`, and PR #22 went `CONFLICTING`: README, ROADMAP,
`migrations/index.ts`, `zero/ai-tools.ts` and `zero/mutators.ts` all grew additively on both sides.
A conflicted PR is one whose CI cannot run at all, so "the open PR runs the full suite" — the premise
every pass of this build has relied on — silently stops being true.

**Chosen:** merge `origin/main` into the feature branch and resolve the five conflicts here. Every
one of them is two additive edits to the same list (a migration registration, a mutator map entry, a
tool-registry entry, a feature row), so the resolution is "keep both, in the order the file already
implies" and nothing is arbitrated away. Migration numbering survives untouched: change 19 owns
`0020`, this change owns `0021`, and the registration order in `migrations/index.ts` is `0020` then
`0021`.

This is not `gh pr merge` and does not land anything: it is the feature branch catching up to its
base so that the review flow that owns the merge decision has a PR it can actually see CI for.

### I15 — what two CI runs taught the e2e spec, and the assertion that was about the wrong principal

Recorded because both corrections are about `readReplica`'s model rather than about the feature, and
the next person to write a replica assertion will otherwise learn them the same expensive way.

1. **A client that has only soft-navigated has not flushed to IndexedDB.** The first run failed on
   the spec's own non-vacuity guard, for a reader who had just signed up and never left the SPA. One
   hard reload plus a bounded poll fixes it; the guard stays, because an emptiness claim against an
   IndexedDB Zero has not written to is not a fact.
2. **Zero persists its replica as B-tree chunks, and the same row is lifted out of more than one of
   them.** Counting `rows` counts chunk copies. Every assertion here is on the DISTINCT set of
   `pm_digest` ids — `retro-ai.spec.ts` only ever asks `.some(...)`, which is why it never met this.
3. **"The row never reaches the client" was asserted of the wrong principal.** The first test's
   caller is a workspace ADMIN, who is on the producing team through `teamScoped`'s admin bypass —
   so their replica holds the row legitimately, through the team axis, the moment they open the
   cycle panel. The claim belongs to a reader outside the team, and the second test makes it there
   for a viewer with no membership at all. What the first test proves is the pair that is actually
   true for an admin with an empty audience: the PM surface does not exist for them, and the same
   row is fully readable on their own team surface.

None of the three was a defect in the change. The e2e is nonetheless the only place any of them
could have surfaced, which is I13's argument restated by events.
