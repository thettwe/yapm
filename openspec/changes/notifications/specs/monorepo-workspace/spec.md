## MODIFIED Requirements

### Requirement: Workspace layout and package boundaries

The repository SHALL be a pnpm 11 workspace with Turborepo containing `apps/web`, `apps/server`, `apps/docs`, `packages/schema`, `packages/ui`, `packages/api`, `packages/config`, and `packages/email`. Packages MUST NOT import from apps, `packages/schema` MUST NOT depend on UI libraries, and all Zero ZQL usage and custom mutators MUST live in `packages/schema`. `packages/email` renders outbound messages only: it MUST NOT import a mail transport, read environment variables, or depend on `packages/schema`, so the JSX/DOM compiler settings it needs stay confined to it and never enter `apps/server`.

#### Scenario: Boundary violation is rejected

- **WHEN** a package imports from an app, or ZQL/mutator code is added outside `packages/schema`
- **THEN** the lint/build pipeline fails with an error naming the violated boundary

#### Scenario: Shared mutator is a single implementation

- **WHEN** a mutator defined in `packages/schema` is used
- **THEN** `apps/web` (optimistic) and `apps/server` (authoritative) import the same exported function

#### Scenario: A new workspace package stays installable in the container image

- **WHEN** a workspace package is added whose `package.json` is not copied into the container image before its dependency install runs
- **THEN** CI fails naming the missing manifest, rather than the image building an incomplete `node_modules` and failing later on an unresolvable import
