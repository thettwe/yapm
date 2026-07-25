export const meta = {
  name: 'change-build-flow',
  description:
    'Build one OpenSpec change end to end: propose, derive the stage order from the change\'s own tasks.md, build each stage behind a cheap independent verifier, verify live ONCE, then hand off to the PR-review flow.',
  phases: [
    { title: 'Propose', detail: 'write and validate the OpenSpec change artifacts' },
    { title: 'Plan', detail: 'derive the stage order from the change\'s tasks.md' },
    { title: 'Build', detail: 'one stage per task group; fast gates only' },
    { title: 'Tests', detail: 'write the test tiers the proposal committed to' },
    { title: 'Docs', detail: 'docs-site pages + root-doc freshness' },
    { title: 'Integrate', detail: 'the ONE full live verification: full suite, docker, e2e, drift' },
    { title: 'Sync', detail: 'rebase onto latest main' },
    { title: 'Review', detail: 'hand off to the PR-review flow' },
  ],
}

// Rewrite (2026-07-25). Measured against the zero-reconnect and retro-board runs, the previous
// per-change pattern took 110-218 min and carried the same disease the PR flow had before its own
// rewrite: EVERY stage's independent verifier re-ran the full gate suite (turbo typecheck lint build
// test + boundaries + catalog, often plus a docker stack boot), so a 5-stage change paid for the full
// suite 5-6 times, each run re-proving the previous stage's work. Changes:
//   1. Stage verifiers run FAST gates only (typecheck + lint + affected tests + boundaries). No full
//      build, no docker, no e2e.
//   2. Exactly ONE Integrate stage boots docker and runs the full suite + all e2e + the drift test.
//   3. Stage order is DERIVED from the change's own tasks.md instead of hardcoded. Hardcoding it is
//      what put Client before its Server prerequisites in the zero-reconnect run.
//   4. A build agent that changes zero files is re-dispatched IMMEDIATELY, without paying for a
//      verifier pass to discover it — that no-op cost 11 min in the zero-reconnect run.
// Guarantees are unchanged: every stage is independently verified before it commits, and nothing
// reaches review without one full live pass.
//
// Stages stay SERIAL on purpose. PROCESS.md §5: two repo-mutating agents in one working tree corrupt
// each other's `git add -A && commit`. Parallelism belongs across worktrees, not inside one.

// args: { changeName, branch, mission, prTitle, repoDir, base, docker, isBigFeature, maxAttempts }
const A = args || {}
const CHANGE = A.changeName
const BRANCH = A.branch || `feat/${CHANGE}`
const BASE = A.base || 'main'
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const MAX_ATTEMPTS = A.maxAttempts || 3

if (!CHANGE) throw new Error('change-build-flow requires args.changeName')
if (!A.mission) throw new Error('change-build-flow requires args.mission — the change-specific brief')

// Declared complexity budget. Every run states its ceiling up front; when the ceiling is reached the
// run stops and reports the best artifact, what completed, what is unresolved, and why it stopped —
// rather than continuing until something incidental terminates it. Wall-clock is not observable from
// a workflow script (Date.now is unavailable), so the token budget is the enforceable dimension.
const CEILING = {
  stageAttempts: MAX_ATTEMPTS,
  maxStages: A.maxStages || 5,
  // Below this many remaining output tokens, do not START another stage.
  tokenFloor: A.tokenFloor || 80_000,
}
const budgetLeft = () => (budget.total ? budget.remaining() : Number.POSITIVE_INFINITY)
const outOfBudget = () => budgetLeft() < CEILING.tokenFloor

// Docker isolation. Only meaningful when this runs in a worktree alongside another build; the
// compose files hardcode `name: yapm-dev` / `name: yapm`, so a bare compose command in two trees
// shares one project and tears the other's stack down.
const D = A.docker || {}
const DOCKER_PROJECT = D.project || 'yapm-dev'
const PG_PORT = D.pgPort || 5440
const ZERO_PORT = D.zeroPort || 4848
const APP_PORT = D.appPort || 3000
const COMPOSE = `docker compose -p ${DOCKER_PROJECT} -f docker/docker-compose.dev.yml`
const COMPOSE_ENV = `POSTGRES_HOST_PORT=${PG_PORT} ZERO_CACHE_HOST_PORT=${ZERO_PORT} YAPM_HOST_PORT=${APP_PORT}`

