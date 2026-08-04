export const meta = {
  name: 'change-build-flow',
  description:
    'Build one OpenSpec change: propose and plan in one pass, open the PR immediately so CI runs continuously, build in one or two passes, then hand off to the PR-review flow.',
  phases: [
    { title: 'Propose', detail: 'OpenSpec artifacts and the build plan, in one pass' },
    { title: 'Open', detail: 'open the PR now, so every later push runs CI in parallel' },
    { title: 'Build', detail: 'one or two builders; fast gates, then push' },
    { title: 'Close', detail: 'tests and docs' },
    { title: 'Review', detail: 'hand the open PR to the review flow' },
  ],
}

// Rewrite (2026-07-27). The previous version averaged 4.8-7.3 h and 31-36 agents per change, all
// serial. Measured breakdown of the 437-minute search build: Propose+Plan 30, four build stages each
// behind its own verifier 160, Tests+Docs behind verifiers 60, Integrate 35, Sync 12, three review
// rounds 100, merge 15. Changes, in order of what they saved:
//
//   1. THE PR OPENS FIRST. ci.yml triggers on `pull_request`, so pushing to a feature branch with no
//      PR open ran nothing — which is the only reason an Integrate phase existed at all: something had
//      to boot Docker and run e2e before review, because CI had never seen the code. Open the PR at
//      the start and every stage push runs the full suite, in parallel, for free. Integrate is gone.
//   2. No per-stage verifier. Review plus CI already cover it. The cheap no-op guard stays, because a
//      builder that writes nothing is the one failure a reviewer cannot see.
//   3. One or two builders, not four stages. Stage granularity existed to give verifiers something to
//      verify; without them it mostly bought serialization.
//   4. Tests and docs in one pass, not two behind two more verifiers.
//   5. Review capped at two rounds (in pr-review-flow). Across notifications, mentions, search and
//      retro-board, round three has NEVER produced a critical or high finding — only polish, at ~40 min
//      and ~500K tokens a time. Round two has, so it stays.
//   6. effort: 'medium' on mechanical agents; 'high' only where judgement is the work.
//
// The remaining floor is real: an agent writing code takes 25-45 min and writers cannot be parallelised
// within one worktree (PROCESS.md §5). At ~8 serial agents that is 1.5-2 h, so SCOPE PER CHANGE is now
// the bigger lever. Prefer three changes of one hour over one change of three.

// args: { changeName, branch, mission, prTitle, repoDir, base, docker, resume, maxStages, tokenFloor }
const A = args || {}
const CHANGE = A.changeName
const BRANCH = A.branch || `feat/${CHANGE}`
const BASE = A.base || 'main'
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const RESUME = Boolean(A.resume)

if (!CHANGE) throw new Error('change-build-flow requires args.changeName')
if (!A.mission) throw new Error('change-build-flow requires args.mission — the change-specific brief')

// Two is the cap and one is the goal. A change needing three builders is a change that should have
// been two changes.
const CEILING = { maxStages: A.maxStages || 2, tokenFloor: A.tokenFloor || 80_000 }
const budgetLeft = () => (budget.total ? budget.remaining() : Number.POSITIVE_INFINITY)
const outOfBudget = () => budgetLeft() < CEILING.tokenFloor

const D = A.docker || {}
const DOCKER_PROJECT = D.project || 'yapm-dev'
const PG_PORT = D.pgPort || 5440
const ZERO_PORT = D.zeroPort || 4848
const APP_PORT = D.appPort || 3000
const COMPOSE = `docker compose -p ${DOCKER_PROJECT} -f docker/docker-compose.dev.yml`
const COMPOSE_ENV = `POSTGRES_HOST_PORT=${PG_PORT} ZERO_CACHE_HOST_PORT=${ZERO_PORT} YAPM_HOST_PORT=${APP_PORT}`

// Fast gates only. The full suite, Docker and Playwright now run in CI on every push, because the PR
// is open from the start — so running them locally is duplicating a thing already in flight.
const FAST_GATES =
  `pnpm turbo run typecheck '--filter=...[origin/${BASE}]' && pnpm lint && ` +
  `pnpm turbo run test '--filter=...[origin/${BASE}]' && node scripts/check-boundaries.mjs`

