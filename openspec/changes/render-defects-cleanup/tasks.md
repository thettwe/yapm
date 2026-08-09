## 1. Reproduce before fixing

- [ ] 1.1 Reproduce defect 3 deterministically: a scratch script (or a temporary `it`) that inserts N teams with `key: newId().slice(0, 8)` in one tight loop and observes `team_key_key` violate — record N and the observed collision in design.md's implementation log.
- [ ] 1.2 Reproduce defect 2 numerically against the shipped constants: a scratch script that runs the current `noteWidth`/collision arithmetic for the reported strings and confirms the 10.2px non-collision at axis max 240 — record the axis maxima at which it happens.
- [ ] 1.3 Confirm defect 1's shape by reading `DecisionPanel`'s two columns and recording the measured heights of the description-less case.

## 2. Defect 3 — a short unique value gets one honest derivation

- [ ] 2.1 Add `newKey(length = 8)` to `packages/schema/src/id.ts`, drawn from `crypto.getRandomValues`, with a comment stating only the constraint the code cannot express (UUIDv7's prefix is a timestamp). Export it from `packages/schema/src/index.ts`.
- [ ] 2.2 Move every uniqueness-bearing prefix-slice call site onto `newKey`: `packages/schema/src/db/invite.test.ts`, `packages/schema/src/db/project.test.ts`, `packages/schema/src/db/search.pg.test.ts`, `apps/server/src/search/routes.pg.test.ts`, `apps/server/src/jobs/search.pg.test.ts`, `apps/server/src/sso/admin-routes.pg.test.ts`.
- [ ] 2.3 Survey and leave alone every `newId().slice(-n)` tail call site; record in design.md that they draw from `rand_b` and are correct.

## 3. Defect 2 — the distribution's note layout

- [ ] 3.1 Extract `layoutDistributionNotes` from `DistributionStrip` as an exported pure function returning `{ id, anchorX, textAnchor, row, from, to }` per note, placing each note on the lowest row whose occupants it clears by `NOTE_GAP`.
- [ ] 3.2 Raise `NOTE_CHAR_W` to a genuinely conservative estimate and replace the comment that claims 6.4 is generous with the measurement that shows it is not (0.6em for both mono faces; the editorial preset's `--type-mono` is proportional).
- [ ] 3.3 Introduce `NOTE_GAP` and make separation a stated minimum rather than strict overlap; keep the edge turn-around for a note that would read off the left of the drawing, and make it participate in the same separation rule.
- [ ] 3.4 Rewire `DistributionStrip` to render exactly what the layout function returns, and make the drawing's box grow for however many rows the layout used (the existing `lift` maths must account for row > 0).

## 4. Defect 1 — the decision panel folds

- [ ] 4.1 In `DecisionPanel`, render the prose column only when the issue has a description; when it does not, lay the provenance line, any attachment chips and the verdicts out as a single band whose height is its content's.
- [ ] 4.2 Keep every test id, accessible name, `aria-keyshortcuts` and `aria-describedby` byte-identical, and keep `decisionRef` the owner the route transient positions against in both layouts.
- [ ] 4.3 Verify the verdict keys, the movement hint and the route transient stay keyboard-reachable and correctly ordered in the folded band.

## 5. Tests

- [ ] 5.1 `packages/schema/src/id.test.ts`: many `newKey()` values minted in one tight loop are all distinct, and `newKey(4)` returns 4 characters. Confirm the loop count is high enough that the old derivation would have failed it.
- [ ] 5.2 `packages/schema/src/db/invite.test.ts`: a Postgres test inserting many teams in rapid succession with `newKey()` and asserting every insert succeeds. Confirm it fails on `main`'s derivation.
- [ ] 5.3 `packages/ui/src/components/distribution-strip.test.tsx` (new): assert the layout invariant — no two notes sharing a row are closer than `NOTE_GAP` — over a matrix of shapes: the reported 26h/110h/240h case, median adjacent to the outlier group, no outliers, crowd compressed at the left, a single merged change, and a note that turns around at the left edge.
- [ ] 5.4 `apps/web/src/triage/triage-view.test.tsx`: with the head issue carrying no description, assert the panel renders no prose region, states no placeholder text, and still exposes all three verdicts and the open control by their shipped names.
- [ ] 5.5 State plainly in each of 5.3 and 5.4 (in the test file's own header comment) that the test cannot prove the visual composition and that the render is the real check.
- [ ] 5.6 Confirm 5.3 and 5.4 fail against `main`'s code before the fixes land — run them at the pre-fix commit and record the failure output in design.md.
- [ ] 5.7 Add a `distribution-strip.stories.tsx` story for the colliding shape so the degenerate case is one click away in future.

## 6. Render and look

- [ ] 6.1 Bring up the seeded stack: `YAPM_HOST_PORT=3200 docker compose -f docker/docker-compose.dev.yml up -d --wait postgres zero-cache`, then `PORT=3200 SERVER_ORIGIN=http://localhost:3200 YAPM_HOST_PORT=3200 pnpm dev`.
- [ ] 6.2 Seed a team whose triage issues carry **no description**; drive `/teams/{teamId}/triage` with the workspace Playwright and screenshot the decision panel. Look at it. Record what the render showed.
- [ ] 6.3 Seed a team with ~57 historical pull requests across completed cycles (Delivery's distribution folds without them); drive `/teams/{teamId}/delivery` and screenshot OPEN TO MERGED. Look at it. Confirm the two annotations are legible and record it.
- [ ] 6.4 Repeat 6.2 and 6.3 in a second theme preset, including the editorial preset whose `--type-mono` is proportional, and in dark.

## 7. Documentation

- [ ] 7.1 Grep the root docs (README, ROADMAP, TECHSTACK, VISION, PROCESS, `.env.example`, `reference/`) and `apps/docs` for anything describing the decision panel's empty case, the distribution's callout placement, or id derivation; update whatever the grep finds, and record "nothing found" explicitly if that is the result. **Do not edit `ROADMAP.md`** (parallel build).
- [ ] 7.2 Append the build-time decisions to `openspec/changes/render-defects-cleanup/design.md` under "## Decisions made during implementation": what was ambiguous, what was chosen, why — including the reproduction numbers from group 1 and the render observations from group 6.
- [ ] 7.3 Check every box in this file that is actually done, and leave unchecked anything that is not.

## 8. Gates

- [ ] 8.1 `pnpm turbo lint typecheck test build` — green, with the actual output reported.
- [ ] 8.2 The compose smoke test.
- [ ] 8.3 The full Playwright suite. Re-run once for the known multi-browser-context flake (`projects.spec.ts:190`/`:248`, `pm-digest.spec.ts:306`, `retro.spec.ts:236`) and **confirm the failure signature is `browserContext.close: Protocol error (Target.disposeBrowserContext)`** rather than an assertion disagreeing. Any other failure is this change's.
