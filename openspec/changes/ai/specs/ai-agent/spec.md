## ADDED Requirements

### Requirement: Agent-as-actor — tools are mutators under the invoking user's ceiling

The system SHALL model the AI as an actor that reads via the same named Zero queries and acts via the same shared mutators as a human, under the invoking user's `AuthContext`. One AI-SDK tool SHALL be generated per yapm mutator from `defineMutators`, with the tool's `inputSchema` being the mutator's existing exported Zod args schema — no parallel schema — so the model can never call anything a human could not. Each tool's `execute` SHALL invoke the same mutator function the human UI calls, passing an `AuthContext` derived from the invoking user, so the workspace role is an automatic ceiling: a viewer's agent SHALL be rejected for every write, a member's agent SHALL be able to write but not manage. Identity fields SHALL be taken from `ctx`, never from model output. Reads SHALL be exposed as read-only tools over the named queries, each running under `ctx` so out-of-scope rows are masked. Any agent-created row's UUIDv7 SHALL be minted at the tool `execute` call site, never inside a mutator body.

Work-graph placement: the agent writes/reads through the same mutators and queries as humans; it introduces no separate write path. Permission story: the invoking user's role is the ceiling — there is no separate "agent permission" system.

#### Scenario: Viewer's agent cannot write

- **WHEN** an agent runs under a viewer's `AuthContext` and attempts a write tool
- **THEN** the underlying mutator's authorization check rejects it, so the agent can read but not mutate

#### Scenario: The model can only call human-reachable mutators

- **WHEN** the tool registry is generated
- **THEN** it contains exactly one tool per defined mutator with the mutator's own Zod args schema, and no tool exists for an operation a human could not perform

#### Scenario: Identity comes from context, not the model

- **WHEN** a tool `execute` runs a mutator
- **THEN** owner/creator/identity fields are set from the invoking user's `ctx`, ignoring any identity the model supplied in the tool input

### Requirement: Human-in-the-loop approval for agent writes

Write and destructive agent tools SHALL default to requiring human approval: the tool-calling loop SHALL pause on an approval request that the invoking user confirms in-UI before the mutation runs, while read tools auto-run. Agent runs SHALL use a least-privilege tool set per task (only the tools the task needs are active), SHALL run server-side, SHALL be bounded by a step limit, and every agent-initiated mutation SHALL be audited (actor = agent, on-behalf-of = the invoking user). Agent writes SHALL never be auto-applied without approval.

Work-graph placement: gates the agent's write path onto the shared mutators. Permission story: a fully injected agent's worst case is a bad paragraph, never a bad action, because writes require human approval and the run is bounded and audited.

#### Scenario: A write tool surfaces an approval request

- **WHEN** an agent decides to call a write/destructive tool
- **THEN** the loop pauses on an approval request and the mutation runs only after the user confirms it in-UI

#### Scenario: Reads auto-run, writes wait

- **WHEN** an agent run mixes read and write tool calls
- **THEN** read tools execute automatically and every write tool waits for approval

#### Scenario: Least-privilege tool set

- **WHEN** a read-only task (e.g. summarizing a cycle) runs
- **THEN** only read tools are active and no management or write tool is reachable in that run

#### Scenario: Bounded and audited

- **WHEN** an agent loop runs
- **THEN** it stops at the configured step limit and every agent-initiated mutation is recorded with the agent as actor and the invoking user as on-behalf-of

### Requirement: Grounded, cite-evidence-or-omit typed output substrate

The system SHALL provide a shared AI-over-work-graph substrate that every AI feature reuses: a team-scoped narrowed query feeds a grounded structured-output call whose result is a Zod-typed object of sections and per-item `{ kind, summary, evidenceRefs[], confidence }`. A deterministic validator SHALL drop any item whose `evidenceRefs` is empty (cite-evidence-or-omit), so a claim the model cannot attach to a linked work-graph signal is never emitted. Every emitted item SHALL link its work-graph entity (issue, PR, check, or deploy) — never raw code — so the reader can open and verify it. Consequential numbers (counts, CI conclusions, medians) SHALL be computed by yapm, and the model SHALL only narrate them; each item SHALL carry a confidence flag. Every consumer SHALL provide a graceful AI-off fallback that renders the raw linked evidence when AI is disabled, keyless, in outage, or spend-capped.

Work-graph placement: a read-and-summarize pipeline over the linked work graph; it produces typed artifacts that reference existing synced entities. Permission story: the query is team-scoped and runs under the caller's context; output references only entities the reader can already open.

#### Scenario: Uncited item is dropped

- **WHEN** the model emits an output item with no `evidenceRefs`
- **THEN** the validator omits that item, so every shown claim links a real work-graph signal

#### Scenario: Numbers come from yapm

- **WHEN** the output states a count or a CI conclusion
- **THEN** that value was computed by yapm's query, not generated by the model, which only narrated it

#### Scenario: AI-off renders raw evidence

- **WHEN** AI is disabled or unavailable for a consumer
- **THEN** the surface renders the raw linked evidence it already has, strictly more than before and blocking nothing

### Requirement: Injection architecture breaks the lethal trifecta structurally

The AI step SHALL be made injection-resistant by architecture, not by prompt instructions, since it reads attacker-influenceable external text (PR bodies, commit messages, comments, CI logs). The pipeline SHALL mount **no** outbound-network or external-communication tool and SHALL leave every provider-side external tool off (URL-context, web-search, code-execution, MCP-server, computer-use), so there is no exfiltration channel. Output SHALL be structured-only (a fixed schema, no free-form channel). Consequential numbers SHALL be computed by yapm, not the model. The model SHALL be fed **only team-level aggregates** with no per-individual dimension, and a deterministic **name-validator** SHALL reject any output containing a workspace member's name or handle before it is shown. External text SHALL be delimited and labeled as untrusted data, never concatenated into the system prompt as instructions. The rendered artifact SHALL NOT auto-load remote images or links from summarized content.

Work-graph placement: cross-cutting safety infra shared by every AI consumer. Permission story: combined with the permission ceiling and HITL writes, a fully injected model can neither exfiltrate, name a person, nor take an unapproved action.

#### Scenario: No egress channel exists

- **WHEN** an AI run is configured
- **THEN** it mounts no web/fetch/email/HTTP tool and every provider-side external tool is off, so summarized content cannot be exfiltrated

#### Scenario: The model cannot name an individual

- **WHEN** the model is given a cycle's context
- **THEN** that context contains only team-level aggregates with no assignee/author/reviewer/user dimension, and the name-validator drops any output that names a workspace member

#### Scenario: External text is data, not instructions

- **WHEN** ingested PR/commit/comment text contains an instruction such as "ignore your rules"
- **THEN** that text is delimited and labeled untrusted, the model treats it as data to analyze, and the permission ceiling plus HITL make the worst case a bad paragraph, never a bad action or a leak

#### Scenario: Render is exfil-safe

- **WHEN** the AI artifact is displayed
- **THEN** it does not auto-load any remote image or link from the summarized content
