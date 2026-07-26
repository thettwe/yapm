# mentions — implementation tasks

**Big-feature rule (PROCESS.md §3): all three tiers.** This change touches **4 of 4** of {synced
entity/schema, mutator, permission surface, signature UI}: a new synced `issue_subscription` table
with a forward-only migration and a Zero schema change; two new shared mutators plus server
overrides on six sites; a server-side eligibility predicate that decides who may be mentioned and a
self-scoped query with no admin bypass; and a mention typeahead inside the rich-text editor. The
threshold is ≥2, so E2E is required rather than reflexive — and it earns its place independently:
the `defaultPrevented` collision that destroys comment drafts is invisible to jsdom, so only a real
browser can assert that Escape closes the popup while the draft survives.

Groups are ordered so the app boots and runs after every one, and so nothing consumes an artifact
built in a later group. Groups 1–3 are prerequisites that stand alone; 4–9 build the whole
server-side feature and prove it with the falsifiable check *before* any UI exists; 10–12 build the
surface on top of a proven substrate.

## 1. Pre-flight — blocking, before a line of code

- [x] 1.1 **AI-substrate contamination check (scope §1.9, design D15).** Run
      `grep -rn "description\|\bbody\b"` over `packages/schema/src/zero/digest.ts`,
      `packages/schema/src/zero/cycle-facts.ts`, `packages/schema/src/db/cycle-facts.ts`,
      `packages/schema/src/zero/ai-tools.ts` and `apps/server/src/ai/*.ts`. Confirm no AI read path
      touches `issue.description` or `comment.body`. **If any does, that is a blocker resolved in
      this change, not a footnote** — record the finding and the resolution in design.md's
      "Decisions made during implementation".
- [x] 1.2 Confirm the seam this change binds to still exists as designed: `recordNotifications` is
      exported from `@yapm/schema/server`, `notification.kind` carries no CHECK constraint, and
      `ACTIONABLE_NOTIFICATION_KINDS` is a plain TypeScript set. If any has drifted, fix it in
      `notifications`' spec rather than inventing a second write path here.
- [x] 1.3 Re-verify the TipTap API against the **installed** `.d.ts` once group 2 lands (design D17
      was verified against the published tarballs): `MentionPluginKey` is not exported,
      `renderLabel` is deprecated, `MentionOptions.suggestions` is an array, `SuggestionProps.mount`
      and `exitSuggestion` exist. Do not write these from memory.

## 2. Dependencies: pin the whole TipTap graph together

- [x] 2.1 In `pnpm-workspace.yaml`, change `@tiptap/pm`, `@tiptap/react` and `@tiptap/starter-kit`
      from `^3.28.0` to **exactly `3.28.0`**, and add `@tiptap/extension-mention: 3.28.0`,
      `@tiptap/suggestion: 3.28.0` and `@floating-ui/dom: ^1.8.0`. The exact pins are load-bearing:
      the new packages' peer ranges on `@tiptap/core`/`@tiptap/pm` are exact, and a split resolution
      duplicates the ProseMirror `model` and fails at **runtime** with `RangeError: Adding different
      instances of a keyed plugin`, which typecheck cannot see.
- [x] 2.2 Add `@tiptap/extension-mention`, `@tiptap/suggestion` and `@floating-ui/dom` to
      `packages/ui/package.json` as `catalog:` references. `@floating-ui/dom` is an explicit
      dependency rather than a transitive hoist because `@tiptap/suggestion` peer-requires it.
- [x] 2.3 `pnpm install`, then confirm `node_modules/.pnpm` contains exactly one `@tiptap/core` and
      one `@tiptap/pm` instance.
- [x] 2.4 **Test**: `pnpm turbo lint typecheck test build` green, and the existing rich-text editor
      still works in the running app. This group lands on its own so a resolution regression is
      attributable to it and nothing else.

## 3. The keyboard-collision fix, on its own

