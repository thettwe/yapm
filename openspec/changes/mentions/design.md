## Context

`notifications` (change 11, `6da1ae4`) built this change's foundation deliberately: a public write
seam, a `kind` column with no Postgres CHECK, and an `ACTIONABLE_NOTIFICATION_KINDS` set whose
comment names `mention` by name. The scoping pass in
[`openspec/SCOPE-v1-gaps.md`](../../SCOPE-v1-gaps.md) §1.1/§1.2/§1.9 and §2.2 resolved the seams
between the three v1 gaps and flagged three product calls (H6, H7, H8) for the maintainer.

**The maintainer answered H7 "yes", and that supersedes the scope's headline conclusion.** The
scope said `mentions` "ships **no migration and no Zero schema change at all**" and reserved
migration `0014` for `search`. Auto-subscribe makes both false: a durable subscription is a new
table. The cost is re-derived here from scratch rather than inherited.

What already exists and is reused rather than reinvented:

| Existing thing | Where | How this change uses it |
|---|---|---|
| `recordNotifications(db, events)` | `db/notification.ts`, re-exported from `@yapm/schema/server` | The **only** write path this change uses for the inbox. `NOTIFICATION_TRIGGERS` stays private and untouched (D6) |
| The composite-PK idempotency `(recipient_id, kind, subject_id, event_key)` | `0013_notifications.ts` | Makes an edit notify once (D7) **and** makes two independent producers of one kind safe (D5) |
| `NOTIFICATION_RECIPIENT_CAP = 50` and its reasoning | `zero/notifications/recipients.ts` | The subscriber fan-out rides the same transaction and is bound by the same constant (D9) |
| The write-time membership intersection in `fanOut` | `server-mutators.ts:296-301` | The eligibility check is the same shape, widened by the admin bypass (D4) |
| `ACTIONABLE_NOTIFICATION_KINDS` + `isActionableNotification` | `zero/context.ts:178` | `mention` joins the set; `issue_commented` stays out of it, which *is* the in-app-only rule (D8) |
| A self-scoped query with **no** admin bypass, taking an argument | `queries.retroDrafts.mine({retroId})` | The exact shape `subscriptions.mine({issueId})` copies (D11) |
| `before`-read-then-`tx.location` guard | `retro.setPhase`, `retro.convertActionToIssue` | How every mention override reads the previous document inside the same transaction (D7) |
| `db/notification.ts` — every Kysely statement over one table in one file | same | `db/issue-subscription.ts` mirrors it exactly |
| `MemberOption[]` built for the assignee menu | `apps/web/src/issues/issue-detail.tsx:190` | Becomes the `mentionables` prop with no second query |
| `POPUP_SELECTOR` already matching `[role="listbox"]` | `apps/web/src/lib/keyboard.ts:17` | The popup mounts *inside* the editor wrapper so this works and `aria-activedescendant` is legal (D13) |

## Goals / Non-Goals

**Goals**

1. Naming a teammate in a description or a comment tells them, once, without the author thinking
   about it — and without the interaction waiting on the network.
2. Mentioning someone who cannot read the issue is **not possible**, enforced server-side; and when
   the UI cannot offer a name, it says why.
3. Being mentioned subscribes you to the thread, and **one keystroke gets you out and keeps you
   out**.
4. Editing a document to add a mention notifies once; re-saving it notifies nobody. Provably, under
   rebase.
5. The names this change puts into rich-text documents never reach a model.
6. Still three containers, still sub-100ms, still nothing aggregatable across people.

**Non-Goals** — see the proposal. Two are worth repeating because they shape the code: **there is
no watcher list anywhere**, for anyone, which is why the subscriber set is a server-only Kysely
read; and **no group mentions ship**, but every recipient path is array-shaped so one trigger can
fan out to many later.

## Decisions

### D1 — A durable `issue_subscription` table, because a derived one silently expires

The obvious cheap answer is "you are subscribed to issue X if you have a notification row for X".
It is wrong, and wrong in the quietest possible way: `notification` rows are swept at
`NOTIFICATION_RETENTION_DAYS` (default 30, `apps/server/src/index.ts:179`). A subscription derived
from them would work perfectly for a month and then stop, per-issue, with no error and no log line.
A subscription is a *standing intent*; a notification is a *record of an event*. Different
lifetimes, different tables.

Alternatives rejected:

- **A `user_preference` column.** Subscriptions are per-issue, not per-user; and §1.8 of the scope
  reserves that column set to `notifications`.
- **A `subscribed_at` column on `issue`.** Many-to-one; it is an edge, not an attribute.
- **A jsonb array of user ids on `issue`.** Every subscribe is a read-modify-write on the issue row
  under READ COMMITTED, which loses updates when two people are mentioned concurrently — the exact
  bug `retroVote.cast` had to lock a row to avoid.

### D2 — The natural key is the primary key: `(issue_id, user_id)`