const ISOLATION =
  `## Working boundary\nWork ONLY inside ${REPO}. Never cd to another worktree or to main's working tree.` +
  (A.docker
    ? `\nAnother build may be running concurrently in a sibling worktree. docker/docker-compose.dev.yml ` +
      `hardcodes \`name: yapm-dev\`, so pass the project name and ports on EVERY compose command:\n` +
      `    ${COMPOSE_ENV} ${COMPOSE} ...\n` +
      `DATABASE_URL postgres://yapm:yapm@localhost:${PG_PORT}/yapm; zero-cache http://localhost:${ZERO_PORT}; ` +
      `app port ${APP_PORT}. Tear down with \`${COMPOSE} down -v\` — never a bare \`down\`, never ` +
      `\`docker system prune\`, never stop containers you did not start.`
    : '') +
  `\ngit: only ever \`git push origin ${BRANCH}\`. Never push ${BASE}.\n` +
  `**Never merge the pull request.** It is open from the start of this build so that CI runs on your ` +
  `pushes; it is NOT ready to land. The review flow that runs last owns the merge decision, and it ` +
  `depends on review rounds that have not happened yet. Green CI means the code compiles and the tests ` +
  `pass — it does not mean the change has been reviewed. \`gh pr merge\` is forbidden to you.`

const PREAMBLE =
  `You are building the ${CHANGE} change in the yapm repository at ${REPO}, on branch ${BRANCH}. All commits go to ` +
  `${BRANCH}.\n\n${ISOLATION}\n\n${A.mission}\n\n` +
  `## Always-on constraints (CLAUDE.md)\n` +
  `Exactly three containers — no new service. All ZQL and mutators ONLY in packages/schema; client and server import ` +
  `the SAME mutator. Client-minted UUIDv7 at the mutator CALL SITE, never inside a mutator body — mutators re-run ` +
  `during rebase and an id minted inside one corrupts the optimistic result. Row-level permissions deny by empty ` +
  `query and check auth BEFORE existence. kysely 0.28.17, no kysely-codegen, no baseUrl, no TS-Compiler-API tools. ` +
  `Every color and font via tokens; correct in all three themes light and dark; AA contrast. Keyboard-first. ` +
  `Sub-100ms interactions. Team-level metrics only. Do NOT regress any prior change.\n\n` +
  `## The stack postdates your training data\n` +
  `Zero 1.x is defineQuery / defineQueries / defineMutator / defineMutators / createBuilder / handleQueryRequest / ` +
  `handleMutateRequest. The 0.x names (syncedQuery, PushProcessor, definePermissions) produce fluent, ` +
  `NON-FUNCTIONAL code. Consult ${REPO}/reference/*.md before using Zero, Kysely, better-auth, TanStack Router, ` +
  `TipTap, Vite or Tailwind; if reference/ does not cover it, read the installed package's .d.ts in node_modules. ` +
  `Do not guess a package name or an API from memory.\n\n` +
  `## Decisions already settled by earlier changes\n` +
  `Read the "## Decisions made during implementation" sections of the two or three most recent changes under ` +
  `${REPO}/openspec/changes/ and openspec/changes/archive/. Those are settled precedent — follow them unless this ` +
  `change has a specific reason not to, and say why. Ignoring that log is how the same argument gets had twice.\n` +
  `${REPO}/openspec/specs/ is the living behaviour and was made accurate on 2026-08-04 — 37 capabilities. Trust it.\n\n` +
  `## Working agreement\n` +
  `Ambiguity or a misbehaving library: choose what best fits VISION/DESIGN, log it in ` +
  `openspec/changes/${CHANGE}/design.md under "## Decisions made during implementation", and continue — never ` +
  `stall, never silently paper over. Conventional Commits with DCO sign-off (git commit -s). Biome formats. No ` +
  `comments explaining what a line does — only constraints the code cannot express.\n\n` +
  `## Report honestly\n` +
  `If you run out of road, report the best artifact you produced, what completed, what is unresolved, and why you ` +
  `stopped. Never present partial work as complete — a fluent summary over a half-finished stage costs whoever ` +
  `reads it next the time to discover that themselves.`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    isBigFeature: { type: 'boolean' },
    testTiers: { type: 'string' },
    falsifiableCheck: { type: 'string', description: 'the check that fails on current main and passes when this is correct' },
    humanJudgement: { type: 'string', description: 'what a human must judge because no agent can; empty if nothing' },
    oversized: {
      type: 'boolean',
      description: 'true if this change should really have been split into smaller changes',
    },
    stages: {
      type: 'array',
      description: 'one or at most two build passes, in dependency order',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brief: { type: 'string', description: 'what to build, specific enough to hand to a builder cold' },
        },
        required: ['name', 'brief'],
        additionalProperties: false,
      },
    },
  },
  required: ['isBigFeature', 'testTiers', 'falsifiableCheck', 'humanJudgement', 'oversized', 'stages'],
  additionalProperties: false,
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    gatesGreen: { type: 'boolean' },
    pushed: { type: 'boolean' },
    summary: { type: 'string' },
    unresolved: { type: 'array', items: { type: 'string' } },
  },
  required: ['filesChanged', 'gatesGreen', 'pushed', 'summary', 'unresolved'],
  additionalProperties: false,
}

