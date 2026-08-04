## ADDED Requirements

### Requirement: The absence of byte-granting URLs is enforced by a gate, not by review

The pipeline SHALL fail when a change introduces a capability-granting URL into the storage layer or
into stored rich-text content, on the same precedent by which the search layer's exclusion from the
AI data path is asserted by a test rather than reasoned about. The gate SHALL fail on **any** added
member of the storage seam, not only on a list of known names, so a differently-named URL-minting
method is caught too.

#### Scenario: A presigning helper fails the build

- **WHEN** a file under the storage directory introduces `presign`, `signedUrl`, `getSignedUrl`,
  `createPresignedUrl` or `X-Amz-Signature`
- **THEN** the gate fails and names the file

#### Scenario: An added seam member fails the build whatever it is called

- **WHEN** a member is added to the `StorageProvider` interface beyond `kind`, `put`, `get`,
  `delete` and `health`
- **THEN** the gate fails, without needing to recognise the new member's name

#### Scenario: An absolute URL in stored rich-text content fails the build

- **WHEN** a rich-text image node definition or fixture introduces an attribute carrying an
  `http` URL
- **THEN** the gate fails

#### Scenario: The gate is derived, not hand-listed

- **WHEN** the guarded module gains a new export
- **THEN** the gate covers it without the guard file being edited
