## Why

`design-explorations/overhaul-2026-08/destinations/inbox.html` is the approved drawing of the
notification Inbox. It is the **last** page of the seven-destination set: `/inbox` is reached from
the deck's right cluster — which already carries the unread count — and it still wears a
pre-overhaul interior. Every other destination now shares one row anatomy, one word diet and one
empty-state register; the inbox does not.

What the shipped page gets wrong, concretely:

1. **The row states the sentence and buries the subject.** The row's headline is
   `Marta mentioned you in ENG-116` and the issue's own title — the thing the reader is trying to
   reach — is demoted to a 12px subline. The mock inverts it: the stored `subjectTitle` is the
   title, and the actor-and-verb is the phrase at rest in the column `issues.html` reserves for it.
2. **The four kinds are indistinguishable.** `issue_assigned`, `issue_commented`, `mention` and
   `pm_digest_published` differ only by a verb inside a sentence. The mock draws four glyphs in the
   house manner — 20-unit box, 1.6 hairline, `currentColor` — so the kind is legible before the
   words are read.
3. **The row is not the set's row.** No `--density-row` height with the list's column boundaries,
   no group band, no key column, no age column at the right edge. A reader coming from Issues or
   Triage meets a fourth list shape.
4. **Band 2 carries a borrowed icon.** A `lucide` `BellIcon` sits beside the title. `issues.html`
   puts no glyph beside `Issues`, and a borrowed icon set has no place in a drawn vocabulary.
5. **The empty state is a two-sentence explanation of what an inbox is.** *"You're all caught up.
   Assignments, comments on issues you're involved in, and digests shared with you land here."* An
   empty inbox is the state a good one is in most of the time; the mock composes it — a settled
   loop, `Nothing waiting`, the four kinds named in mono, and two doorways onward.
6. **Nothing on the surface says what the keys are.** `j`/`k`, `⏎` and `e` all work and none is
   discoverable. The mock draws a legend footline.

Vision principles served: **sub-100ms and offline-capable** (every fact renders from rows Zero has
already synced — no new query, no new subscription), **keyboard-first** (moving, opening and
marking read stay pointer-free and the keys become visible), **free means free** (nothing here is
gated), and the honesty principle running through the whole overhaul — a surface may state only
what a stored row supports.

## What Changes

- **Band 2**: `Inbox` + a mono unread count + an `All` / `Unread` lens toggle + `Mark all read`.
  The `BellIcon` goes. `Mark all read` is **absent**, not disabled, when nothing is unread — the
  same call the deck made when it folded Decisions out of `more▾`.
- **The row becomes the set's row**, at `--density-row`, one line:
  gutter disc · kind glyph · mono key · title · spring · cross-team tag · phrase · mono age.
  The stored `subjectTitle` is the title; the actor-and-verb is the phrase.
- **Four drawn kind glyphs** — assigned, commented, mentioned, digest — page-local, in the house
  manner, each with a text label for assistive technology so the kind is never glyph-only.
- **Read / unread on three redundant channels, none of them colour**: the gutter disc present or
  absent, the title's weight, the title's ink — plus the existing `data-read` and the visually
  hidden `Read` / `Unread` word.
- **Day bands** — `Today` / `Yesterday` / `Earlier` — drawn as the list's group headers rather than
  as a sticky sub-heading. **No counts on them**: the page's only number is the unread count.
- **`notificationCopy` gains a `phrase`** — the actor-and-verb alone, without the subject
  interpolated, because the subject is now the title beside it. `title` and `summary` are untouched,
  so the email template that shares this seam renders identically. The digest phrase is
  `Shared with you`.
- **The empty state as the mock's second frame**: the settled loop glyph, `Nothing waiting`, the
  four kinds in mono, and two doorways (Issues · Home). Announced honestly through one live region,
  and never shown while the query is still filling.
- **A legend footline**: `j` `k` move · `⏎` open · `e` read.

Non-goals, folded deliberately — the mock's own comment records each and this build honours it:

- **No live join to the subject.** A notification has no `issue` relationship in the sync schema
  and will not gain one. No status arc, no reality track, no live title. The absence is a permission
  boundary, not an oversight: a notification is readable only by its recipient with no admin bypass,
  and a joined row would be a second disclosure the predicate does not gate.
- **Nothing implying the stored title is current.** A renamed issue keeps its old title here and
  there is no honest way to mark that, because marking it would require the live title.
- **No threading / roll-up.** Every notification is its own row keyed by
  `(recipient, kind, subject, event_key)`; there is no parent and no thread entity.
- **No per-notification preferences.** No gear, no mute, no per-kind switch. The only preference
  that exists is `user_preference.email_notifications`, it governs **email only**, and it lives on
  the preference surface.
- **No actor avatars** (the phrase names the actor, and the digest row's actor is deliberately
  nameless), **no group counts**, **no actionable/ambient lens**, **no retention footline** (the
  window is configuration, not a fact this page holds).
- **No new tables, no migration, no new named query, no new mutator.** The read/unread writes are
  the shipped ones.

## Capabilities

### New Capabilities

<!-- none: this change re-draws an existing destination -->

### Modified Capabilities

- `notifications`: the inbox surface's drawn anatomy — the row's column order with the snapshot
  title as the title and the actor-and-verb as its phrase, the four kinds each carrying a drawn
  glyph and a text label, read/unread on three non-colour channels, the day bands without counts,
  the `All`/`Unread` lens over already-synced rows, the composed empty state announced honestly,
  and the visible keyboard legend. Plus the shared copy seam gaining a subject-free `phrase` used
  identically by any surface that words a notification.

## Impact

- `packages/schema/src/zero/notifications/copy.ts`: `NotificationCopy` gains `phrase`. `title` and
  `summary` are unchanged, so `packages/email` and the delivery sweep render exactly as before.
- `apps/web/src/notifications/model.ts`: `NotificationRowData` gains `phrase`; the row keeps
  `subjectTitle` as its drawn title.
- `apps/web/src/notifications/kind-glyph.tsx` **(new)**: the four drawn kind glyphs, page-local
  (the `roadmap-view` / `triage-view` precedent — a drawing moves to `packages/ui` when it gains a
  second consumer, not before).
- `apps/web/src/notifications/inbox-view.tsx`: rebuilt to the mock — masthead, lens, day bands, the
  row, the legend, the empty state.
- `apps/web/src/routes/inbox.tsx`: `measure="full"` — the inbox is a work surface, not a reading
  column.
- `packages/ui/src/styles/contrast.test.ts`: this page's pairs in every theme block, light and
  dark, appended as a clearly delimited block at the end of the file.
- `apps/web/e2e/notifications.spec.ts`: selectors updated where the surface moved. No assertion
  weakened; the two-client badge walk and the no-body-excerpt claim are kept verbatim in substance.
- **Not touched**: `packages/schema/src/zero/{schema.ts,queries.ts}` (no relationship, no query
  change), `apps/web/src/frame/*` (band 1 and band 3 are canonical already),
  `apps/web/src/notifications/inbox-badge.tsx` (the count is one subscription and already agrees),
  `ROADMAP.md` (parallel builds — the maintainer adds the row at archive time).
- No dependency, env var, container, table, migration, mutator or named query is added or changed.

Docs: `apps/docs/src/content/docs/features/notifications.md` — the row anatomy left to right, the
four kinds and their glyphs, why no subject status is drawn, the two lenses, the empty state and
the complete keyboard model. `README.md` if it describes the inbox surface.
