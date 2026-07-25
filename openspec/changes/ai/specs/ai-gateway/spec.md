## ADDED Requirements

### Requirement: Provider-agnostic BYO-key gateway behind a thin wrapper

The system SHALL provide a provider-agnostic AI gateway wrapping the Vercel AI SDK v7 (`ai`, with the Anthropic, Google, and OpenAI adapters — all AGPL-compatible) behind a narrow yapm seam exposing exactly three operations: `resolveModel(workspaceId, provider?)` (resolve the workspace's configured provider + model, returning a constructed language model or null when AI is disabled), `generateStructured(workspaceId, userCtx, { system, input, schema })` (a grounded typed structured-output call), and `runAgent(workspaceId, userCtx, { system, messages, tools, activeTools })` (a tool-calling loop bounded by a step limit). All AI-SDK calls and the decrypted provider key SHALL live in `apps/server`; the typed output schemas, tool-registry types, and query shapes SHALL live in `packages/schema` with no UI or SDK dependency. The gateway SHALL support text, tool-calling, and typed structured output uniformly across all three providers.

Work-graph placement: an off-graph server seam to the model providers; it holds no synced rows. Permission story: every gateway call carries the invoking user's `AuthContext`; the decrypted key exists only in server memory for the duration of one call and never reaches a client.

#### Scenario: One call shape across providers

- **WHEN** a workspace is configured for Anthropic, Google, or OpenAI
- **THEN** the same `generateStructured` / `runAgent` call produces typed output / a bounded tool loop regardless of which provider is configured, with only the resolved model differing

#### Scenario: SDK calls stay server-side

- **WHEN** the web bundle is built
- **THEN** no AI-SDK package and no provider key is present in it; all model calls and key decryption occur only in `apps/server`

### Requirement: Per-workspace BYO-key config reuses the connector secrets surface

The system SHALL configure AI per workspace by reusing the existing server-only connector secrets/config surface — adding **no** new table, crypto, or container. A single `connector_config` row per workspace with `provider = "ai"` SHALL hold the master enabled flag and a non-secret config blob (default provider, per-provider model, optional spend cap); each provider's API key SHALL be stored as a `connector_secret` under that config (`key` naming the provider), AES-256-GCM-encrypted at rest with the existing `SECRETS_ENCRYPTION_KEY`, held in a table excluded from the Zero schema, decrypted only in `apps/server`, and never logged or synced. A provider language model SHALL be constructed per request from the decrypted secret, never from a cached or browser-reachable value.

Work-graph placement: reuses the off-graph, server-only connector surface; the AI key is never a synced work-graph row. Permission story: server-only and admin-gated; the key never enters a Zero-synced query or the SPA bundle.

#### Scenario: AI key never enters a synced query

- **WHEN** any client requests any synced query
- **THEN** no AI provider key or ciphertext is ever returned, because the AI secret rows live in the server-only connector table excluded from the Zero schema

#### Scenario: Adds no new secret store

- **WHEN** AI is configured for a workspace
- **THEN** its config is a `provider = "ai"` `connector_config` row and its keys are `connector_secret` rows, with no new AI-specific table, crypto, or container introduced

#### Scenario: Key is decrypted only per call

- **WHEN** the gateway needs a provider key
- **THEN** it is decrypted into server memory for that single call and never persisted in plaintext, logged, or cached in a client-reachable place

### Requirement: Admin AI settings surface

The system SHALL provide an admin-only (`canManage`) AI settings surface over the existing server-only admin REST surface to: toggle AI on/off for the workspace; enter a provider API key (write-only, shown masked, never returned); choose a model per configured provider and a workspace default provider; and set an optional spend cap. A non-admin SHALL NOT see or mutate AI settings. The surface SHALL be fully keyboard-operable and rendered strictly from theme tokens (correct in all three presets in light and dark), with no hardcoded colors or fonts.

Work-graph placement: an admin configuration view over the off-graph AI config. Permission story: admin-gated reads and writes; key material never leaves the server and is never displayed.

#### Scenario: Admin configures a provider

- **WHEN** an admin enables AI, enters a provider key, and selects a model
- **THEN** the config and encrypted key are stored via the server-only surface, the key is shown masked and never echoed back, and the provider becomes available to AI features

#### Scenario: Non-admin cannot access AI settings

- **WHEN** a member or viewer navigates to AI settings
- **THEN** the surface is not offered and any config/key request is rejected

#### Scenario: Settings are keyboard-operable across themes

- **WHEN** an admin configures AI using only the keyboard in each preset in light and dark
- **THEN** every control is reachable and operable without a pointer and renders from tokens with no hardcoded values

### Requirement: Absent AI configuration disables AI cleanly

AI SHALL be enabled for a workspace only when it is toggled on and at least one provider key is available (via the admin UI or an optional instance-default env var); otherwise AI SHALL be disabled. When AI is disabled — the toggle is off, no key is configured, a provider outage occurs, or a spend cap is hit — no agent tools SHALL mount, the AI UI SHALL be hidden or show a "not configured" state naming the variables to set, every consumer SHALL render its AI-off fallback, and boot SHALL NOT crash. Optional AI env vars SHALL be Zod-validated; a malformed value SHALL fail fast by name where validated at boot, and a per-workspace key that is malformed SHALL fail at use (not boot), never silently.

Work-graph placement: gates whether the gateway is constructed at all. Permission story: unchanged — a disabled AI writes nothing.

#### Scenario: No AI config boots cleanly with AI off

- **WHEN** no AI env vars are set and no workspace has configured a key
- **THEN** the app boots normally, AI is disabled, no agent tools mount, and every AI surface shows its AI-off state

#### Scenario: Provider absent from the picker without a key

- **WHEN** a workspace has enabled AI but has no key for a given provider
- **THEN** that provider is simply absent from the model picker, never paywalled or errored

#### Scenario: Disabled AI degrades, never blocks

- **WHEN** AI is toggled off or a spend cap is hit
- **THEN** the consuming surface renders its raw-evidence fallback and no interaction is blocked

### Requirement: Volatile model resolution and spend surfacing

The system SHALL treat model IDs and prices as runtime configuration, never hardcoded constants: the admin selects a model per provider (validated against the provider's live model list where available), and a small, updatable server-side model+price table SHALL drive spend estimation. Every run SHALL surface an estimated per-run cost (usage × price, labeled "estimated") and accumulate a per-workspace running total; an optional spend cap SHALL refuse to start a run that would exceed it. A new workspace SHALL default to a cheap/fast model.

Work-graph placement: off-graph cost accounting for AI runs. Permission story: cost totals are workspace-scoped; the price table is server-side and operator-updatable.

#### Scenario: Cost is estimated and labeled

- **WHEN** an AI run completes
- **THEN** its estimated cost is computed from normalized token usage × the server-side price table, displayed labeled "estimated," and added to the workspace running total

#### Scenario: Spend cap refuses a run

- **WHEN** a workspace has a spend cap and the running total is at or above it
- **THEN** a new run is refused before it starts and the consumer takes its AI-off path

#### Scenario: Model IDs are never hardcoded

- **WHEN** provider model offerings change
- **THEN** the configured model and its price are read from runtime config and the updatable table, with no code change required to name a model
