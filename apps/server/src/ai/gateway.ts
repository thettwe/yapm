import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { AiProvider, AuthContext } from '@yapm/schema'
import { type DB, getAiConfig, getAiProviderKey, type SecretCodec } from '@yapm/schema/db'
import {
  generateObject,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  stepCountIs,
  type ToolSet,
} from 'ai'
import type { Kysely } from 'kysely'
import type { z } from 'zod'
import type { AiEnv } from '../config/env.js'
import {
  DEFAULT_MODEL_CATALOG,
  DEFAULT_MODELS,
  estimateCostUsd,
  exceedsSpendCap,
  type ModelCatalog,
} from './model-catalog.js'

// The gateway is the ONE swappable seam over the Vercel AI SDK (reference/ai-providers.md §2c):
// all `ai`-package calls and the decrypted key live here in `apps/server`; feature code sees only
// `resolveModel` / `generateStructured` / `runAgent`. The BYO-key is constructed per request from
// the decrypted secret and never cached, never placed anywhere browser-reachable.

// Refused before starting a run because the workspace's estimated spend has hit its cap.
export class AiSpendCapError extends Error {
  readonly capUsd: number
  readonly spentUsd: number
  constructor(spentUsd: number, capUsd: number) {
    super(`AI spend cap reached: estimated $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`)
    this.name = 'AiSpendCapError'
    this.capUsd = capUsd
    this.spentUsd = spentUsd
  }
}

// Constructs a provider-specific `(modelId) => LanguageModel` from a decrypted key. Overridable so
// tests inject the SDK mock provider (no live call, no key) — mirrors the connectors mocked-GitHub
// strategy.
export type ModelFactory = (
  provider: AiProvider,
  apiKey: string,
) => (modelId: string) => LanguageModel

const defaultModelFactory: ModelFactory = (provider, apiKey) => {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })
    case 'google':
      return createGoogleGenerativeAI({ apiKey })
    case 'openai':
      return createOpenAI({ apiKey })
  }
}

export interface AiGatewayDeps {
  db: Kysely<DB>
  // Absent when SECRETS_ENCRYPTION_KEY is unset — UI-entered keys cannot be decrypted, so only
  // instance-default env keys are usable and the AI UI names the missing var.
  codec: SecretCodec | null
  env: AiEnv
  catalog?: ModelCatalog
  modelFactory?: ModelFactory
}

export interface ResolvedModel {
  model: LanguageModel
  provider: AiProvider
  modelId: string
}

export interface SpendInfo {
  usage: LanguageModelUsage
  provider: AiProvider
  modelId: string
  // ESTIMATED USD (usage × the volatile price table), or null when the model's price is unknown.
  estimatedCostUsd: number | null
}

export interface StructuredResult<T> extends SpendInfo {
  object: T
}

export interface AgentResult extends SpendInfo {
  text: string
  steps: number
}

export interface GenerateStructuredOptions<T> {
  system: string
  // The (delimited, untrusted) input the model summarizes. Trusted operator authority is `system`.
  input: string | ModelMessage[]
  schema: z.ZodType<T>
  provider?: AiProvider
  // The workspace's estimated spend so far; the run is refused if the optional cap is already hit.
  spendSoFarUsd?: number
}

export interface RunAgentOptions {
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  activeTools?: string[]
  provider?: AiProvider
  maxSteps?: number
  spendSoFarUsd?: number
}

export interface AiGateway {
  resolveModel(workspaceId: string, provider?: AiProvider): Promise<ResolvedModel | null>
  generateStructured<T>(
    workspaceId: string,
    userCtx: AuthContext,
    options: GenerateStructuredOptions<T>,
  ): Promise<StructuredResult<T> | null>
  runAgent(
    workspaceId: string,
    userCtx: AuthContext,
    options: RunAgentOptions,
  ): Promise<AgentResult | null>
}

const DEFAULT_MAX_STEPS = 8