const ISOLATION =
  `## Working boundary\n` +
  `Work ONLY inside ${REPO}. Never cd to another worktree or to main's working tree.` +
  (A.docker
    ? `\nAnother build may be running concurrently in a sibling worktree. docker/docker-compose.dev.yml ` +
      `hardcodes \`name: yapm-dev\`, so you MUST pass the project name and ports on EVERY compose command:\n` +
      `    ${COMPOSE_ENV} ${COMPOSE} ...\n` +
      `Your DATABASE_URL is postgres://yapm:yapm@localhost:${PG_PORT}/yapm; your zero-cache is ` +
      `http://localhost:${ZERO_PORT} (set VITE_ZERO_CACHE_URL and E2E_ZERO_CACHE_URL to it); app port ${APP_PORT}. ` +
      `Tear down with \`${COMPOSE} down -v\` — never a bare \`down\`, never \`docker system prune\`, never stop ` +
      `containers you did not start.`
    : '') +
  `\ngit: only ever \`git push origin ${BRANCH}\`. Never push ${BASE}, never force-push except the Sync phase's ` +
  `--force-with-lease on your own branch.`

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
  `handleMutateRequest. Writing the 0.x names (syncedQuery, PushProcessor, definePermissions) from memory produces ` +
  `fluent, plausible, NON-FUNCTIONAL code. Consult ${REPO}/reference/*.md before using Zero, Kysely, better-auth, ` +
  `TanStack Router, Vite or Tailwind. If reference/ does not cover it, read the installed package's .d.ts in ` +
  `node_modules. Do not guess.\n\n` +
  `## Decisions already settled by earlier changes\n` +
  `Before proposing or building, read the "## Decisions made during implementation" sections of the two or three ` +
  `most recent changes under ${REPO}/openspec/changes/ (and openspec/changes/archive/). Those decisions are settled ` +
  `precedent — do not re-litigate them, and follow them unless this change has a specific reason not to, in which ` +
  `case say why. That log is the project's decision provenance; ignoring it is how the same argument gets had twice.\n\n` +
  `## Working agreement\n` +
  `Ambiguity or a misbehaving library: choose what best fits VISION/DESIGN, log it in ` +
  `openspec/changes/${CHANGE}/design.md under "## Decisions made during implementation", and continue — never stall, ` +
  `never silently paper over. Conventional Commits with DCO sign-off (git commit -s). Biome formats. No comments ` +
  `explaining what a line does — only constraints the code cannot express.\n\n` +
  `## Report honestly\n` +
  `If you run out of road — a library does not behave as documented, a task is underspecified, a gate cannot be ` +
  `satisfied — report the best artifact you produced, what actually completed, what is unresolved, and why you ` +
  `stopped. Never present partial work as complete. A fluent summary over a half-finished stage is worse than a ` +
  `blunt "this part is not done, here is why", because it costs someone else the time to discover it.`

// Fast gates: what a stage verifier runs. Deliberately excludes the full build, docker, and e2e —
// the Integrate stage runs those once, and CI re-runs everything on push anyway.
const FAST_GATES =
  `pnpm turbo run typecheck --filter=...[origin/${BASE}] && pnpm lint && ` +
  `pnpm turbo run test --filter=...[origin/${BASE}] && node scripts/check-boundaries.mjs`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    filesChanged: {
      type: 'array',
      description: 'repo-relative paths this stage created or modified, excluding openspec/ and gitignored output',
      items: { type: 'string' },
    },
    tasksTicked: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    decisions: { type: 'string', description: 'anything logged to design.md; empty if none' },
  },
  required: ['filesChanged', 'tasksTicked', 'summary', 'decisions'],
  additionalProperties: false,
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    ranCommands: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['passed', 'ranCommands', 'failures', 'notes'],
  additionalProperties: false,
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    isBigFeature: { type: 'boolean' },
    testTiers: { type: 'string', description: 'which tiers this change needs, and why' },
    falsifiableCheck: {
      type: 'string',
      description: 'the check that fails against current main and passes when this change is correct',
    },
    humanJudgement: {
      type: 'string',
      description: 'what about this change a human must judge because no agent can; empty if nothing',
    },
    stages: {
      type: 'array',
      description: 'implementation stages in dependency order, derived from tasks.md',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'short PascalCase stage name' },
          taskSections: { type: 'string', description: 'the tasks.md section numbers this stage covers' },
          brief: { type: 'string', description: 'what to build, specific enough to hand to a builder' },
          extraChecks: { type: 'string', description: 'stage-specific checks beyond the fast gates; empty if none' },
        },
        required: ['name', 'taskSections', 'brief', 'extraChecks'],
        additionalProperties: false,
      },
    },
  },
  required: ['isBigFeature', 'testTiers', 'falsifiableCheck', 'humanJudgement', 'stages'],
  additionalProperties: false,
}

