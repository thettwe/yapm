## Why

`grep -rn mention apps packages` returns nothing. ROADMAP's locked v1 scope has said since day one
that notifications are "in-app inbox + email for **mentions**/assignments"; `notifications` (change
11) shipped the assignment half and left the word "mentions" unmet. Today the only way to pull a
teammate into a thread is to assign them the issue — which overwrites a real field to send a
message.

The previous change built the seam on purpose: `recordNotifications(db, events)` is exported from
`@yapm/schema/server`, `notification.kind` deliberately carries no Postgres CHECK, and
`ACTIONABLE_NOTIFICATION_KINDS` was written with the comment "a later `mention` kind gets email by
adding one entry here". This change collects on all three.

It serves VISION **#1 Speed is the feature** (the typeahead filters rows Zero has *already*
replicated to IndexedDB — `SuggestionOptions.items()` returns an array, never a promise, so no
common interaction newly waits on the network), **#2 Opinionated defaults, real escape hatches**
(being mentioned subscribes you to the thread, because that is what everyone means by it — and a
one-key unfollow is shipped in the same change, not promised in a later one),
**#4 Metrics for teams, never surveillance** (a mention is *addressing*: one person is told they
were named; there is no aggregate, no "who mentions whom", and — deliberately — no watcher list
readable by anyone, including admins), **#5 Free means free** (viewers are mentionable and
notified like everyone else), and **#10 Keyboard-first** (a typeahead inside a rich-text editor is
the hardest keyboard surface in the product, and this change also fixes a *verified, currently
shipping* bug where Escape inside the comment editor destroys the draft).

## What Changes

