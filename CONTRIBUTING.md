# Contributing to yapm

Thanks for considering it. yapm is pre-alpha — the fastest way to help right now is to read
[VISION.md](VISION.md) and open a discussion about anything that seems wrong.

## Ground rules

Everything in yapm is open. There is no enterprise edition, no paid tier of features, and no
plan for one. Contributions that add seat limits, license-key gates, or upsell UI to the
self-hosted product will be declined — that constraint is the product.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. This certifies you wrote the patch or have the right to
submit it under AGPL-3.0 — see [developercertificate.org](https://developercertificate.org/).

```bash
git commit -s -m "feat: add thing"
```

That appends `Signed-off-by: Your Name <your@email.com>` to the message. We use a DCO instead
of a CLA on purpose: it means yapm **cannot** be relicensed without every contributor
agreeing. Your contribution is permanently safe from a rug-pull.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`,
`chore:`, `refactor:`, `test:`. Release notes are generated from them, so write the subject
for someone reading a changelog.

## Spec-driven development

Behavior and schema changes go through [OpenSpec](https://github.com/Fission-AI/OpenSpec)
before implementation. Specs live in `openspec/`:

- `openspec/specs/` — living specs: what the system does today
- `openspec/changes/<name>/` — in-flight work: proposal, design, specs, tasks

The threshold: **user-visible behavior or schema changes get a spec; mechanical changes
don't.** Fixing a typo or renaming a variable does not need a proposal.

If you're implementing an existing change, work through its `tasks.md` in order — they're
sequenced so the app runs after every task.

## Development

**Requirements:** Node 24 LTS, Corepack enabled, Docker.

```bash
pnpm install
pnpm dev          # starts Postgres + zero-cache, server, and web — one command
```

Before pushing:

```bash
pnpm turbo lint typecheck test build
```

Git hooks (lefthook) run formatting and commit checks automatically.

## Architecture rules

These are enforced in CI, not just aspirational:

- Packages never import from apps. `packages/schema` has no UI dependencies.
- **All Zero queries (ZQL) and mutators live in `packages/schema`** — client and server import
  the same mutator function. This keeps the sync layer swappable and the write path honest.
- Dependency versions are declared once in the pnpm catalog (`pnpm-workspace.yaml`). Don't put
  literal versions in a package's `package.json`.
- No tools that import the TypeScript Compiler API — it doesn't exist in the TS7 native build.
- Self-hosting stays at three containers. A change that needs Redis, Elasticsearch, or object
  storage to function needs a very good argument.

## Performance budget

Interactions target under 100ms. If a change makes a common interaction wait on the network
that didn't before, that's a bug, not a tradeoff.

## Reporting bugs

Include what you expected, what happened, and how to reproduce it. For anything
security-related, see [SECURITY.md](SECURITY.md) — don't open a public issue.