// One stage: build, then an independent verifier that reviews the diff and runs FAST gates only.
// A builder that produced nothing is re-dispatched immediately — discovering that via a full
// verifier pass is pure waste.
async function stage(name, brief, extraChecks, prevNotes, phaseName = 'Build') {
  let feedback = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const built = await agent(
      `${PREAMBLE}\n\n## YOUR ASSIGNMENT — ${name}\n${brief}\n` +
        (prevNotes ? `\nPrevious stage notes: ${prevNotes}\n` : '') +
        feedback +
        `\n\nRun the relevant checks yourself as you go. Tick the tasks you complete in ` +
        `openspec/changes/${CHANGE}/tasks.md. Do NOT commit — an independent verifier runs next.\n` +
        `Report every file you created or modified. If you genuinely could not change anything, say so with the ` +
        `reason rather than reporting work you did not do.`,
      {
        label: `build:${name}${attempt > 1 ? `:retry${attempt}` : ''}`,
        phase: phaseName,
        schema: BUILD_SCHEMA,
        effort: 'high',
      },
    )

    const changed = (built && built.filesChanged) || []
    if (changed.length === 0) {
      log(`${name} attempt ${attempt}: builder produced NO files — re-dispatching without a verifier pass`)
      feedback =
        `\n\n## PREVIOUS ATTEMPT PRODUCED NOTHING\nThe last builder for this stage finished without creating or ` +
        `modifying a single file${built && built.summary ? ` (it reported: ${built.summary.slice(0, 300)})` : ''}. ` +
        `Do not repeat that. Read the tasks, then actually write the code.`
      continue
    }

    const v = await agent(
      `You are the INDEPENDENT verifier for the ${name} stage of ${CHANGE}, in ${REPO} on branch ${BRANCH}.\n\n` +
        `${ISOLATION}\n\n` +
        `The builder reports it changed these files:\n${changed.map((f) => `  - ${f}`).join('\n')}\n` +
        `and ticked: ${(built.tasksTicked || []).join(', ') || '(none reported)'}\n\n` +
        `## Verify, in this order\n` +
        `1. Confirm the work is REAL: \`git status --porcelain\` and \`git diff --stat\` actually show these changes. ` +
        `A builder reporting work it did not do is the failure mode to catch first.\n` +
        `2. Review the diff against this stage's brief and the change's specs. Does it do what was asked, and is it ` +
        `a root-cause fix rather than a symptom patch?\n` +
        `3. Run the FAST gates and confirm they pass:\n   ${FAST_GATES}\n` +
        (extraChecks ? `4. Stage-specific checks:\n${extraChecks}\n` : '') +
        `\n## Do NOT run\n` +
        `The full \`turbo build\`, the Playwright e2e suite, docker compose, or the compose smoke test. A single ` +
        `Integrate stage runs those once at the end, and CI re-runs everything on push. Re-running them per stage was ` +
        `the dominant cost of the previous version of this workflow.\n\n` +
        `Also confirm: docker-compose still defines exactly three services; ZQL and mutators only in packages/schema; ` +
        `UUIDv7 minted at the call site, never inside a mutator body; no hardcoded colors or fonts; no secrets logged.\n\n` +
        `If EVERYTHING passes: git add -A && git commit -s (Conventional Commit) && git push origin ${BRANCH}, and ` +
        `set passed=true.\n` +
        `If ANYTHING fails: do NOT commit, do NOT fix it yourself; set passed=false with concrete, actionable errors ` +
        `in failures[].`,
      { label: `verify:${name}`, phase: phaseName, schema: VERIFY_SCHEMA, effort: 'high' },
    )

    if (v?.passed) {
      log(`${name} verified and committed (${changed.length} files)`)
      return { passed: true, notes: v.notes, summary: built.summary }
    }
    const fails = v ? v.failures.join('\n- ') : 'verifier returned nothing'
    log(`${name} attempt ${attempt} failed: ${fails.slice(0, 160)}`)
    feedback = `\n\n## PREVIOUS ATTEMPT FAILED — fix the root cause, not the symptom\n- ${fails}\n\nRe-run the fast gates yourself before finishing.`
  }
  log(`${name} unverified after ${MAX_ATTEMPTS} attempts — continuing; Integrate and the PR review will catch it`)
  return { passed: false, notes: `${name} unverified after ${MAX_ATTEMPTS} attempts`, summary: '' }
}