- **`@`-mentions in TipTap descriptions and comment bodies.** `@tiptap/extension-mention` and
  `@tiptap/suggestion` at **exactly `3.28.0`**, with a bespoke keyboard-first `MentionList` listbox
  in `packages/ui` (not cmdk — its `Command.Input` steals focus, and focus must stay in the
  editor). Stored as the extension's own node, `{type:'mention', attrs:{id,label,
  mentionSuggestionChar}}`, inside the **existing** `issue.description` / `comment.body` jsonb.
  **The `id` is authoritative and the name is always re-resolved from the live synced `user` row**,
  so a rename propagates and a hand-crafted `label` cannot spoof a colleague.

- **Eligibility is a permission fact, enforced server-side.** A mention of someone who cannot read
  the issue produces **no** event, no email and no inbox row — checked in the authoritative mutator
  pass against a predicate that mirrors `teamScoped` exactly, **including its workspace-admin
  bypass**, auth before existence, denying by returning false. *Candidacy* is split from
  *eligibility*: the typeahead offers **team members** by default, and a workspace admin who is not
  on the team surfaces only on an explicit name/email-prefix match, ranked last.

- **The UI says why a name is unavailable instead of silently doing nothing.** A workspace user who
  matches the query but cannot read the issue is shown as a reachable, `aria-disabled` row reading
  "Not on this team — can't be mentioned here". A mention that looks like it worked and didn't is
  the worst possible outcome for a communication feature. This reveals nothing new: `users.all`
  already syncs the entire `user` table, and `teams.all().related('members')` already syncs every
  membership, to every workspace member.

- **A mention auto-subscribes the mentioned person to that issue's later activity** — and therefore
  a **new durable `issue_subscription` entity**, forward-only migration `0014_mentions`, and a Zero
  schema change. This cannot be derived from `notification` rows: those carry
  `NOTIFICATION_RETENTION_DAYS` (30) retention, so a derived subscription would silently expire.
  Primary key `(issue_id, user_id)` — **the natural key is the primary key**, following
  `notification`'s precedent, so nothing is minted anywhere and CLAUDE.md #4 is never engaged.

- **Unsubscribe ships in the same change, and it is sticky.** The row carries a
  `state ∈ {subscribed, unsubscribed}` rather than existing-or-not, precisely so that an explicit
  unfollow survives the next mention: auto-subscribe is a single
  `insert … on conflict (issue_id,user_id) do nothing`, so it can create a subscription but can
  never resurrect one you turned off. Auto-subscribe with no exit is a mail trap; auto-subscribe
  whose exit is undone by the next `@` is a worse one.

- **Subscription activity is in-app only, by classification rather than by special case.** The new
  `mention` kind joins `ACTIONABLE_NOTIFICATION_KINDS` (email is for things addressed at you
  personally — the H1 rule `notifications` already encodes); subsequent activity reuses the
  existing **non-actionable** `issue_commented` kind, which the default `assigned_only` preference
  never emails. Being mentioned emails you once; the thread it subscribed you to does not.

- **Subscribers are fanned out through the public seam, not the private trigger map.**
  `NOTIFICATION_TRIGGERS` stays untouched. The subscriber set is handed to `recordNotifications`
  with kind `issue_commented` and the *same* natural key the involvement fan-out uses, so
  `on conflict do nothing` collapses a subscriber-who-is-also-involved into exactly one inbox row.
  The composite primary key is what makes two independent producers safe.

- **`packages/schema/src/rich-text/plaintext.ts`** — `richTextToPlainText`, `extractMentionIds` and
  `sanitizeRichText`, pure JSON recursion with **no TipTap import**, so
  `scripts/check-boundaries.mjs` and CLAUDE.md #3 hold. `search` extends this file next; it is
  built as a shared, tested unit with a second consumer expected.

- **The `defaultPrevented` fix — a real, currently shipping bug.**
  `packages/ui/src/components/rich-text.tsx:120-129` fires `onCancel` on Escape and `onSubmit` on
  Cmd/Ctrl+Enter **unconditionally**. ProseMirror's `handleKeyDown` calls `preventDefault()` when a
  suggestion handler returns true but does not stop React's synthetic bubbling, so without a
  `defaultPrevented` guard, dismissing the mention popup discards the whole comment draft and
  closes the detail Sheet. Fixed here, and asserted in E2E because jsdom cannot catch it.

- **A blocking AI-substrate pre-flight, already run.** This change is what first puts person names
  inside `issue.description` and `comment.body`, so it owns the verification that no AI data path
  reads those two fields — and writes the rule down so `search` and later AI changes inherit it.
  Result: clean; see design D15 for the commands and the finding.

## Capabilities

### New Capabilities

- `mentions`: the `mention` node and its id-authoritative storage; the shared sanitizer and the
  pure document walkers (`richTextToPlainText`, `extractMentionIds`); the keyboard-first typeahead
  and its candidacy ranking; server-side eligibility mirroring `teamScoped` with its admin bypass;
  the previous-vs-next mention diff and the event keys that make an edit notify once; inert
  rendering of an ineligible or unresolvable mention; and the rule that any future model-facing
  read of a rich-text document must strip mention nodes first.
- `issue-subscriptions`: the durable `issue_subscription` entity keyed on `(issue_id, user_id)`;
  auto-subscribe on an eligible mention; sticky unfollow; the keyboard-operable per-issue follow
  control; the server-only subscriber read (there is **no** synced watcher list, for anyone);
  delivery of subsequent activity as in-app notifications only; and what happens to a person's
  subscriptions when they leave a team or the workspace.

### Modified Capabilities

- `notifications`: a third kind, `mention`, actionable and therefore emailed under the default
  preference, with its own copy line; a second producer of `issue_commented` rows (the subscriber
  set) reaching the inbox through the public `recordNotifications` seam and deduplicated against
  the involvement fan-out by the table's composite primary key. *(Its base spec is still in-flight
  in `openspec/changes/notifications`; this delta only adds requirements.)*
- `local-first-sync`: `issue_subscription` replicates under a **self-scoped, issue-scoped** synced
  query filtered on the verified `ctx.userID` with **no workspace-admin bypass** — the
  `retroDrafts.mine` shape — so the query returns at most one row and no watcher list exists to
  sync; the drift test covers the new table and its compound primary key.
- `issue-detail`: the description editor and the comment composer/editor gain the mention
  typeahead; the detail surface gains a keyboard-operable Follow / Following control that states
  why you are following.
- `component-library`: `RichTextEditor` gains a data-agnostic `mentionables` prop and the mention
  typeahead listbox, with a layered Escape contract (the popup consumes Escape; the editor's
  cancel/submit shortcuts skip an already-handled event).
- `teams`: removing a team member (or a member leaving) deletes that person's issue subscriptions
  for that team, leaving other teams' untouched — the same distinction `notifications` draws.
- `workspace-membership`: removing a workspace member deletes every issue subscription they hold.

## Impact

- **Schema** (`packages/schema`): forward-only migration **`0014_mentions`** — `issue_subscription`
  with the composite primary key `(issue_id, user_id)`, a CHECK-constrained `state`, a denormalised
  `team_id`, and indexes for the subscriber read and the two membership cleanups; the hand-written
  Kysely `DB` interface and the hand-written Zero schema extended in lockstep, and the drift test
  with them. New `rich-text/plaintext.ts` (pure, no TipTap). New `db/issue-subscription.ts` (every
  Kysely statement over the table in one file, mirroring `db/notification.ts`). New
  `zero/mentions/` — `eligibility.ts` and `diff.ts`, pure. `NOTIFICATION_KINDS` gains `'mention'`
  and `ACTIONABLE_NOTIFICATION_KINDS` gains one entry; `notificationCopy` gains one case.
  `queries.subscriptions.mine({issueId})`. Shared `issueSubscription.follow`/`unfollow` mutators
  and the sanitizer wired into `issue.create`/`issue.update`/`comment.create`/`comment.edit`.
  Server-mutator overrides on those same four sites plus the two membership-removal sites.
- **Web** (`apps/web`): `mentionables` supplied to every `RichTextEditor` on the issue detail from
  the member list it already builds for the assignee menu; the Follow control; nothing else.
- **UI** (`packages/ui`): the `mention` node registered in `richTextExtensions` so **both**
  `RichTextEditor` and `RichTextRenderer` round-trip mention nodes; `MentionList`; the deterministic
  matcher; the `defaultPrevented` fix; Ladle stories across all three presets, light and dark.
- **Dependencies**: `@tiptap/extension-mention` and `@tiptap/suggestion` at **exactly `3.28.0`**
  (their peer ranges on `@tiptap/core` and `@tiptap/pm` are exact, not caret), plus
  `@floating-ui/dom` which `@tiptap/suggestion` peer-requires. The three existing TipTap catalog
  entries move from `^3.28.0` to `3.28.0` in the same commit — **pinning the whole TipTap graph
  together is load-bearing, not hygiene**: a split resolution duplicates the ProseMirror `model`
  instance and fails at *runtime* with `RangeError: Adding different instances of a keyed plugin`,
  which typecheck cannot see. All via the pnpm catalog, never a direct version.
- **Docs**: a user-facing **Mentions** page
  (`apps/docs/src/content/docs/features/mentions.md`) added to the Starlight sidebar, and edits to
  the existing `features/notifications.md` (the new kind, the auto-subscribe rule, how to unfollow,
  and that subscription activity is never emailed). `pnpm --filter @yapm/docs build` passes.
  **Root docs**: `README.md` (feature list + "What's next"), `ROADMAP.md` (row 12's status **and**
  its now-false "No tables, no columns, no migration" claim), `TECHSTACK.md` (the TipTap version
  baseline and the two new packages), and `openspec/SCOPE-v1-gaps.md` §0/§2.2 — which reserved
  `0014` for `search` and asserted this change needs no migration; both are superseded by the
  maintainer's H7 answer and must be corrected in place or `search` will collide on the migration
  number. No new environment variables, so `.env.example` and the config reference are untouched.
- **Docs:** `apps/docs/src/content/docs/features/mentions.md` (new),
  `apps/docs/src/content/docs/features/notifications.md` (modified), `apps/docs/astro.config.mjs`
  (sidebar), `README.md`, `ROADMAP.md`, `TECHSTACK.md`, `openspec/SCOPE-v1-gaps.md`.

## Non-goals

- **Group mentions — `@team`, `@here`.** None of it ships. The seam stays: `MentionOptions` in
  3.28 takes `suggestions: Array<…>` and the recipient path is array-shaped end to end, so one
  trigger fanning out to many recipients is a later addition rather than a rewrite.
- **`#123` issue mentions, backlinks, label or project triggers.** Exactly one trigger char ships.
- **Mentions in issue titles, retro cards, or project descriptions** — those are plain-text
  `string()` columns and a different change. (`retro.convertActionToIssue` builds its description
  from plain strings via `retroActionDescription`, so it is a mention-free create path; verified,
  not assumed, and it is therefore not a trigger site.)
- **Assignment auto-subscribe.** H7 is about mentions. Assignment already notifies the assignee.
- **Any watcher list, follower count, or "who is following this issue" surface** — for anybody,
  admins included. The subscriber set is read server-side, inside the fan-out, and never syncs. A
  mention is a message, not a measurement.
- **"Issues that mention me" as a filter or list.** The inbox is `notifications`' surface;
  duplicating it creates a second source of truth for something derivable from the document.
- **Un-mention on delete.** Removing a mention from a saved document retracts nothing — sent is
  sent — and re-adding it does not re-notify.
- **No "invite this person to the team" from the popup.** Mentioning someone never grants access.
- **No hovercard, no user-profile route, no focusable mention chip.** With no profile route in v1
  there is nowhere to go, and a link would inject tab stops into the middle of prose.
- **No per-mention preference and no new `user_preference` column** — `notifications` owns that
  column and this change adds none.
- **No autocomplete over deactivated accounts or bots**, no Yjs interaction, no per-document
  mention ceiling (the recipient cap is the storm guard; a document ceiling would reject a
  legitimate save), and no new pg-boss queue or scheduler instance.