- [x] 3.1 In `packages/ui/src/components/rich-text.tsx`, add `if (event.defaultPrevented) return`
      at the top of the wrapper `onKeyDown` (currently lines 120-129, which fire `onCancel` on
      Escape and `onSubmit` on Cmd/Ctrl+Enter unconditionally). Carry a comment stating the
      constraint the code cannot express: ProseMirror's `handleKeyDown` calls `preventDefault()` for
      a key an extension handled but does **not** stop React's synthetic bubbling.
- [x] 3.2 **Test**: extend `packages/ui/src/components/rich-text.test.ts` — a key event with
      `defaultPrevented` set fires neither `onCancel` nor `onSubmit`; an ordinary Escape and an
      ordinary Cmd+Enter still do.

## 4. Schema: the `issue_subscription` table

- [x] 4.1 Write `packages/schema/src/migrations/0014_mentions.ts`: create `issue_subscription` with
      `issue_id uuid not null references issue(id) on delete cascade`, `user_id text not null` (no
      FK — `user` is better-auth's table, matching `notification`),
      `team_id uuid not null references team(id) on delete cascade`,
      `state text not null default 'subscribed' check (state in ('subscribed','unsubscribed'))`,
      `created_at timestamptz not null default now()`, `updated_at timestamptz not null default
      now()`, and the **composite primary key `(issue_id, user_id)`**. No generated id column.
      Header comment must carry: why the natural key is the primary key (design D2), why `state`
      exists rather than row-existence (D3 — a `DELETE`-based unfollow reopens the mail trap), and
      why `state` **does** get a CHECK while `notification.kind` does not (closed value set, owned
      entirely by this change).
- [x] 4.2 Same migration: a partial index `(issue_id) where state = 'subscribed'` for the fan-out
      read, and `(team_id, user_id)` + `(user_id)` for the two membership cleanups.
- [x] 4.3 Register `0014_mentions` in `packages/schema/src/migrations/index.ts`.
- [x] 4.4 Extend the hand-written Kysely `DB` interface in `packages/schema/src/db/types.ts` with
      `IssueSubscriptionTable` (+ `IssueSubscription`/`NewIssueSubscription`/
      `IssueSubscriptionUpdate`); export from `packages/schema/src/db/index.ts`.
- [x] 4.5 Extend `packages/schema/src/db/schema-drift.test.ts`: add `issue_subscription` and assert
      the **two-column primary key in order** and the `state` check constraint.
- [x] 4.6 **Test**: `pnpm --filter @yapm/schema test` with `DATABASE_URL` set — migrations test and
      drift test green against live Postgres.

## 5. The pure document walkers

- [x] 5.1 Create `packages/schema/src/rich-text/plaintext.ts` with `richTextToPlainText(doc,
      options?)`, `extractMentionIds(doc)` and `sanitizeRichText(doc)`. Pure recursion over the
      document JSON, **no TipTap or ProseMirror import** — that is what keeps
      `scripts/check-boundaries.mjs` and CLAUDE.md #3 satisfied, and it is the reason the file has
      this shape. Expect a second consumer: `search` extends this file next.
- [x] 5.2 `richTextToPlainText` takes a `mentions` mode: `'label'` (default — `@` plus the resolved
      display name from a supplied name map, falling back to the stored label) and `'strip'`
      (mention nodes omitted entirely). Carry the design-D15 rule as a comment on the option: any
      caller feeding document text to a model MUST use `'strip'`.
- [x] 5.3 `extractMentionIds` returns ids in document order, deduplicated, `[]` for a document with
      no mention nodes — which is what makes every pre-existing document retroactively silent.
- [x] 5.4 `sanitizeRichText` normalises each mention node to `{id, label, mentionSuggestionChar}`,
      drops unknown attrs, trims and length-caps `label`, degrades a node with a missing/empty `id`
      to plain text, and **keeps** `mentionSuggestionChar` (design D10). Pure and deterministic —
      mints nothing.
- [x] 5.5 Export all three from `packages/schema/src/index.ts`.
- [x] 5.6 **Test**: `packages/schema/src/rich-text/plaintext.test.ts` — nested lists/blockquotes,
      duplicate mentions, a mention with no id, unknown attrs, an oversized label, `'strip'` vs
      `'label'`, a document with no mentions, and a malformed document that is not a `doc`.
- [x] 5.7 **Test**: `node scripts/check-boundaries.mjs` green.

## 6. Zero schema, the new kind, and the self-scoped query

- [x] 6.1 `packages/schema/src/zero/context.ts`: add `'mention'` to `NOTIFICATION_KINDS`, add it to
      `ACTIONABLE_NOTIFICATION_KINDS` (design D8 — this single line *is* the "mention emails once,
      subscription activity never does" rule), and add `SUBSCRIPTION_STATES` +
      `SubscriptionState`.
- [x] 6.2 `packages/schema/src/zero/notifications/copy.ts`: add the `mention` case —
      "*Actor* mentioned you in *ENG-42*". The `switch` is exhaustive over the union, so this will
      not typecheck until it is added, which is the intended forcing function.
- [x] 6.3 `packages/schema/src/zero/schema.ts`: add the `issue_subscription` table with
      `.primaryKey('issueId','userId')` and `.from()` column mappings; relationships to `issue` and
      `user`; register both in `createSchema`.
- [x] 6.4 `packages/schema/src/zero/queries.ts`: add `queries.subscriptions.mine({issueId})` —
      `isMember` gate, `denyAll` otherwise, `.where('issueId', args.issueId).where('userId',
      ctx.userID)`, `.one()`. **No `teamScoped`, no admin bypass**, modelled on `retroDrafts.mine`
      (`queries.ts:238`). Export `SUBSCRIPTIONS_MINE_QUERY_NAME`. Carry the design-D11 reason as a
      comment: scoping to one issue is what bounds the synced set with no `.limit()`, and the
      absence of any other query over this table is the non-surveillance property.
- [x] 6.5 **Test**: extend `packages/schema/src/zero/queries.test.ts` — the new query denies a
      non-member by empty query, filters on the verified `ctx.userID` and not on an argument, and an
      admin gets no other user's row. Extend `notifications/copy.test.ts` for the new case.

## 7. Shared mutators: the sanitizer, follow and unfollow

- [x] 7.1 Wire `sanitizeRichText` into the **shared** bodies of `issue.create`, `issue.update`,
      `comment.create` and `comment.edit` in `packages/schema/src/zero/mutators.ts`, so the
      optimistic and authoritative documents are identical and rebase never visibly rewrites the
      user's text. Safe inside a mutator body because it is a pure function of `args` and mints
      nothing.
- [x] 7.2 Add `followIssueArgs` / `unfollowIssueArgs` (`{issueId, updatedAt}`) and
      `issueSubscription.follow` / `.unfollow` shared mutators. **Gate on `canRead`/`isMember`, NOT
      `canWrite`** (design D18): `canWrite` excludes viewers (`context.ts:234`), and a viewer can be
      mentioned — eligibility is a read predicate — so gating on write would auto-subscribe viewers
      with no way out, which is precisely the mail trap this change exists to avoid. Then check the
      issue's team access (admin bypass included, the `assertTeamAccess` half of
      `loadIssueForWrite`) and upsert `{issueId, userId: ctx.userID, teamId: issue.teamId, state}`.
      **The user component comes from the verified context, never from args** — that is what makes a
      caller structurally unable to touch another person's subscription. Nothing is minted; the
      natural key is known at the call site.
- [x] 7.3 Register both under a `issueSubscription:` group in the exported `mutators` object.
- [x] 7.4 **Test**: extend `packages/schema/src/zero/mutators.test.ts` — **a viewer on the team can
      follow and unfollow**; a non-member is rejected without revealing the issue's existence; the
      `userId` written is `ctx.userID` even when args attempt to name someone else; the sanitizer
      runs on all four document write paths.

## 8. Server-authoritative: eligibility, the diff, and the fan-outs

- [x] 8.1 Create `packages/schema/src/zero/mentions/diff.ts` — pure: `addedMentionIds(previous,
      next, actorId)` returning the newly-added ids in document order, minus the actor, truncated to
      `NOTIFICATION_RECIPIENT_CAP`. Truncate from the **end** so the notified set is the one the
      author wrote first (design D9). Array-shaped in and out (H8 seam).
- [x] 8.2 Create `packages/schema/src/zero/mentions/eligibility.ts` —
      `eligibleMentionees(tx, teamId, candidateIds) → Promise<Set<string>>`: two bounded `tx.run`
      reads (`team_membership` for the team, `workspace_member` where role is admin), intersected
      with the candidate list. **Batched, not per-candidate** — N round trips inside the triggering
      transaction is exactly the lock-holding pattern the cap exists to prevent. Mirrors
      `teamScoped`/`assertTeamAccess` including the admin bypass; denies by omission, never by an
      error that distinguishes unknown from disallowed.
- [x] 8.3 Create `packages/schema/src/db/issue-subscription.ts` — **every** Kysely statement over
      the table in one file, mirroring `db/notification.ts`: `autoSubscribeMentioned(db, rows)`
      (one multi-row `insert … on conflict (issue_id,user_id) do nothing` — the do-nothing is the
      sticky-unsubscribe mechanism, comment it as such), `subscribersOfIssue(db, issueId, limit)`
      (`state='subscribed'`, `order by created_at asc`, capped),
      `deleteSubscriptionsForMember(db, userId)` and
      `deleteSubscriptionsForTeamMember(db, {userId, teamId})`.
- [x] 8.4 Re-export the write seam from `packages/schema/src/zero/server-mutators.ts` alongside
      `recordNotifications`, so `@yapm/schema/server` stays the one server entry point and Kysely
      never reaches the client bundle.
- [x] 8.5 Add a `fanOutMentions(tx, {issueId, actorId, eventKey, at, previousDoc, nextDoc})` helper
      in `server-mutators.ts`: diff → eligibility → `recordNotifications` with kind `'mention'` →
      `autoSubscribeMentioned` for the same survivors. All inside the existing transaction, behind
      the caller's `tx.location === 'server'` guard. **`NOTIFICATION_TRIGGERS` is not touched**
      (design D6).
- [x] 8.6 Wire the four mention trigger sites, each reading the previous document inside the same
      transaction with the `before` pattern `retro.setPhase` uses: `issue.create` (previous = empty;
      extend the existing override, after the number is claimed so `subject_key` reads `ENG-42`),
      **`issue.update` (new override)**, `comment.create` (extend the existing override), and
      **`comment.edit` (new override)**. Event keys per design D7: the comment id for a comment, the
      literal `'description'` for an issue description. `retro.convertActionToIssue` is **not** a
      trigger site — `retroActionDescription` builds its document from plain strings; verified, and
      worth a one-line comment so the next reader does not re-derive it.
- [x] 8.7 Add the subscriber fan-out to the `comment.create` override: `subscribersOfIssue` →
      `eligibleMentionees` (so a departed member stops receiving activity before cleanup runs) →
      `recordNotifications` with kind **`'issue_commented'`** and `eventKey: args.id`, i.e. the
      **same natural key** the involvement fan-out emits, so the primary key collapses the overlap
      to one row (design D5). Exclude the actor.
- [x] 8.8 Add subscription cleanup to the existing `member.remove` and `team.removeMember`
      overrides, beside the notification cleanup they already do.
- [x] 8.9 **Test**: unit coverage for `diff.ts` (added-only, actor dropped, cap truncation from the
      correct end, empty previous, identical docs) and for `eligibility.ts`'s pure parts.

## 9. The falsifiable check

- [ ] 9.1 Write `packages/schema/src/zero/mutators.mentions.pg.test.ts` exactly as design.md
      "How we will know this worked" specifies: team **T** {A, B, E}, non-member **C**, non-team
      admin **D**. Assert in order — (1) a comment mentioning B, C, D, A yields exactly two `mention`
      rows (B, D) and two `subscribed` rows; (2) an edit adding E yields exactly one new row;
      (3) re-saving the identical body yields zero; (4) B unfollows, then the mention is removed and
      re-added — B stays `unsubscribed`; (5) E comments — D is notified, B is not, and a subscriber
      who is also the assignee gets exactly one row; (6) the whole sequence under
      `tx.location === 'client'` writes nothing. `describe.skipIf(DATABASE_URL === undefined)`.
- [ ] 9.2 Add the agent-path assertion from design D15: a comment created through the agent tool
      path with a mention of an ineligible person produces no notification.
- [ ] 9.3 Add the description-path variant: `issue.update` adding a mention notifies once, and a
      second `issue.update` re-saving the same description notifies nobody.
- [ ] 9.4 **Test**: `pnpm --filter @yapm/schema test` with `DATABASE_URL` set — green. **The feature
      is now provably correct with no UI at all.**

## 10. `packages/ui`: the mention extension and the listbox

- [x] 10.1 Create `packages/ui/src/components/mention-list.tsx` — a bespoke listbox, **not** cmdk
      (its `Command.Input` steals focus and focus must stay in the editor). `role="listbox"` with
      `role="option"` children carrying stable ids, an active row, a disabled row with a stated
      reason, an empty state naming the query, and a polite live region announcing match count / the
      empty state / the disabled reason. Every colour, font, radius and spacing value from theme
      tokens; AA in all three presets, light and dark.
- [x] 10.2 Create `packages/ui/src/lib/mention-match.ts` — the deterministic matcher: case- and
      diacritic-insensitive, prefix ranked above substring, over display name and email local part,
      **team members ranked above admins-by-role**, stable alphabetical tiebreak, and ineligible
      workspace users surfaced as disabled entries with a reason (design D4/D14).
- [x] 10.3 Register the `mention` node in `richTextExtensions`
      (`packages/ui/src/components/rich-text.tsx:26`) so **both** `RichTextEditor` and
      `RichTextRenderer` parse and render it. Use `renderText` + `renderHTML` (**not** the
      deprecated `renderLabel`), a locally-created `new PluginKey('yapm-mention')` (**`MentionPluginKey`
      is not exported** by 3.28.0), and the array form `suggestions: [ … ]` with exactly one entry
      (the H8 seam).
- [x] 10.4 Neutralise the suggestion plugin in the read-only renderer with `allow: () => false` —
      `addProseMirrorPlugins` always instantiates at least one, so it cannot be switched off.
- [x] 10.5 Suggestion configuration: `items()` returns an **array, never a promise** (this is the
      whole sub-100ms story); explicit `allowedPrefixes` so `foo@bar.com` never opens the popup; an
      `allow` predicate rejecting `codeBlock` and inline `code`; managed mounting via
      `props.mount(element)` with `container` set to the **editor wrapper** — not a body portal,
      which would break both `POPUP_SELECTOR` (`apps/web/src/lib/keyboard.ts:17`) and the
      `aria-activedescendant` IDREF.
- [x] 10.6 The keyboard contract (design D13 table): ↑/↓ move, Home/End jump, Enter and Tab accept,
      Cmd/Ctrl+Enter accepts rather than submits, Escape dismisses **only** the popup via
      `exitSuggestion(view, MENTION_PLUGIN_KEY)`. The editor gains `aria-expanded`,
      `aria-controls`, `aria-activedescendant`.
- [x] 10.7 Add the data-agnostic `mentionables?: MentionCandidate[]` prop (`{id, name, email?,
      image?, eligible: boolean, reason?}`) to `RichTextEditor`. `packages/ui` stays ignorant of
      teams, queries and permissions.
- [x] 10.8 Render a mention chip as a **non-interactive** `<span>` with an accessible name, styled
      from tokens — no link, no tab stop (design D10). An unresolvable or ineligible id renders as
      inert plain `@Name`.
- [x] 10.9 **Test**: `packages/ui/src/lib/mention-match.test.ts` — diacritics, prefix-over-substring,
      email local part, team-before-admin ordering, stable tiebreak, ineligible entries.
- [x] 10.10 **Test**: a `mention-list` component test — arrow/Home/End movement, `aria-activedescendant`
      tracking the active option, a disabled option reachable but not insertable, the empty state.
- [x] 10.11 Ladle stories for `MentionList` and for `RichTextEditor` with mentionables, across all
      three presets in light and dark.

## 11. `apps/web`: wiring and the follow control

- [x] 11.1 In `apps/web/src/issues/issue-detail.tsx`, build `mentionables` from the `MemberOption[]`
      the surface **already** assembles for the assignee menu (line ~190) plus workspace admins from
      `queries.members.all`, marking each candidate eligible or not with its reason. No new query.
      Pass it to the description editor, the comment composer and the comment editor.
- [x] 11.2 Add the Follow / Following control to the detail meta column, reading
      `queries.subscriptions.mine({issueId})` and calling `issueSubscription.follow`/`.unfollow`.
      `aria-pressed`, keyboard-reachable, optimistic. When following, state that updates will arrive
      and how to stop — an auto-subscription must be reversible **from the thing that created it**.
- [x] 11.3 No follower count and no subscriber list anywhere, for anyone, admins included.
- [x] 11.4 **Test**: `apps/web` component tests — the control reflects the synced row, toggles
      optimistically, and is operable by keyboard alone.

## 12. E2E

- [ ] 12.1 Write `apps/web/e2e/mentions.spec.ts`: in the issue-detail comment box, type `@`, assert
      the listbox appears with `aria-activedescendant` set to an element **inside the editor
      wrapper**, press ↓ then Enter, assert a chip is inserted.
- [ ] 12.2 **The non-negotiable assertion**: type `@` again, press Escape, and assert the popup
      closed **while the comment draft text and the detail Sheet are both still open**. This is the
      `defaultPrevented` bug, it is a live defect on `main`, and jsdom cannot express it.
- [ ] 12.3 Assert the mentioned teammate's inbox shows one mention notification, and that the issue
      then shows them as following with a working unfollow.
- [ ] 12.4 **Test**: the e2e suite green against the real three-container stack.

## 13. Documentation

- [ ] 13.1 New `apps/docs/src/content/docs/features/mentions.md`: how to mention, that the list is
      the issue's team (and why an admin appears only on an explicit match), why a name can be
      unavailable and what the message means, that renames propagate, that being mentioned subscribes
      you, how to unfollow, and that unfollowing is permanent for that issue.
- [ ] 13.2 Add it to the Starlight sidebar in `apps/docs/astro.config.mjs` under Features.
- [ ] 13.3 Update `apps/docs/src/content/docs/features/notifications.md`: the new `mention` kind,
      that mentions are emailed at the default preference while subscription activity is not, and
      the auto-subscribe/unfollow rule.
- [ ] 13.4 Update `README.md` — the feature list gains mentions; "What's next" loses them.
- [ ] 13.5 Update `ROADMAP.md` — row 12's status, **and** its now-false "No tables, no columns, no
      migration" claim, which the H7 answer superseded.
- [ ] 13.6 Update `TECHSTACK.md` — the TipTap version baseline (all five packages pinned exactly at
      `3.28.0`) and the two new packages.
- [ ] 13.7 Update `openspec/SCOPE-v1-gaps.md` §0 and §2.2 in place: `mentions` takes `0014_mentions`
      and `search` moves to `0015_search`; the "no migration, no Zero schema change" conclusion is
      superseded by the maintainer's H7 answer. **Not optional** — two changes claiming `0014` is a
      collision at boot.
- [ ] 13.8 No new environment variables, so `.env.example` and the config reference are untouched —
      confirm rather than assume.
- [ ] 13.9 **Test**: `pnpm --filter @yapm/docs build` green.

## 14. Verification

- [ ] 14.1 `pnpm turbo lint typecheck test build` green.
- [ ] 14.2 `node scripts/check-boundaries.mjs` green — `packages/schema` still imports no editor
      package.
- [ ] 14.3 Integration suite green with `DATABASE_URL` set, including the drift test.
- [ ] 14.4 Compose smoke test green on the assigned ports; migration `0014` applies on a fresh
      volume.
- [ ] 14.5 Record the issue-detail chunk's size delta against the sub-100ms posture rather than
      assuming it is free.
- [ ] 14.6 Walk every scenario in `openspec/changes/mentions/specs/**` and confirm each is true.
- [ ] 14.7 Flag for a human (design.md "How we will know this worked"): whether the typeahead feels
      Linear-grade, whether the unavailable-name copy reads as helpful rather than accusatory, and
      whether auto-subscribe's volume is right in practice. None of the three is agent-checkable.