// Resuming a change whose proposal already exists and whose earlier stages are already committed.
// Plan then works from the UNTICKED tasks rather than the whole file, so stopping a long build and
// restarting it on this flow costs only the work that actually remains.
const RESUME = Boolean(A.resume)

phase('Propose')
const propose = RESUME
  ? await agent(
      `${PREAMBLE}\n\n## Resume phase — no proposal to write\n` +
        `${CHANGE} was already proposed and partly built; earlier stages are committed on ${BRANCH}. Do NOT create ` +
        `or re-propose the change, and do NOT re-do completed work.\n` +
        `Establish the true state and report it:\n` +
        `1. git log --oneline ${BASE}..${BRANCH} — what has already landed.\n` +
        `2. Read openspec/changes/${CHANGE}/tasks.md and list every task still marked \`[ ]\` or \`[~]\`, by section.\n` +
        `3. Read openspec/changes/${CHANGE}/design.md, especially "## Decisions made during implementation" — ` +
        `decisions taken by the earlier stages that the remaining work must honour.\n` +
        `4. git status --porcelain must be clean; if it is not, say exactly what is uncommitted rather than ` +
        `committing it yourself.\n` +
        `5. Flag anything ticked that you cannot find evidence for in the diff — an earlier stage may have marked a ` +
        `task done without doing it, and the remaining stages would then build on a false premise.\n\n` +
        `Report: what landed, what remains (by task number), and any decisions the remaining work must respect.`,
      { label: 'resume:assess', phase: 'Propose', effort: 'high' },
    )
  : await agent(
  `${PREAMBLE}\n\n## Propose phase\nWrite the OpenSpec change artifacts for ${CHANGE}; do NOT implement anything yet.\n` +
    `1. cd ${REPO} && npx -y @fission-ai/openspec@latest new change ${CHANGE}\n` +
    `2. Read the mandatory references in your mission above, plus CLAUDE.md, PROCESS.md, VISION.md, DESIGN.md and ` +
    `openspec/specs/ (the living behavior you must not regress). Write proposal.md (with a \`Docs:\` line in the ` +
    `Impact section), design.md, the capability spec deltas, and tasks.md — including a \`## Documentation\` group ` +
    `and explicit test tasks. Templates: \`npx -y @fission-ai/openspec@latest instructions <artifact> --change ` +
    `${CHANGE} --json\`.\n` +
    `3. Validate until clean: \`npx -y @fission-ai/openspec@latest validate ${CHANGE}\` (positional, NOT --change).\n\n` +
    `**Sequence tasks.md in true dependency order** — a later stage is built directly from it, so anything a client ` +
    `stage consumes must appear in an earlier section than the stage that consumes it. Getting this wrong makes a ` +
    `downstream stage unbuildable.\n` +
    `Judge the big-feature rule honestly (PROCESS.md §3): all three tiers iff the change touches ≥2 of {synced ` +
    `entity/schema, mutator, permission surface, signature UI}. State your judgement and why; do not add e2e ` +
    `reflexively.\n\n` +
    `**Name the falsifiable check before any code exists.** In design.md, under "## How we will know this worked", ` +
    `state the single test that would FAIL against today's main and PASS once this change is correct — concretely ` +
    `enough that someone can run it. A change whose success cannot be checked should not be built autonomously; if ` +
    `that is the case here, say so and name the human decision instead of pretending it is automatable. Some things ` +
    `genuinely are not agent-checkable — whether a surface feels Linear-grade is the standing example — and those ` +
    `belong in the same section, flagged for a human, not quietly dropped.\n\n` +
    `Then commit the artifacts: git add -A && git commit -s && git push origin ${BRANCH}.\n` +
    `Report the change directory and a one-paragraph summary.`,
  { label: 'propose:write', phase: 'Propose', effort: 'high' },
)

