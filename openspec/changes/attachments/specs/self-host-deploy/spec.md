## ADDED Requirements

### Requirement: Attachment storage adds no container and defaults to a local volume

The system SHALL provide attachment storage without adding a fourth service to the self-hosting
deployment. The default provider SHALL be the local filesystem backed by a named volume on the
existing application service; object storage SHALL be optional and SHALL never be a prerequisite.
The application image SHALL create the storage directory owned by the application user, so a
bind-mounted host path is not silently unwritable.

#### Scenario: Still exactly three containers

- **WHEN** the published compose file is brought up with attachments in use
- **THEN** exactly three services run: the app, zero-cache and Postgres
- **AND** no object-storage service is present

#### Scenario: Files survive a container restart

- **WHEN** a file is uploaded and the application container is recreated
- **THEN** the file is still served, because the storage directory is a named volume

#### Scenario: The storage directory is writable by the application user

- **WHEN** the image starts as the non-root application user
- **THEN** the configured storage directory exists and is writable by that user

### Requirement: Storage configuration is validated at boot and reported by the readiness check

The system SHALL validate storage configuration with the rest of the environment at startup, failing
fast and naming the offending variable. Selecting object storage SHALL require its full variable set
all-or-nothing, on the same rule the connector credentials already follow. Readiness SHALL include a
storage probe, so an unreachable bucket or an unwritable directory is visible before the first
upload.

#### Scenario: A partial object-storage configuration fails boot by name

- **WHEN** object storage is selected with one required variable missing
- **THEN** boot fails and the message names that variable

#### Scenario: Unset storage variables mean the local default, never a failure

- **WHEN** no storage variables are set
- **THEN** the instance boots using the local provider at the documented default directory

#### Scenario: Readiness reflects storage health

- **WHEN** the configured storage is unreachable or unwritable
- **THEN** the readiness endpoint reports not-ready and names the storage check

### Requirement: The runtime image carries a native image-processing module

The system SHALL generate thumbnails using a native module in the application image. The image build
SHALL resolve that module's prebuilt platform binaries in a stage whose base image matches the
runtime stage, and the constraint this places on cross-architecture builds SHALL be documented.

#### Scenario: Thumbnails work in the published image

- **WHEN** an image is uploaded to an instance running the published image
- **THEN** a thumbnail is generated and served

#### Scenario: Cross-architecture builds are documented, not discovered

- **WHEN** a maintainer builds the image for an architecture other than the build host's
- **THEN** the documented build instructions state what is required for the native module's
  binaries to match the target

### Requirement: Backup covers attachments, and its contents differ per provider

The system's documented one-command backup SHALL state exactly what it captures under each storage
provider: with the local provider, a database dump **and** an archive of the storage directory; with
object storage, the database dump only, with the attachment table serving as the manifest against
which an operator verifies their own bucket backup.

Capture ordering SHALL be documented so that no captured row can reference bytes that were never
captured: because an upload writes its object before its row, the database SHALL be dumped before
the files are captured, making the file capture a superset of what the dump refers to. Restore
ordering SHALL be documented separately, as a statement about intermediate states rather than about
completeness: the database SHALL be restored before the files, so the only state a partial restore
can be in is one the running application already handles.

#### Scenario: Local-provider backup includes the files

- **WHEN** a backup is taken on an instance using the local provider
- **THEN** the documented output contains both the database dump and an archive of the storage
  directory

#### Scenario: Object-storage backup names the operator's responsibility

- **WHEN** a backup is taken on an instance using object storage
- **THEN** the documentation states that the bucket is the operator's own backup domain
- **AND** states that the attachment table is the manifest for verifying it

#### Scenario: Capture ordering never dumps a row whose bytes were not captured

- **WHEN** the documented backup procedure is followed
- **THEN** the database is dumped before the files are captured, so every row in the dump names
  bytes that were already on disk when the dump ran
- **AND** the file capture may contain objects with no row in the dump, which are the orphans the
  nightly sweep already collects

#### Scenario: Restore ordering leaves only states the application already handles

- **WHEN** the documented restore procedure is followed
- **THEN** the database is restored before the files, so a row whose bytes have not landed yet
  serves the ordinary refusal rather than leaving unreachable bytes
