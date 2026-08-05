// Minimal structural subsets of the GitHub webhook payloads yapm reads. The connector only
// touches the fields below, so hand-rolling these keeps the mapping honest and independent of
// octokit's generated union types (whose exact shape shifts across versions). Every mapped
// event carries `repository` and `installation`; the worker uses those to resolve team + scope.

export interface GithubRepository {
  full_name: string
}

export interface GithubAccount {
  login?: string
}

export interface GithubInstallationRef {
  id: number
}

export interface GithubPullRequest {
  id: number
  number: number
  title?: string | null
  state: string
  draft?: boolean
  merged?: boolean
  merged_at?: string | null
  // Before a merge this is the SHA of a *test* merge commit; after one it is the commit the merge
  // actually produced (merge, squash, or rebase). Only the merged case is joined against a
  // deployment's sha, so the pre-merge value is stored and simply never matches.
  merge_commit_sha?: string | null
  html_url?: string | null
  body?: string | null
  created_at?: string | null
  updated_at?: string | null
  head?: { sha?: string | null; ref?: string | null } | null
}

export interface PullRequestEvent {
  action: string
  number: number
  pull_request: GithubPullRequest
  repository: GithubRepository
  installation?: GithubInstallationRef
}

export interface GithubReview {
  id: number
  state: string
  submitted_at?: string | null
  user?: GithubAccount | null
}

export interface PullRequestReviewEvent {
  action: string
  review: GithubReview
  pull_request: GithubPullRequest
  repository: GithubRepository
  installation?: GithubInstallationRef
}

export interface GithubCheckRun {
  id: number
  name?: string | null
  status: string
  conclusion?: string | null
  head_sha: string
  started_at?: string | null
  completed_at?: string | null
  pull_requests?: { id: number }[]
}

export interface CheckRunEvent {
  action: string
  check_run: GithubCheckRun
  repository: GithubRepository
  installation?: GithubInstallationRef
}

export interface GithubCheckSuite {
  id: number
  status: string
  conclusion?: string | null
  head_sha: string
  updated_at?: string | null
  pull_requests?: { id: number }[]
}

export interface CheckSuiteEvent {
  action: string
  check_suite: GithubCheckSuite
  repository: GithubRepository
  installation?: GithubInstallationRef
}

export interface DeploymentStatusEvent {
  deployment: {
    id: number
    ref?: string | null
    environment?: string | null
    sha?: string | null
  }
  deployment_status: {
    state: string
    environment?: string | null
    created_at?: string | null
    updated_at?: string | null
  }
  repository: GithubRepository
  installation?: GithubInstallationRef
}

export interface InstallationEvent {
  action: string
  installation: { id: number; account?: GithubAccount | null }
  repositories?: { full_name: string }[]
}

export function repositoryFullName(payload: unknown): string | null {
  const repo = (payload as { repository?: GithubRepository } | null)?.repository
  return repo?.full_name ?? null
}