phase('Plan')
const plan = await agent(
  `${PREAMBLE}\n\n## Plan phase\nRead ${REPO}/openspec/changes/${CHANGE}/tasks.md, proposal.md and design.md, then ` +
    `derive the IMPLEMENTATION STAGE ORDER from them. You are not writing code.\n\n` +
    (RESUME
      ? `**This is a RESUME.** Earlier stages are already committed. Plan ONLY the tasks still marked \`[ ]\` or ` +
        `\`[~]\` — never re-do completed work, and never re-open a decision an earlier stage already made and logged ` +
        `in design.md. A partially-done \`[~]\` task means only the stated remainder is in scope. If the assessment ` +
        `above flagged a task ticked without evidence, put THAT back in scope explicitly and say why.\n\n`
      : '') +
    `Group the task sections into at most ${CEILING.maxStages} build stages in true dependency order. Rules:\n` +
    `- A stage must not depend on anything a LATER stage produces. Walk the task graph and check this explicitly — ` +
    `putting a consumer before its producer is the specific mistake this phase exists to prevent.\n` +
    `- **Keep a single invariant inside a single stage, even when tasks.md splits it across sections.** Work that is ` +
    `one idea — a privacy guarantee spanning schema, query and UI; a state machine spanning server and client; a ` +
    `tightly coupled refactor — degrades badly when divided, because each builder then sees only a fragment of the ` +
    `thing it must get right. Dependency order decides what comes first; cohesion decides what must stay together, ` +
    `and cohesion wins. Prefer a larger coherent stage over two fragments of one guarantee.\n` +
    `- Exclude the sections covering tests, documentation and final verification. Those are handled by dedicated ` +
    `phases after your stages.\n` +
    `- Each stage's brief must be specific enough to hand to a builder cold: what to build, in which packages, and ` +
    `what "done" means.\n` +
    `- extraChecks: cheap, stage-specific assertions a verifier can run WITHOUT docker or e2e — a targeted unit test, ` +
    `a grep for a forbidden pattern, a schema inspection. Leave it empty rather than inventing one.\n\n` +
    `Also carry forward, from the proposal: the test-tier judgement, the falsifiable check ("## How we will know this ` +
    `worked"), and anything that needs human judgement because no agent can settle it. If the proposal failed to ` +
    `state a falsifiable check, write one now — and if the change genuinely has none, say so plainly rather than ` +
    `inventing a check that cannot fail.\n\nPrevious phase: ${propose}`,
  { label: 'plan:stages', phase: 'Plan', schema: PLAN_SCHEMA, effort: 'high' },
)

if (!plan || !plan.stages || plan.stages.length === 0) {
  throw new Error('change-build-flow: Plan phase produced no stages')
}
log(`Plan: ${plan.stages.length} stages — ${plan.stages.map((s) => s.name).join(' → ')}`)
log(`Test tiers: ${plan.testTiers}`)
log(`Falsifiable check: ${plan.falsifiableCheck || '(NONE STATED — this change cannot prove itself)'}`)
if (plan.humanJudgement) log(`Needs human judgement: ${plan.humanJudgement}`)