No generated `id` column, nothing minted at a call site or inside a mutator body. This follows
`notification`'s D1 precedent for the same reason: **CLAUDE.md #4 is then not engaged at all**
rather than argued around, `on conflict do nothing` is answered by the primary-key index itself with
no separate unique constraint to drift, and a mutator re-run during rebase addresses exactly the
same row.

The cost is that `issueSubscription.follow`/`unfollow` address a row by two columns instead of one —
and one of those two is `ctx.userID`, taken from the verified context and never from args, so a
caller is **structurally** unable to name somebody else's subscription. That is a benefit, not a
cost: with a surrogate id, self-scoping would be a `where` clause somebody could forget.

Zero supports compound primary keys (`reference/zero.md` §3.1/§3.3); this repo already has four
(`issue_label`, `issue_link`, `retro_presence`, `notification`).

### D3 — `state`, not row-existence. This is the whole anti-mail-trap mechanism.

`state text not null check (state in ('subscribed','unsubscribed'))`.

If unfollow were a `DELETE`, the next `@` would re-subscribe you, and the loop is worse than never
having offered an unfollow at all — the user did the documented thing and it didn't hold. With a
state column, auto-subscribe is exactly:

```
insert into issue_subscription (…) values (…) on conflict (issue_id, user_id) do nothing
```

One statement. It **creates** a subscription and can **never resurrect** one you turned off, because
the conflict target is the primary key and the existing `unsubscribed` row wins. It is also
idempotent under rebase for free, and it needs no read-before-write inside the transaction.

An explicit `follow` after an `unfollow` is an ordinary upsert to `subscribed` — the user asking is
different from the system assuming.

`state` **does** carry a Postgres CHECK, and that is the deliberate other half of `notifications`'
D2 contrast: `notification.kind` has none because a later change must be able to add a kind for the
price of a union member, while this value set is closed and owned entirely by this change. Same
house, two answers, both argued.

### D4 — Eligibility mirrors `teamScoped`, admin bypass included; candidacy does not

