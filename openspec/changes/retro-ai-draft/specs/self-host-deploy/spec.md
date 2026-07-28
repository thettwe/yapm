## MODIFIED Requirements

### Requirement: The AI layer adds no container and runs in-process

Adding the AI layer SHALL NOT change the three-container contract: all model calls SHALL run in-process inside the existing `yapm` app container via the AI SDK, and every AI pre-compute SHALL run on the existing pg-boss on the existing Postgres — it MUST NOT introduce Redis, a vector store, an inference service, a queue service, or any other required container. AI is BYO-key: the provider (Anthropic/Google/OpenAI) is an optional external integration the operator or an admin configures by env or the admin UI, not a service yapm ships or a capability yapm paywalls. Any AI provider key stored in Postgres SHALL reuse the existing server-only, AES-256-GCM encrypted connector secret surface (never a new store), SHALL never replicate to clients, and SHALL never be logged.

**Each AI consumer SHALL be an independently gated block on the one shared job runner.** A second consumer SHALL NOT construct a second job-runner instance or call its start routine a second time, and SHALL be switchable instance-wide by its own optional environment variable, so that disabling one consumer never silently disables another. Any such variable SHALL be Zod-validated at boot and documented, and its absence SHALL leave a safe default.

Work-graph placement: deployment/config surface for the AI pipeline. Permission story: AI keys are server-only, admin-gated, never synced or logged; the model call carries the invoking user's context.

#### Scenario: Container count is unchanged

- **WHEN** the compose file is inspected
- **THEN** it still defines exactly three services (`yapm`, `zero-cache`, `postgres`) and requires no inference, cache, vector, or queue container for AI

#### Scenario: AI runs within the existing app process

- **WHEN** an admin configures a provider key and a cycle closes
- **THEN** the digest is pre-computed by an in-process AI-SDK call on the existing pg-boss, with no new container

#### Scenario: AI keys reuse the encrypted connector surface

- **WHEN** a provider key is entered via the admin UI
- **THEN** it is stored AES-256-GCM-encrypted in the existing server-only connector secret table, never synced, and never logged

#### Scenario: A second AI consumer adds no runner

- **WHEN** a second AI consumer is registered
- **THEN** it is one more block on the existing job runner with no second instance and no second start call, and the container count is unchanged

#### Scenario: Consumers are switched independently

- **WHEN** the operator disables one AI consumer by its environment variable
- **THEN** the other AI consumers continue to run, and disabling all of them leaves the app booting cleanly with no AI job registered