phase('Build')
const results = []
const skipped = []
let carry = propose
for (const s of plan.stages) {
  if (outOfBudget()) {
    skipped.push(s.name)
    log(`Budget floor reached — SKIPPING stage ${s.name} (${Math.round(budgetLeft() / 1000)}k tokens left)`)
    continue
  }
  const r = await stage(
    s.name,
    `${s.brief}\n\nThis stage covers tasks.md sections: ${s.taskSections}.\n\n` +
      `How this change proves itself: ${plan.falsifiableCheck}`,
    s.extraChecks,
    carry,
    'Build',
  )
  results.push({ name: s.name, passed: r.passed })
  carry = r.summary || r.notes
}
if (skipped.length) log(`⚠ ${skipped.length} stage(s) never ran: ${skipped.join(', ')}`)

// Stop at the ceiling rather than spending the remainder on Tests, Docs, Integrate and a full PR
// review over an incomplete branch. Returning a half-built branch with an honest account is a better
// outcome than a polished review of work that was never finished — and it resumes cleanly, because
// every completed stage is already committed and pushed.
if (outOfBudget()) {
  const unresolved = [
    ...skipped.map((n) => `stage ${n} never ran`),
    ...results.filter((r) => !r.passed).map((r) => `stage ${r.name} unverified`),
    'Tests, Docs, Integrate and Review were never reached',
  ]
  log(`⚠ BUDGET CEILING REACHED — stopping. Unresolved:\n- ${unresolved.join('\n- ')}`)
  return {
    change: CHANGE,
    stages: results,
    skipped,
    tests: false,
    docs: false,
    integrated: false,
    falsifiableCheck: plan.falsifiableCheck,
    humanJudgement: plan.humanJudgement,
    unresolved,
    stoppedBecause: `budget ceiling: fewer than ${CEILING.tokenFloor} tokens remained`,
    review: null,
    resumeHint:
      `Completed stages are committed and pushed on ${BRANCH}. Re-run with a larger budget to continue from ` +
      `${skipped[0] || 'Tests'}.`,
  }
}

phase('Tests')
const tests = await stage(
  'Tests',
  `Write the test tiers this change committed to in its proposal: ${plan.testTiers}\n` +
    `UNIT (Vitest, no DB): pure logic — validation, permission predicates, ordering/aggregation math, filter logic.\n` +
    `INTEGRATION (Vitest, live Postgres): migrations, schema drift, permission SCOPING, mutator authz end to end.\n` +
    `E2E (Playwright) only if the big-feature rule applies: keyboard flows, multi-client sync convergence.\n` +
    `Write the specs now; the Integrate phase runs them live against a real stack. Every test must be able to FAIL — ` +
    `no assertions that pass vacuously. Do not weaken any existing test.`,
  `Confirm the new tests exist and are wired into the suite, and that \`pnpm turbo run test --filter=...[origin/${BASE}]\` ` +
    `picks them up. Integration and e2e specs that need a live stack may skip here — Integrate runs them.`,
  carry,
)

phase('Docs')
const docs = await stage(
  'Docs',
  `Satisfy the docs gate and the no-stale-root-docs rule (PROCESS.md §2).\n` +
    `1. apps/docs (Astro Starlight): the user-facing pages for what this change adds, wired into the sidebar.\n` +
    `2. Update EVERY root doc this change makes stale — README.md (status + feature list), ROADMAP.md (change ` +
    `status), TECHSTACK.md (version baseline or changed decisions), .env.example (new env vars, matching the Zod ` +
    `schema exactly), and any reference/VISION/DESIGN/PROCESS doc whose content this change alters.\n` +
    `3. If you learned something about a library that the reference/ harvest got wrong, fix the reference doc. That ` +
    `is high-value and easy to skip.`,
  `\`pnpm --filter @yapm/docs build\` passes and the new pages are in the output. Cross-check .env.example against ` +
    `the Zod env schema for drift in both directions.`,
  tests.notes,
)