Two different questions, deliberately given two different answers (the scope's §2.2 amendment,
which the maintainer's H6 answer keeps).

**Eligibility** (server-side, authoritative, in `zero/mentions/eligibility.ts`): a user may be
mentioned on an issue iff they are a **workspace admin** *or* a **member of the issue's team** —
the exact disjunction `teamScoped` (`queries.ts:20-31`) and `assertTeamAccess`
(`mutators.ts:148-158`) implement. Checked auth-before-existence, denying by omission from the
returned set, never by an error that distinguishes "no such user" from "not allowed". Implemented
as one **batched** predicate — `eligibleMentionees(tx, teamId, candidateIds) → Set<string>`, two
bounded `tx.run` reads (`team_membership` for the team, `workspace_member` where role is admin),
intersected with the already-capped candidate list. Not `canUserReadIssue` called N times: N round
trips inside the triggering transaction is exactly the lock-holding pattern
`NOTIFICATION_RECIPIENT_CAP` exists to prevent.

**Candidacy** (client-side, in `packages/ui`): the typeahead offers **team members** by default. A
workspace admin who is not on the team appears **only** when the typed query prefix-matches their
name or email local-part, and **ranks last**. This separates a permission question from a UI
question — the admin genuinely can read the issue, so hiding them from eligibility would be a lie —
while keeping a team's `@` list from quietly listing every admin in the workspace.

Rejected: enforcing eligibility only in the UI. The document is user-controlled JSON; a paste, a
stale client, or an API call would sail straight past it.

### D5 — Subscription activity reuses `issue_commented`; the composite PK is why that is safe

Subsequent activity on a followed issue means: **a new comment**. (Assignment already notifies its
assignee directly; status changes notify nobody, per `notifications`' non-goals; a mention notifies
the mentioned person directly.)

The subscriber set is handed to `recordNotifications` with `kind: 'issue_commented'`,
`subjectId: issueId`, `eventKey: comment.id` — **byte-identical natural keys** to the ones the
involvement fan-out produces for the same comment. Two independent producers, one row: the second
insert is absorbed by the primary key. A subscriber who is also the assignee gets exactly one inbox
row, not two.

This is why the subscriber emission does not need to live in `NOTIFICATION_TRIGGERS` (D6), and it is
the single strongest argument for `notifications`' natural-key-as-PK decision paying rent.

Rejected: **a new `issue_activity` kind.** It would need its own copy line, and — fatally — a
different `kind` means a different primary key, so a subscriber who is also involved would get two
inbox rows for one comment. The dedupe is only free if the kind is shared.

### D6 — `NOTIFICATION_TRIGGERS` is not touched

Both this change's emissions (the `mention` kind, and the subscriber `issue_commented` rows) go
through the exported `recordNotifications`. The private trigger map computes recipients from
*subject involvement*; a mention's recipients are a **document diff** and a subscriber's are a
**stored edge**. Neither fits, and forcing them through buys nothing but coupling. This is what the
scope's §1.1 public/private line was for; collecting on it is the test that the line was drawn in
the right place.

### D7 — `event_key` is stable across edits. This is the crux of the change.

The mention-specific instance of the rebase hazard: *editing a comment to add a mention must notify
once, and re-saving it must not notify again.*

| Trigger | `subject_id` | `event_key` |
|---|---|---|
| `comment.create` / `comment.edit` | the **issue** id | the **comment** id (`args.id`) |
| `issue.create` / `issue.update` | the issue id | the literal `'description'` |

Combined with the previous-vs-next diff, this gives **exactly one `mention` notification per
(person, comment)** and **per (person, issue description)**, forever:

- Create a comment mentioning B → diff `{B}` → one row.
- Edit it, adding C → diff `{C}` (B is in `previous`) → one row for C, nothing for B.
- Re-save the identical body → diff `∅` → nothing. Zero statements executed.
- Remove B's mention, save, re-add it, save → diff says `{B}` on the re-add, but the natural key is
  unchanged, so `on conflict do nothing` absorbs it. This is the "sent is sent" non-goal, enforced
  by the schema rather than by a rule someone has to remember.
- The mutator re-runs during rebase → the whole branch is behind `tx.location === 'server'`, and
  even if it were not, every key component is deterministic in the mutation's own args.

**Why `'description'` and not `String(args.updatedAt)`.** `updatedAt` changes on every save, so an
edit that removed and re-added a mention *would* notify again — the exact behaviour this
requirement forbids. A constant sentinel makes the description a single lifetime "event" per
person. It cannot collide with a comment id: comment ids are UUIDv7 and `'description'` is not a
UUID, and `subject_id` is the issue in both cases, so the two key spaces are disjoint by shape.

The trade-off, stated plainly: if A mentions B in a description, B reads it, A deletes the mention,
and six months later A mentions B there again, **B is not told a second time**. Accepted. It is the
same trade `notifications` made for a re-applied assignment, and the alternative — a per-edit key —
turns one noisy editor into a notification storm.

### D8 — In-app only, derived rather than asserted

The maintainer's rule is that being mentioned emails you once and the activity it subscribed you to
does not. That is not a new mechanism; it is `notifications`' H1 classification, applied:

- `'mention'` **joins** `ACTIONABLE_NOTIFICATION_KINDS` — it is addressed at a person.
- `'issue_commented'` **stays out of it** — it is ambient.
- The default preference is `assigned_only`, whose SQL predicate
  (`pendingNotificationEmails`, `db/notification.ts`) emails only actionable kinds.

So a subscriber at the default preference receives the thread in-app and nothing in their mailbox,
with no special case anywhere in the delivery sweep.

**The one residual case, stated honestly:** a user who has explicitly set `email_notifications`
to `'all'` *will* be emailed for subscription activity, because `'all'` is that person asking to be
emailed about every row that reaches their inbox. Making it literally never would require either a
fourth preference value or a fourth kind, and the fourth kind is D5's rejected alternative
(duplicate inbox rows). Neither is worth it to override an explicit user choice.

Two email-side consequences that do ship: `notificationCopy` gains a `mention` case
("*Actor* mentioned you in *ENG-42*"), and the mention email carries **one sentence** saying you now
follow the issue and can unfollow from the issue page. No signed unsubscribe link and no
`List-Unsubscribe` header — that remains `notifications`' non-goal and the link goes to the app.

### D9 — Both fan-outs are bounded by `NOTIFICATION_RECIPIENT_CAP`, and here is what happens at it

The cap exists because the fan-out runs **inside the triggering mutation's Postgres transaction**;
an unbounded one turns a one-row update into a long, lock-holding transaction. Both of this
change's producers inherit that reasoning unchanged.

- **Mention recipients**: the *newly added* mention ids, in document order, truncated to the cap.
  Past the cap the excess are simply not notified — **no error, no partial rollback, and the
  document still saves with every mention node intact and rendering normally**. Truncating from the
  end (rather than the front) keeps the notified set the one the author wrote first, which is the
  only ordering with a defensible story.
- **Subscribers**: read `where issue_id = ? and state = 'subscribed' order by created_at asc limit
  50` — longest-following first — and then passed through the *same* eligibility predicate as a
  fresh mention, so someone who left the team stops receiving activity even in the window before the
  membership-removal cleanup runs.

In practice the cap is unreachable: a subscriber must have been eligible, so the set is bounded by
team size plus workspace admins, and yapm's stated audience is 2–20 people. It is specified anyway,
because "unreachable in practice" is how an unbounded transaction ships.

**No per-document mention ceiling** (the scope's open question). The recipient cap is already the
storm guard; a document ceiling would reject a legitimate save, which is a worse failure than a
silent 51st non-notification.

### D10 — `sanitizeRichText` runs in the **shared** mutator, so client and server agree

Mention nodes in the stored document are normalised to `{type:'mention', attrs:{id, label,
mentionSuggestionChar}}`: `id` must be a non-empty string or the node degrades to plain text
`@label`; `label` is trimmed and length-capped; every other attribute is dropped. Applied in
`issue.create`, `issue.update`, `comment.create`, `comment.edit` — in the *shared* mutator body, not
a server override, so the optimistic document and the authoritative document are the same document
and rebase does not visibly rewrite the user's text.

It is safe inside a mutator body because it is a **pure, deterministic function of `args`** — it
mints nothing (CLAUDE.md #4 is about generated identity, and this generates none).

`mentionSuggestionChar` is **kept**, not stripped: it costs a handful of bytes and it is what lets a
future second trigger (H8's `#`) round-trip documents written today.

**The `label` is never trusted at render.** Nothing stops a crafted document storing
`{id: <attacker>, label: 'Alice'}`, so `RichTextRenderer` resolves the display name from the live
synced `user` row by `id` on every render, and falls back to inert plain text when the id resolves
to nobody. Storing a display string instead of an id would rot on the first rename *and* make this
spoof unfixable.

### D11 — `subscriptions.mine({issueId})` returns at most one row, and there is no other query

Self-scoped on the verified `ctx.userID`, `isMember`-gated, `denyAll` otherwise, **no
workspace-admin bypass** — the `retroDrafts.mine` shape (`queries.ts:238`), not `teamScoped`.

Scoping it to one issue rather than shipping a `mine` list is what makes the sync set trivially
bounded (exactly one row for the open issue) with no `.limit()` and no retention story, and it
means the *only* way to learn who follows an issue is a server-side Kysely read inside the fan-out.
**There is no synced watcher list and no follower count for anybody, admins included** — that is
the non-surveillance property of this change expressed as an absence of code rather than as a
policy.

Rejected: an unbounded `subscriptions.mine`. It would grow forever (the thing `notifications`'
`.limit()` + retention sweep exists to prevent), and a truncated list would render an old
subscription as "not following" and hide its unfollow control — the mail trap again, by accident.

### D12 — Non-surveillance argument (scope §3.3, required)

A mention is **addressing**: exactly one person is told they were named by exactly one other
person, in a document both of them can already read. This change adds no aggregate and no count: no
"mentions received" figure, no "who mentions whom" edge anyone can query, no per-person activity
row, no watcher list, and no surface visible to anyone but the recipient. `notification` rows remain
readable only by their recipient with no admin bypass, and `issue_subscription` rows join them under
the same rule. Constraint #8 forbids scorecards; it does not forbid telling a person they were
spoken to.

### D13 — The keyboard contract, and the bug it exposes

**The collision is real and currently shipping.** `packages/ui/src/components/rich-text.tsx:120-129`
fires `onCancel` on Escape and `onSubmit` on Cmd/Ctrl+Enter with no `defaultPrevented` check. (The
mission brief cites `apps/web/src/issues/rich-text.tsx`; that file does not exist — the editor lives
in `packages/ui`. Same lines, same bug.) ProseMirror's `handleKeyDown` calls `preventDefault()` when
a suggestion `onKeyDown` returns `true`, but does **not** stop React's synthetic bubbling, so
without the guard Escape-to-dismiss-the-popup also runs `onCancel` — discarding the comment draft
and closing the detail Sheet.

The fix is one line at the top of the handler (`if (event.defaultPrevented) return`) and it is a
general improvement: any future extension that claims a key stops fighting the wrapper.

The layered contract, innermost first:

| Key | Popup open | Popup closed |
|---|---|---|
| ↑ / ↓ | move active option, `preventDefault` | editor caret |
| Home / End | first / last option | editor line start/end |
| Enter, Tab | accept the active option | Tab leaves the editor; Enter is a paragraph |
| Cmd/Ctrl+Enter | accept the active option | `onSubmit` |
| Escape | dismiss the popup **only** | `onCancel` |

Escape dismissal uses `exitSuggestion(view, MENTION_PLUGIN_KEY)` — verified present in
`@tiptap/suggestion@3.28.0`'s `.d.ts`, documented as "the safe, recommended API to remove suggestion
decorations without touching the document or causing mapping errors". Better than the manual
transaction every pre-3.28 example shows.

**ARIA.** The editor element carries `aria-expanded`, `aria-controls` and `aria-activedescendant`;
the popup is `role="listbox"` with `role="option"` children carrying stable ids; a polite live
region announces the match count, the empty state, and the reason a matched name is unavailable.
The popup is mounted with suggestion 3.28's managed `props.mount(element)` and `container` set to
the **editor wrapper**, not a `document.body` portal — that is load-bearing twice over: it keeps a
`[role="listbox"]` in `POPUP_SELECTOR`'s ancestor chain (`apps/web/src/lib/keyboard.ts:17`) so
view-level single-letter shortcuts stand down, and it makes `aria-activedescendant` a legal
same-subtree IDREF. A body portal breaks both, and looks perfect to a sighted developer.

### D14 — Telling the user *why* a name is unavailable

A workspace user who matches the typed query but is not eligible renders as a reachable
`aria-disabled="true"` option reading "Not on this team — can't be mentioned here". Arrow keys reach
it (so a screen reader announces it), Enter does not insert it, and the live region states the
reason. No match at all renders "No teammates match "…"".

**This reveals nothing new**, and that is checkable rather than asserted: `queries.users.all`
(`queries.ts:53-58`) already syncs the entire `user` table to every workspace member, and
`queries.teams.all().related('members')` (`:59-72`) already syncs every team's membership. The
typeahead is reading rows the client already holds.

This **supersedes** the scope's "*3 more in this workspace aren't on this team*" anonymous footer
(§2.2 amendment). The maintainer's H6 instruction is explicit that the UI must say why a name is
unavailable rather than silently doing nothing, and an unnamed count does not answer "why can't I
mention Dana?". A named disabled row names only the person the author already typed.

### D15 — AI-substrate contamination: pre-flight run, result clean, rule written down

Blocking pre-flight per scope §1.9, run before any code. The real paths are
`packages/schema/src/zero/digest.ts`, `packages/schema/src/zero/cycle-facts.ts`,
`packages/schema/src/db/cycle-facts.ts`, `packages/schema/src/zero/ai-tools.ts` and
`apps/server/src/ai/*.ts`.

```
grep -rn "description\|\bbody\b" packages/schema/src/zero/digest.ts \
  packages/schema/src/zero/cycle-facts.ts packages/schema/src/db/cycle-facts.ts \
  packages/schema/src/zero/ai-tools.ts apps/server/src/ai/*.ts | grep -v '\.test\.'
```

**Finding: clean.** `CycleFactsIssueInput` carries `{id, number, title, status, pullRequests}` and
nothing else; the only hits are an unrelated local named `body` in `admin-routes.ts` and the
`comment.*` entries in the agent **tool** table. No AI read path touches `issue.description` or
`comment.body`.

The rule this change now owns, and which `search` and every later AI change inherits:

> **Any feature that feeds `issue.description` or `comment.body` to a model MUST strip mention
> nodes first.** `richTextToPlainText(doc, { mentions: 'strip' })` is the supported way to do it;
> the default (`'label'`) is for human-facing text only. `search_document.body` will contain the
> same names, so `search` must never become a data source for an AI path.

The rule is carried as a comment in `rich-text/plaintext.ts` and as a requirement in the `mentions`
capability spec, so it is enforceable at review time rather than remembered.

**The write direction, found during the pre-flight and worth naming:** `ai-tools.ts:136-137` exposes
`comment.create` and `comment.edit` as agent tools, so an agent acting as a user can author a
document containing mention nodes. That path is already safe — it goes through the same shared
sanitizer and the same server-side eligibility, so an agent cannot mention someone who cannot read
the issue, and the recipient cap bounds a prompt-injected mention storm — but it is a real path, so
it gets an integration assertion rather than a footnote.

### D16 — Migration number `0014_mentions`; `search` moves to `0015`

Scope §0 assigned `0013_notifications` and `0014_search` on the assumption that `mentions` needed no
migration. H7 changed that, and `mentions` lands first. Taking `0014` and amending §0 and §2.2 of
the scope document in this change is the only option that does not leave a landmine for the `search`
flow — migrations are forward-only and applied in order at boot, so two changes claiming `0014`
would collide at the worst possible moment.

### D17 — TipTap 3.28 facts, verified against the published tarballs

Read from `@tiptap/extension-mention@3.28.0` and `@tiptap/suggestion@3.28.0` (`npm pack`,
`dist/index.d.ts` + `dist/index.js`), not from memory:

- **`MentionPluginKey` is NOT exported.** It appears only in a JSDoc `@default`. Supply
  `new PluginKey('yapm-mention')`. (`SuggestionPluginKey` *is* exported from `@tiptap/suggestion`,
  which is a different key and not the one to reuse.)
- **`renderLabel` is deprecated**; use `renderText` + `renderHTML`. Both receive
  `{options, node, suggestion}`.
- Node spec confirmed in the dist bundle: `inline: true`, `atom: true`, `selectable: false`, attrs
  serialised as `data-id` / `data-label` / `data-mention-suggestion-char` with
  `data-type="mention"`.
- **`MentionOptions.suggestions` is an array** — that is H8's seam, preserved by shipping exactly
  one entry in it rather than using the singular `suggestion` option.
- `addProseMirrorPlugins` falls back to `[options.suggestion]` when `suggestions` is empty
  (`suggestions.length ? options.options.suggestions : [options.options.suggestion]`, confirmed in
  the dist), so the read-only `RichTextRenderer` gets a Suggestion plugin too. Neutralise it with
  `allow: () => false`; you cannot switch it off.
- Suggestion 3.28 has managed mounting: `props.mount(element)` returns an unmount to call in
  `onExit`, plus `container`, `placement`, `flip`, `offset`, `minQueryLength`, `debounce`,
  `initialItems`, `loading`, `dismissOnOutsideClick` and `exitSuggestion()`. Use these, **not** the
  manual `clientRect` + tippy dance every pre-3.28 example on the internet shows.
- `items` is typed `(props) => I[] | Promise<I[]>`. We return an array. That is the entire
  sub-100ms story, and it is only possible because Zero has already replicated the `user` table.
- `allowedPrefixes` defaults to `[' ']`, which is what keeps `foo@bar.com` from opening the popup;
  set it explicitly so the behaviour is intentional rather than inherited. An `allow` predicate
  additionally rejects `codeBlock` and inline `code`.
- **Peer ranges are exact, not caret**: `@tiptap/extension-mention@3.28.0` requires
  `@tiptap/core@3.28.0`, `@tiptap/pm@3.28.0`, `@tiptap/suggestion@3.28.0`; `@tiptap/suggestion`
  additionally requires `@floating-ui/dom@^1.0.0`. The catalog's three existing `^3.28.0` entries
  therefore move to `3.28.0` in the same commit, and `@floating-ui/dom` becomes an explicit
  dependency of `packages/ui` rather than a transitive hoist.

### D18 — Follow/unfollow is gated on **read**, not write, or viewers get trapped

`canWrite` excludes the `viewer` role (`context.ts:234`), while mention eligibility is a **read**
predicate — so a viewer on the team can be mentioned, and is therefore auto-subscribed. Gating the
follow mutators on `canWrite`, which is the reflex for anything named "mutator", would give that
viewer a subscription and no way to end it: the exact mail trap this change exists to avoid, aimed
at the one role that cannot escape it.

So `issueSubscription.follow`/`unfollow` gate on `isMember` plus the issue's team access (admin
bypass included) — the same predicate that decides whether you can *read* the issue, and the same
one that decides whether you can be mentioned on it. Three surfaces, one predicate.

This also keeps VISION #5 honest: a viewer is notified, mentionable, and now subscribable and
unsubscribable, with no role gate anywhere.

## How we will know this worked

**The single falsifiable check** — one integration test,
`packages/schema/src/zero/mutators.mentions.pg.test.ts`, run with `DATABASE_URL` set:

> Team **T** with members **A**, **B**, **E**; **C** a workspace member who is *not* on T;
> **D** a workspace **admin** who is *not* on T.
>
> 1. **A** creates an issue in T and posts a comment whose body JSON mentions **B, C, D and A**.
>    → exactly **two** `notification` rows of kind `mention` (B and D). None for C — cannot read the
>    issue. None for A — self-mention. And exactly **two** `issue_subscription` rows in state
>    `subscribed` (B, D).
> 2. **A** edits that comment, keeping B's mention and adding **E**'s.
>    → exactly **one** new `mention` row (E). B gets no second row.
> 3. **A** re-saves the identical body.
>    → **zero** new rows.
> 4. **B** unfollows, then **A** removes and re-adds B's mention.
>    → B's subscription is still `unsubscribed`. The mail trap is closed.
> 5. **E** comments on the issue.
>    → **D** gets an `issue_commented` row (subscribed, not otherwise involved); **B** gets none
>    (unsubscribed); and a subscriber who is *also* the assignee gets exactly **one** row, not two.
> 6. The whole sequence re-run with `tx.location === 'client'` writes **zero** notification rows and
>    **zero** subscription rows.

**Against today's `main` it fails at import** — `extractMentionIds` does not exist,
`issue_subscription` does not exist, and no code path turns a document into a notification — and
once those exist it fails for the right reason at each numbered step in turn. Step 3 is the one that
would fail under a plausible-but-wrong `event_key`, and step 4 is the one that would fail under a
plausible-but-wrong `delete`-based unfollow. Those two steps are the change.

**The supporting E2E check** (`apps/web/e2e/mentions.spec.ts`), which earns its place because jsdom
cannot express it: in the issue-detail comment box, type `@`, assert the listbox appears with
`aria-activedescendant` set, press ↓ then Enter, assert a chip is inserted; then type `@` again and
press **Escape**, and assert the popup closed **while the comment draft text and the detail Sheet
are both still open**. That last assertion is the `defaultPrevented` bug, and it is currently a
live defect on `main`.

**What is not agent-checkable, and belongs to a human.** Flagged here rather than quietly dropped:

- **Whether the typeahead feels Linear-grade.** Popup latency under a fast typist, whether the
  active-row highlight tracks without lag, whether accepting on Tab feels right or surprising, and
  whether the popup's placement flips distractingly near the viewport edge. Automatable checks can
  prove it is correct and reachable; only a person can say it is *good*.
- **Whether "Not on this team — can't be mentioned here" reads as helpful rather than
  accusatory**, in a product whose users are colleagues. The wording is a judgement call; the
  requirement that *some* reason be given is not.
- **Whether auto-subscribe's volume is right in practice** on a real 2–20-person team over a real
  cycle. The mechanism is testable; the felt noise level is only measurable in use, and the
  unfollow control is the escape hatch that makes shipping it reversible.

## Risks / Trade-offs

- **The Escape/Enter collision ships silently if the E2E is skipped** → three handlers for one key,
  one of them inside ProseMirror, and getting it wrong destroys comment drafts. Mitigated by fixing
  it as its own task *before* the extension is wired up, and by the E2E assertion above being
  non-negotiable rather than best-effort.
- **Screen-reader silence** → a body-portalled popup with `aria-activedescendant` pointing outside
  the editor's subtree is invalid ARIA: it announces nothing and looks perfect to a sighted
  developer. Mitigated by the `container`-scoped managed mount (D13) and by an explicit test that
  the `aria-activedescendant` IDREF resolves to an element inside the editor wrapper.
- **Notification storms** → a description mentioning eight people, edited five times, must produce
  eight notifications, not forty. Mitigated by the previous-vs-next diff plus the stable
  `event_key` (D7), which is belt *and* braces: the diff avoids the work, and the primary key would
  absorb it anyway.
- **A mail trap by regression** → if a later change "simplifies" unfollow to a `DELETE`, the trap
  silently reopens. Mitigated by step 4 of the falsifiable check, which fails loudly on exactly that
  refactor, and by a comment on the `state` column saying why it exists.
- **TipTap version skew** → adding the packages without pinning the whole graph produces a
  duplicated ProseMirror `model` and `RangeError: Adding different instances of a keyed plugin` **at
  runtime, not at typecheck**. Mitigated by exact pins on all five packages in one commit (D17) and
  by the E2E, which is the only tier that would catch it.
- **Bundle weight on the issue-detail chunk** → measured against the sub-100ms posture rather than
  assumed free; the mention extension and the listbox are the only additions and both are already
  on that route's critical path, but the number gets recorded rather than waved through.
- **Two changes touching `notifications`' capability spec** → `notifications` is built but not yet
  archived, so its base spec still lives under `openspec/changes/`. This change's delta therefore
  only **adds** requirements and restates none, so archiving in order cannot lose detail.
- **Subscriber reads inside the write transaction** → bounded by `NOTIFICATION_RECIPIENT_CAP` and
  by an index on `(issue_id) where state = 'subscribed'`, so the extra work on a comment write is
  one indexed read of at most 50 rows.

## Migration Plan

Forward-only, applied automatically at boot by the Kysely `Migrator` (`db/migrate.ts`), like every
other migration in the repo.

1. `0014_mentions` creates `issue_subscription`. It is **purely additive** — no column is altered,
   no data is backfilled, and no existing row is touched. An instance that boots the new image and
   then rolls back to the previous one keeps an unused table and loses nothing; that is the rollback
   strategy, and it needs no `down` beyond the one written for test symmetry.
2. No backfill of historical mentions. Documents written before this change contain no mention
   nodes, so `extractMentionIds` returns `[]` for every one of them and nobody is retroactively
   notified or subscribed. Verified by construction rather than by a migration step.
3. The Zero schema, the hand-written Kysely `DB` interface and the migration are extended in the
   same commit, and the CI drift test is the gate that they agree.
4. No new environment variables, no new container, no new pg-boss queue, and no change to the
   existing scheduler.

## Open Questions

None blocking. The three product questions the scope raised (H6, H7, H8) were answered by the
maintainer and are implemented as given. The scope's four minor open questions are resolved here
rather than deferred: the mention chip is a non-interactive `<span>` (D10 — no profile route exists
in v1 and a link would inject tab stops into prose); `mentionSuggestionChar` is kept (D10); ordering
is team-then-admin alphabetical with no recency signal (D4 — recency is a ranking feature dressed as
a requirement for a 20-person team); an unresolvable mention and an ineligible one render
identically as inert `@Name` (D10 — the distinction is invisible to the reader and the difference is
not actionable); and no per-document mention ceiling ships (D9).

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

### I1 — Pre-flight re-run (task 1.1/1.2): both clean, nothing to resolve

`grep -rn "description\|\bbody\b"` over `packages/schema/src/zero/{digest,cycle-facts,ai-tools}.ts`,
`packages/schema/src/db/cycle-facts.ts` and `apps/server/src/ai/*.ts` returns **zero hits in the
three schema files and in `db/cycle-facts.ts`**. The only hits are in `apps/server/src/ai`, and none
of them is a document read: `admin-routes.ts` and its test use `body` for the *HTTP request body* of
the AI-config endpoint, and `tools.ts:85` uses the word `description` inside a tool-description
string handed to the model. D15 stands unamended — no AI read path touches `issue.description` or
`comment.body`, so this change creates the hazard and the `'strip'` rule (task 5.2) is the only
thing standing between it and a future violation.

The seam is also unchanged: `recordNotifications` is re-exported from `@yapm/schema/server`
(`zero/server-mutators.ts:55`, and `"./server"` maps to it in `packages/schema/package.json`),
`notification.kind` is `addColumn('kind', 'text', col => col.notNull())` with no CHECK
(`0013_notifications.ts:28`), and `ACTIONABLE_NOTIFICATION_KINDS` is a plain
`ReadonlySet<NotificationKind>` (`zero/context.ts:178`) whose comment already names `mention`.

### I2 — D17 re-verified against the installed `.d.ts`; all four facts hold, one gap found

Re-read from `node_modules/.pnpm/@tiptap+extension-mention@3.28.0…/dist/index.d.ts` and
`@tiptap+suggestion@3.28.0…/dist/index.d.ts` after `pnpm install`, not from the tarballs and not
from memory. `MentionPluginKey` is absent from the export list (`Mention`, `MentionNodeAttrs`,
`MentionOptions`, default) and survives only in the `@default` JSDoc; `renderLabel` is
`@deprecated use renderText and renderHTML instead` and optional while `renderText`/`renderHTML` are
required; `suggestions` is `Array<Omit<SuggestionOptions, 'editor'>>`; `SuggestionProps.mount` is a
required `SuggestionMount` and `exitSuggestion(view, pluginKeyRef?)` is exported. D17 needs no
correction.

One fact D17 does not carry, discovered while proving the graph resolves: **`@tiptap/core` is not
resolvable from `packages/ui`.** It is a peer of the TipTap packages, not a declared dependency, and
pnpm's strict layout means `import { Editor } from '@tiptap/core'` fails at resolution inside this
workspace. Import `Editor` and the core types from `@tiptap/react`, which re-exports them, rather
than adding a dependency whose only purpose would be to make an import path look tidier.

### I3 — The `defaultPrevented` guard ships as an exported pure function, not an inline `if`

Task 3.1 asks for `if (event.defaultPrevented) return` at the top of the wrapper `onKeyDown`, and
task 3.2 asks `rich-text.test.ts` to prove that a pre-handled key **fires neither callback**. Those
two are in tension: `onKeyDown` is a closure inside `RichTextEditor`, and `packages/ui`'s vitest
project is `environment: 'node'` with `include: ['src/**/*.test.ts']` and no jsdom, no
`@testing-library/react` and no setup file — so there is no way to reach that closure from the test
the task names.

Standing up a jsdom project in `packages/ui` to test a five-line guard would be a bigger, less
reviewable change than the guard itself, and it belongs to whoever first needs a component test
here (task 10.10 will). So the decision the handler makes moved into an exported
`handleRichTextKeyDown(event, {onSubmit, onCancel})` that takes a structural `RichTextKeyEvent`
rather than a React synthetic event. The guard is genuinely the first statement of the wrapper's
handler, the *callbacks* are what the test asserts on rather than a proxy for them, and the function
names nothing mention-specific — it is one half of the layered Escape contract whose other half
(`exitSuggestion`, task 10.6) produces the prevented event.

Two behaviours changed in the move, both deliberate:

- A pre-handled key no longer reaches `preventDefault()` **either**. Calling it on an event an inner
  surface already prevented is a no-op, but not calling it keeps the guard's meaning single: this
  keystroke is not ours.
- In the one-render window where `useEditor` has not yet returned an editor, Cmd+Enter previously
  called `preventDefault()` and then silently did nothing. It now does nothing at all. The
  alternative — submitting `EMPTY_DOC` — would invent a document the user never wrote.

### I4 — The pin was proved at runtime, not just at install time

`pnpm turbo lint typecheck test build` cannot see the failure mode the exact pins exist to prevent,
so two throwaway jsdom checks were run and then deleted rather than left as permanent tests that
duplicate later stages:

1. `RichTextEditor` mounts under the pinned graph, renders its content, fires `onCancel` on an
   ordinary Escape and does **not** fire it on an Escape carrying `defaultPrevented`.
2. `Mention.configure({suggestions: [{char: '@', pluginKey: new PluginKey('yapm-mention'), items:
   () => []}]})` instantiates alongside `StarterKit` in a live `Editor` **without** throwing
   `RangeError: Adding different instances of a keyed plugin`, and registers a `mention` node in the
   schema.

The store backs this up: exactly one `@tiptap/core@3.28.0`, one `@tiptap/pm@3.28.0`, one
`prosemirror-model@1.25.11` and one `@floating-ui/dom@1.8.0` in `node_modules/.pnpm`. Check 2 is
where the MentionSurface stage picks up.
