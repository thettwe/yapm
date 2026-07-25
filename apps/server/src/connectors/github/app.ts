import { App } from 'octokit'
import type { GithubAppEnv } from '../../config/env.js'
import type { GithubConnectorSecrets } from './connector.js'
import type { GithubRestClient } from './reconcile.js'

// The app-level GitHub client. `App` wraps `@octokit/auth-app`, so per-installation tokens are
// minted on demand and cached in memory — never persisted (reference §1.1).
export interface GithubApp {
  installationClient(externalInstallationId: string): Promise<GithubRestClient>
}

export function githubSecretsFromEnv(env: GithubAppEnv): GithubConnectorSecrets {
  return {
    appId: env.appId,
    privateKey: env.privateKey,
    webhookSecret: env.webhookSecret,
  }
}

// Builds the octokit `App` from the env triplet. The webhook secret is wired in so the App's
// own verifier stays consistent with the standalone `verifySignature` path.
export function createGithubApp(secrets: GithubConnectorSecrets): GithubApp {
  const app = new App({
    appId: secrets.appId,
    privateKey: secrets.privateKey,
    webhooks: { secret: secrets.webhookSecret },
  })

  return {
    installationClient: async (externalInstallationId) => {
      const octokit = await app.getInstallationOctokit(Number(externalInstallationId))
      return octokit as unknown as GithubRestClient
    },
  }
}