// The ONE expensive verification. Everything above ran fast gates; this is where docker comes up,
// the full suite runs, and the live tests execute — once, not once per stage.
phase('Integrate')
const integrate = await agent(
  `${PREAMBLE}\n\n## Integrate phase — the single full live verification\n` +
    `Every stage so far ran fast gates only. This is the one place the whole thing is proven end to end. Run all of ` +
    `it for real and never claim a pass you did not observe.\n\n` +
    `1. \`pnpm turbo typecheck lint build test\` — the FULL suite, no filter.\n` +
    `2. \`node scripts/check-boundaries.mjs\` and \`node scripts/check-catalog.mjs\`.\n` +
    `3. Bring up your isolated stack and run the live tiers against it:\n` +
    `   ${COMPOSE_ENV} ${COMPOSE} up -d --wait\n` +
    `   Run the migrations, the schema-drift test, the integration tests, and the FULL Playwright suite — this ` +
    `change's new specs plus every prior spec. Then \`${COMPOSE} down -v\`.\n` +
    `4. Confirm docker-compose still defines exactly three services.\n\n` +
    `If anything fails, FIX IT — you are the last line before review, so unlike the stage verifiers you are expected ` +
    `to repair what you find. Diagnose root causes, not symptoms. Then commit and push.\n` +
    `Report exactly which commands you ran, what failed, what you fixed, and the final state.\n\n` +
    `Stage outcomes so far: ${results.map((r) => `${r.name}=${r.passed ? 'verified' : 'UNVERIFIED'}`).join(', ')}, ` +
    `Tests=${tests.passed ? 'verified' : 'UNVERIFIED'}, Docs=${docs.passed ? 'verified' : 'UNVERIFIED'}. ` +
    `Pay particular attention to anything marked UNVERIFIED.`,
  { label: 'integrate:full', phase: 'Integrate', schema: VERIFY_SCHEMA, effort: 'high' },
)
log(`Integrate: ${integrate?.passed ? 'green' : 'RED'}`)

phase('Sync')
await agent(
  `${PREAMBLE}\n\n## Sync phase\nAnother change may have merged to ${BASE} while you were building. Bring ${BRANCH} ` +
    `up to date so the PR merges cleanly:\n` +
    `1. git fetch origin\n` +
    `2. git rebase origin/${BASE}\n` +
    `3. Resolve any conflicts. Expect them in ROADMAP.md and README.md — concurrent changes add rows in the same ` +
    `places. Keep BOTH changes' content; never drop the other change's row to make a conflict go away. If you ` +
    `conflict in a file that belongs to another change, keep THEIR version.\n` +
    `4. Re-run \`pnpm turbo typecheck lint build test\` to confirm the rebase broke nothing, then ` +
    `\`git push --force-with-lease origin ${BRANCH}\`.\n` +
    `If ${BASE} has not moved, say so and continue.`,
  { label: 'sync:rebase', phase: 'Sync', effort: 'medium' },
)

// An honest account of what this run did and did not achieve. Anything unverified, skipped, or
// unprovable is named here rather than smoothed over — a fluent summary that hides a skipped stage
// just moves the cost onto whoever reads it next.
const unresolved = [
  ...skipped.map((n) => `stage ${n} never ran (budget floor)`),
  ...results.filter((r) => !r.passed).map((r) => `stage ${r.name} unverified after ${CEILING.stageAttempts} attempts`),
  ...(tests.passed ? [] : ['Tests stage unverified']),
  ...(docs.passed ? [] : ['Docs stage unverified']),
  ...(integrate?.passed ? [] : ['Integrate did NOT go green']),
  ...(plan.falsifiableCheck ? [] : ['no falsifiable check was ever stated for this change']),
  ...(plan.humanJudgement ? [`needs human judgement: ${plan.humanJudgement}`] : []),
]

if (unresolved.length) log(`⚠ Unresolved going into review:\n- ${unresolved.join('\n- ')}`)

phase('Review')
log('Handing off to the PR-review flow...')
const review = await workflow(
  { scriptPath: `${REPO}/.claude/workflows/pr-review-flow.js` },
  {
    branch: BRANCH,
    base: BASE,
    changeName: CHANGE,
    prTitle: A.prTitle || CHANGE,
    repoDir: REPO,
    knownUnresolved: unresolved,
    falsifiableCheck: plan.falsifiableCheck,
  },
)

return {
  change: CHANGE,
  stages: results,
  skipped,
  tests: tests.passed,
  docs: docs.passed,
  integrated: Boolean(integrate?.passed),
  falsifiableCheck: plan.falsifiableCheck,
  humanJudgement: plan.humanJudgement,
  unresolved,
  stoppedBecause: skipped.length ? 'budget floor reached before all stages ran' : 'completed all planned stages',
  review,
}
