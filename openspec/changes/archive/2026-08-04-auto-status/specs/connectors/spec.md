## MODIFIED Requirements

### Requirement: Provider-neutral connector framework

The system SHALL define a provider-neutral `ConnectorDefinition` interface in `packages/schema` that isolates the three provider-specific concerns — auth/config (a Zod `configSchema` for non-secret settings, a Zod `secretSchema` for encrypted settings, and a `verifySignature(raw, headers, secrets)`), synchronous ingest (`parseDelivery(raw, headers)` returning an installation key, event type, delivery id, and payload), and asynchronous ingest/reconcile (`ingest(event, ctx)` and `reconcile(installation, ctx)`) — each returning a provider-neutral `WorkGraphMutation[]`. The `WorkGraphMutation` union SHALL be the only shape feature code consumes, so a second connector (e.g. GitLab) can be added by implementing the interface with **no** change to reality-strip, divergence, **status-automation**, query, or row code. GitHub SHALL be the single v1 implementation of this interface; its octokit/webhook code SHALL live in `apps/server` and SHALL call shared mutators, never raw ZQL.

The union's pull-request variant SHALL additionally be the sole trigger for opt-in status automation: the decision to transition a linked issue SHALL be taken in `packages/schema` from that variant's state, its own source timestamp, and the rows it names — never from a provider payload — so the automation is inherited by any connector that emits it. The connector SHALL NOT write anything back to the provider as a result of a transition, and SHALL NOT require an additional provider permission scope.

Work-graph placement: the interface and `WorkGraphMutation` union define the write path into the linked delivery entities, and now also the trigger for the derived issue-status write. Permission story: every `WorkGraphMutation` is applied through the existing shared server mutators, so connector writes obey the same server-side authorization as human writes; the derived status write goes through the shared issue status mutator under a system principal subject to that mutator's own checks.

#### Scenario: A connector produces only WorkGraphMutations

- **WHEN** a delivery is ingested by any connector
- **THEN** its effect on the work graph is expressed solely as a `WorkGraphMutation[]`, applied through the shared mutators, with no provider-specific write path

#### Scenario: A second connector needs no feature-code change

- **WHEN** a new provider is added by implementing `ConnectorDefinition`
- **THEN** the reality strip, divergence, status automation, queries, and rows are unchanged because they depend only on the `WorkGraphMutation` union and the synced entities, not on the provider

#### Scenario: Connector code does not leak ZQL

- **WHEN** the GitHub connector writes to the work graph
- **THEN** it invokes shared mutators (not raw ZQL), keeping the sync layer swappable

#### Scenario: Provider-specific code is unaware of status automation

- **WHEN** the GitHub connector's mapping, worker, and reconciliation code is inspected
- **THEN** it contains no reference to issue status, to the team automation setting, or to any transition, because the decision lives entirely behind the mutation union

### Requirement: Admin connector settings and status

The system SHALL provide an admin-only connector settings surface to enable/configure the GitHub connector and view its connection and installation status (enabled flag, installation id, repo→team mapping, last sync/error), served over a server-only admin REST surface that returns redacted status and never the secret material. The same surface SHALL additionally offer a **per-team status-automation** section listing each team with its current automation state and a control to enable or disable it, together with copy stating which transitions fire, that automation never moves an issue backward and never touches Canceled or untriaged issues, and that enabling it does not change existing issues. Unlike the connector's own configuration, the automation setting is a synced column on `team` written through the shared admin-gated mutator, so the control is optimistic and costs no round trip. The surface SHALL be fully keyboard-operable and rendered strictly against theme tokens (correct in all three presets in light and dark). A non-admin SHALL NOT see or mutate connector settings or the automation setting.

Work-graph placement: an admin configuration view over the off-graph connector surface, plus the on-graph `team` automation column. Permission story: admin-gated reads and writes; secrets never leave the server; the automation column is readable by any member through the existing team sync scope but writable only by an admin.

#### Scenario: Admin views connection status

- **WHEN** an admin opens the connector settings
- **THEN** the connection state, installation id, and repo→team mapping are shown, with no secret material displayed

#### Scenario: Admin toggles status automation for one team

- **WHEN** an admin activates the automation control for one team
- **THEN** only that team's automation state changes, and it is visible as enabled immediately without waiting for a round trip

#### Scenario: Non-admin cannot access connector settings

- **WHEN** a member or viewer navigates to connector settings
- **THEN** the surface is not offered and any status/config request is rejected, including the automation section and any attempt to write the automation setting

#### Scenario: Settings are keyboard-operable across themes

- **WHEN** an admin configures the connector and toggles a team's status automation using only the keyboard in each preset in light and dark
- **THEN** every control is reachable and operable without a pointer and renders from tokens with no hardcoded values