export function createAiGateway(deps: AiGatewayDeps): AiGateway {
  const catalog = deps.catalog ?? DEFAULT_MODEL_CATALOG
  const modelFactory = deps.modelFactory ?? defaultModelFactory

  // Pick the provider for a run: explicit arg > workspace default > instance (env) default.
  function pickProvider(
    requested: AiProvider | undefined,
    configuredDefault: AiProvider | null,
  ): AiProvider | null {
    return requested ?? configuredDefault ?? deps.env.defaultProvider ?? null
  }

  // The API key for a provider: the per-workspace UI-entered key first (needs the codec), then the
  // instance-default env key. Null when neither exists.
  async function resolveKey(workspaceId: string, provider: AiProvider): Promise<string | null> {
    if (deps.codec) {
      const uiKey = await getAiProviderKey(deps.db, deps.codec, workspaceId, provider)
      if (uiKey) return uiKey
    }
    return deps.env.keys[provider] ?? null
  }

  async function resolveModel(
    workspaceId: string,
    provider?: AiProvider,
  ): Promise<ResolvedModel | null> {
    const config = await getAiConfig(deps.db, workspaceId)
    // Master toggle off / never configured ⇒ AI disabled for this workspace. But an env-level
    // instance default (single-instance self-host) still enables it without a DB row.
    const hasEnvDefault = deps.env.defaultProvider !== null
    // An explicit config row wins: a toggled-off workspace is off regardless of any env default;
    // only a NEVER-configured workspace (no row) can be enabled by an instance env default.
    if (config) {
      if (!config.enabled) return null
    } else if (!hasEnvDefault) {
      return null
    }

    const chosen = pickProvider(provider, config?.data.defaultProvider ?? null)
    if (!chosen) return null

    const apiKey = await resolveKey(workspaceId, chosen)
    if (!apiKey) return null

    const modelId = config?.data.models[chosen] ?? DEFAULT_MODELS[chosen]
    const model = modelFactory(chosen, apiKey)(modelId)
    return { model, provider: chosen, modelId }
  }

  // The optional spend cap: refuse to START a run once the running total hits it.
  async function assertUnderCap(
    workspaceId: string,
    spendSoFarUsd: number | undefined,
  ): Promise<void> {
    if (spendSoFarUsd === undefined) return
    const config = await getAiConfig(deps.db, workspaceId)
    const cap = config?.data.spendCapUsd ?? null
    if (exceedsSpendCap(spendSoFarUsd, cap)) {
      throw new AiSpendCapError(spendSoFarUsd, cap ?? 0)
    }
  }

  async function generateStructured<T>(
    workspaceId: string,
    _userCtx: AuthContext,
    options: GenerateStructuredOptions<T>,
  ): Promise<StructuredResult<T> | null> {
    const resolved = await resolveModel(workspaceId, options.provider)
    if (!resolved) return null
    await assertUnderCap(workspaceId, options.spendSoFarUsd)

    // Structured output only, NO tools, and every provider-side external tool left off (no
    // urlContext/googleSearch/codeExecution/mcpServers/computerUse) — the injection architecture's
    // no-egress + structured-only legs are structural here, not a prompt instruction.
    const result = await generateObject({
      model: resolved.model,
      schema: options.schema,
      system: options.system,
      ...(typeof options.input === 'string'
        ? { prompt: options.input }
        : { messages: options.input }),
    })

    return {
      object: result.object as T,
      usage: result.usage,
      provider: resolved.provider,
      modelId: resolved.modelId,
      estimatedCostUsd: estimateCostUsd(catalog, resolved.provider, resolved.modelId, result.usage),
    }
  }

  async function runAgent(
    workspaceId: string,
    _userCtx: AuthContext,
    options: RunAgentOptions,
  ): Promise<AgentResult | null> {
    const resolved = await resolveModel(workspaceId, options.provider)
    if (!resolved) return null
    await assertUnderCap(workspaceId, options.spendSoFarUsd)

    const result = await generateText({
      model: resolved.model,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      ...(options.activeTools ? { activeTools: options.activeTools } : {}),
      stopWhen: stepCountIs(options.maxSteps ?? DEFAULT_MAX_STEPS),
    })

    return {
      text: result.text,
      steps: result.steps.length,
      usage: result.usage,
      provider: resolved.provider,
      modelId: resolved.modelId,
      estimatedCostUsd: estimateCostUsd(catalog, resolved.provider, resolved.modelId, result.usage),
    }
  }

  return { resolveModel, generateStructured, runAgent }
}