const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    prNumber: { type: 'integer' },
    headSha: { type: 'string' },
  },
  required: ['prNumber', 'headSha'],
  additionalProperties: false,
}

// One builder, no separate verifier. A builder that produced nothing is re-dispatched immediately —
// that is the one failure the later review genuinely cannot see, since there is no diff to review.
async function build(name, brief, prevNotes) {
  let feedback = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await agent(
      `${PREAMBLE}\n\n## YOUR ASSIGNMENT — ${name}\n${brief}\n` +
        (prevNotes ? `\nPrevious pass: ${prevNotes}\n` : '') +
        feedback +
        `\n\nWrite the code, tick what you complete in openspec/changes/${CHANGE}/tasks.md, then run the fast gates:\n` +
        `  ${FAST_GATES}\n` +
        `Do NOT run the full build, Playwright, docker compose or the smoke test. **The PR is already open, so your ` +
        `push runs the entire suite in CI** — running it here duplicates something already in flight.\n` +
        `Then git add -A && git commit -s && git push origin ${BRANCH}.\n` +
        `Report every file you created or modified. If you genuinely could not change anything, say so with the ` +
        `reason rather than reporting work you did not do.`,
      { label: `build:${name}${attempt > 1 ? ':retry' : ''}`, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' },
    )
    if (r && (r.filesChanged || []).length > 0) return r

    // "Reported nothing" and "died after writing" look identical from here, and the script cannot run
    // `git status` to tell them apart. Ask before re-dispatching: a builder that died mid-response left
    // its edits on disk, and blindly re-running one on top of a dirty tree is how work gets duplicated
    // or clobbered. This is the same failure that left four files of confirmed fixes uncommitted on
    // auto-status while CI went green against the previous head.
    const salvage = await agent(
      `${PREAMBLE}\n\n## Salvage check — did the last builder die after writing?\n` +
        `The ${name} builder reported no files. That means one of two things, and they are ` +
        `indistinguishable from outside: it genuinely did nothing, or it wrote files and then died ` +
        `mid-response before reporting. **Do not assume the first.**\n\n` +
        `1. \`git -C ${REPO} status --porcelain\` and \`git -C ${REPO} diff --stat\`. Clean tree → nothing was ` +
        `salvaged; say so and stop, and the builder will be re-dispatched.\n` +
        `2. Dirty tree → real work exists. Judge it against the assignment below: coherent and complete, or ` +
        `half-applied? Finish what is incomplete.\n` +
        `3. Run the fast gates:\n   ${FAST_GATES}\n` +
        `   A dying agent often never reached the formatter, so \`pnpm lint\` may fail on formatting alone; ` +
        `\`pnpm format\` fixes that.\n` +
        `4. Gates green → git add -A && git commit -s && git push origin ${BRANCH}.\n\n` +
        `Report honestly. A false "recovered" is worse than a clean report of nothing, because the next phase ` +
        `will build on whatever you claim.\n\n## THE ASSIGNMENT THAT WAS RUNNING\n${brief}`,
      { label: `salvage:${name}`, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' },
    )
    if (salvage && (salvage.filesChanged || []).length > 0) {
      log(`${name}: salvaged ${salvage.filesChanged.length} file(s) from a dead builder`)
      return salvage
    }

    log(`${name} attempt ${attempt}: builder produced NO files and the tree was clean — re-dispatching`)
    feedback =
      `\n\n## THE PREVIOUS ATTEMPT PRODUCED NOTHING\nIt finished without creating or modifying a single file` +
      `${r && r.summary ? ` (it said: ${r.summary.slice(0, 300)})` : ''}, and a salvage check confirmed the working ` +
      `tree was clean, so nothing was written and lost. Read the tasks, then actually write the code.`
  }
  log(`${name} produced nothing twice — continuing; review will see an empty diff`)
  return { filesChanged: [], gatesGreen: false, pushed: false, summary: '', unresolved: [`${name} produced nothing`] }
}

phase('Propose')
const plan = await agent(
  `${PREAMBLE}\n\n## Propose phase — artifacts AND plan, in one pass\n` +
    (RESUME
      ? `${CHANGE} was already proposed and partly built; earlier work is committed on ${BRANCH}. Do NOT re-propose. ` +
        `Establish the true state: \`git log --oneline ${BASE}..${BRANCH}\`, the tasks still marked [ ] or [~], and ` +
        `the decisions in design.md the remaining work must honour. Flag anything ticked you cannot find evidence ` +
        `for in the diff. Plan ONLY what remains.\n\n`
      : `1. cd ${REPO} && npx -y @fission-ai/openspec@latest new change ${CHANGE}\n` +
        `2. Write proposal.md (with a \`Docs:\` line in Impact), design.md, the capability spec deltas, and tasks.md ` +
        `with a \`## Documentation\` group and explicit test tasks. Templates: ` +
        `\`npx -y @fission-ai/openspec@latest instructions <artifact> --change ${CHANGE} --json\`.\n` +
        `3. Validate until clean: \`npx -y @fission-ai/openspec@latest validate ${CHANGE}\` (positional, NOT --change).\n` +
        `4. Commit and push: git add -A && git commit -s && git push -u origin ${BRANCH}.\n\n`) +
    `## Then plan the build, in the same pass\n` +
    `Group the work into **ONE build pass, or at most ${CEILING.maxStages}**. This is deliberately tight. Stage ` +
    `granularity used to exist so a per-stage verifier had something to verify; there is no such verifier now, and ` +
    `every extra pass is another 30-45 minutes of serial wall clock. Two passes only when the second genuinely ` +
    `cannot start until the first exists (a UI that needs its schema, say) — not merely because the work has two ` +
    `topics.\n` +
    `Exclude tests and documentation; a dedicated Close phase handles them.\n\n` +
    `**Set \`oversized: true\` if this change should have been two or three changes.** Say so plainly — scope per ` +
    `change is now the main cost driver, and a change that needs three build passes is a change that should have ` +
    `been split. You are not being asked to split it yourself; you are being asked to say so.\n\n` +
    `**Name the falsifiable check**: the single test that FAILS against today's ${BASE} and PASSES when this change ` +
    `is correct, concretely enough to run. If success genuinely cannot be checked, say so and name the human ` +
    `decision instead of inventing a check that cannot fail. Some things are not agent-checkable — whether a surface ` +
    `feels Linear-grade is the standing example — and those belong in humanJudgement, not quietly dropped.\n` +
    `Judge the big-feature rule honestly (PROCESS.md §3); do not add e2e reflexively.`,
  { label: RESUME ? 'propose:resume' : 'propose:write', phase: 'Propose', schema: PLAN_SCHEMA, effort: 'high' },
)

if (!plan) {
  throw new Error(
    `change-build-flow: the Propose phase produced nothing — the agent died before returning (transient API error, ` +
      `or it exhausted its context). Re-run the workflow unchanged.`,
  )
}
if (!plan.stages || plan.stages.length === 0) {
  throw new Error(
    `change-build-flow: Propose returned zero build passes for ${CHANGE}. Check that ` +
      `openspec/changes/${CHANGE}/tasks.md contains implementation sections beyond tests, docs and verification.`,
  )
}
log(`Plan: ${plan.stages.length} pass(es) — ${plan.stages.map((s) => s.name).join(' → ')}`)
log(`Falsifiable check: ${plan.falsifiableCheck || '(NONE STATED — this change cannot prove itself)'}`)
if (plan.oversized) log(`⚠ Propose judged this change OVERSIZED — it should have been split. Note for next time.`)
if (plan.humanJudgement) log(`Needs human judgement: ${plan.humanJudgement}`)

// Open the PR before any code exists. This is the single largest saving in the flow: ci.yml triggers
// on `pull_request`, so with no PR open a push to a feature branch runs nothing at all. With it open,
// every build push runs lint, typecheck, tests, build, Playwright and the compose smoke test in
// parallel with the next agent — which is what removed the need for a local Integrate phase entirely.
phase('Open')
const opened = await agent(
  `${PREAMBLE}\n\n## Open the pull request NOW, before the code exists\n` +
    `The proposal is committed and pushed. Open a DRAFT-quality PR immediately so that CI runs on every subsequent ` +
    `push instead of only at the end.\n` +
    `\`gh pr create --base ${BASE} --head ${BRANCH} --title ${JSON.stringify(A.prTitle || CHANGE)} --body\` — the body ` +
    `should summarise openspec/changes/${CHANGE}/proposal.md and state plainly that the change is still being built. ` +
    `Reuse the PR if one already exists.\n` +
    `Report the PR number and the current head SHA. Do NOT wait for CI, do NOT merge, do NOT approve.`,
  { label: 'open:pr', phase: 'Open', schema: OPEN_SCHEMA, effort: 'medium' },
)
if (opened) log(`PR #${opened.prNumber} open — CI now runs on every push`)

phase('Build')
const results = []
let carry = plan.falsifiableCheck
for (const s of plan.stages) {
  if (outOfBudget()) {
    log(`Budget floor reached — stopping before ${s.name}`)
    return {
      change: CHANGE,
      pr: opened?.prNumber ?? null,
      stages: results,
      stoppedBecause: `budget ceiling: fewer than ${CEILING.tokenFloor} tokens remained`,
      unresolved: [`build pass ${s.name} never ran`, 'Close and Review were never reached'],
      resumeHint: `Completed passes are committed on ${BRANCH}. Re-run with resume: true.`,
      review: null,
    }
  }
  const r = await build(s.name, `${s.brief}\n\nHow this change proves itself: ${plan.falsifiableCheck}`, carry)
  results.push({ name: s.name, files: (r.filesChanged || []).length, gatesGreen: r.gatesGreen })
  carry = r.summary
}

phase('Close')
const close = await build(
  'TestsAndDocs',
  `Finish the change: tests and documentation in one pass.\n\n` +
    `**Tests** — the tiers this change committed to: ${plan.testTiers}\n` +
    `UNIT (Vitest, no DB): pure logic. INTEGRATION (Vitest, live Postgres): migrations, drift, permission SCOPING, ` +
    `mutator authz. E2E (Playwright) only if the big-feature rule applies. Every test must be able to FAIL — no ` +
    `assertion that passes vacuously. The falsifiable check above is the one that matters most; make sure it exists ` +
    `and that you have reasoned about why it fails on ${BASE}.\n\n` +
    `**Docs** — PROCESS.md §2. The apps/docs pages for what this adds, wired into the sidebar; then EVERY root doc ` +
    `this change makes stale: README, ROADMAP, TECHSTACK, .env.example (matching the Zod schema exactly), and any ` +
    `reference/VISION/DESIGN doc whose content changed. If you learned something a reference/ harvest got wrong, fix ` +
    `it — that is high-value and easy to skip.\n\n` +
    `Run \`pnpm --filter @yapm/docs build\` as well as the fast gates. Integration and e2e specs needing a live stack ` +
    `may skip locally — CI runs them on your push.`,
  carry,
)

const unresolved = [
  ...results.filter((r) => !r.gatesGreen).map((r) => `build pass ${r.name} ended with red fast gates`),
  ...(close.gatesGreen ? [] : ['Close ended with red fast gates']),
  ...(close.unresolved || []),
  ...(plan.falsifiableCheck ? [] : ['no falsifiable check was ever stated']),
  ...(plan.oversized ? ['Propose judged this change oversized — it should have been split'] : []),
  ...(plan.humanJudgement ? [`needs human judgement: ${plan.humanJudgement}`] : []),
]
if (unresolved.length) log(`⚠ Unresolved going into review:\n- ${unresolved.join('\n- ')}`)

phase('Review')
log(`Handing PR #${opened?.prNumber ?? '?'} to the review flow...`)
const review = await workflow(
  { scriptPath: `${REPO}/.claude/workflows/pr-review-flow.js` },
  {
    branch: BRANCH,
    base: BASE,
    changeName: CHANGE,
    prTitle: A.prTitle || CHANGE,
    repoDir: REPO,
    existingPr: opened?.prNumber ?? null,
    knownUnresolved: unresolved,
    falsifiableCheck: plan.falsifiableCheck,
  },
)

return {
  change: CHANGE,
  pr: opened?.prNumber ?? null,
  stages: results,
  oversized: plan.oversized,
  falsifiableCheck: plan.falsifiableCheck,
  humanJudgement: plan.humanJudgement,
  unresolved,
  stoppedBecause: 'completed all planned passes',
  review,
}
