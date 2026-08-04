## ADDED Requirements

### Requirement: Sensitive dimensions are substituted before the call, not filtered after it

Where an AI consumer would otherwise put a sensitive dimension into the model's context, the
system SHALL replace it with a yapm-computed label **before** the request is assembled, rather than
attempt to remove it from the model's output afterwards. This is the same structural move already
made for identity (no per-person column is ever selected) and it SHALL be applied to repository
file paths: the pipeline SHALL hand the model admin-authored **product-area labels**, never a file
path, filename or file extension.

A value that matches no substitution rule SHALL be replaced with a reserved fallback label, never
passed through in its raw form. The substitution SHALL be total: there SHALL be no code path,
including an empty or missing rule set, by which a raw value reaches the request.

Work-graph placement: cross-cutting safety infra shared by every AI consumer. Permission story: a
fully injected model cannot disclose a value it was never given.

#### Scenario: Substitution, not post-filtering

- **WHEN** an AI consumer needs to convey where work landed in a repository
- **THEN** the object handed to the model contains only computed area labels, and no file path
  appears in the request at any depth

#### Scenario: No fall-through for an unmapped value

- **WHEN** a file path matches no configured rule, or no rules are configured at all
- **THEN** a reserved label is used and the raw path is not present in the request

### Requirement: A transient provider read before the call is not an egress channel

An AI pipeline MAY perform a yapm-initiated read against an external provider **before** the model
call, provided it completes before the request is assembled, is never exposed to the model as a
tool, and its result is discarded after use. Such a read SHALL NOT weaken the no-egress property:
the AI step itself SHALL still mount no outbound-network tool, and the model SHALL have no
mechanism to cause a fetch, choose a target, or influence what was fetched.

Work-graph placement: cross-cutting safety infra. Permission story: the read runs under the
server's own credentials for a resource the workspace already authorized, and its result is
narrowed before it reaches any prompt.

#### Scenario: The model cannot cause or steer a fetch

- **WHEN** a pipeline reads provider metadata before generating
- **THEN** the read is complete before the request is built, no tool is mounted on the run, and
  nothing the model emits can trigger another read

#### Scenario: A deterministic output validator complements the structural guarantee

- **WHEN** a pipeline's output could disclose a class of value the reader is not meant to see
- **THEN** a deterministic validator drops the offending item before the artifact is stored, and
  that validator is documented as defense in depth rather than as the boundary
