## ADDED Requirements

### Requirement: Provider-neutral storage seam with no URL-minting member

The system SHALL define a `StorageProvider` interface with exactly the members `kind`, `put`, `get`,
`delete` and `health`, and SHALL NOT define any member, on this interface or on any implementation
of it, that returns a URL, a presigned request, or any other string that grants access to bytes.
`get` SHALL resolve to `null` for a missing object rather than rejecting. `delete` SHALL be
idempotent. Byte access SHALL be available only by proxying through the application's own
authenticated routes, identically for every provider.

#### Scenario: The seam exposes no capability-minting member

- **WHEN** the exported `StorageProvider` interface is inspected
- **THEN** its member list is exactly `kind`, `put`, `get`, `delete`, `health`
- **AND** no member returns a URL, a presigned request, or a signature

#### Scenario: A missing object is a value, not an exception

- **WHEN** `get` is called with a well-formed key for which no object exists
- **THEN** it resolves to `null`
- **AND** it does not reject, so the caller can fold the outcome into its own refusal shape

#### Scenario: Deleting an absent object succeeds

- **WHEN** `delete` is called twice for the same key
- **THEN** both calls resolve without error

#### Scenario: Both providers are served by the same route code

- **WHEN** the instance is configured with the local provider and again with the S3 provider
- **THEN** the permission check, the response headers and the refusal bytes on the serve route are
  produced by the same code in both configurations

### Requirement: Key validation lives in the provider

Every `StorageProvider` implementation SHALL validate the key it is given against the fixed
team-sharded shape `<uuid>/<uuid>` optionally suffixed `.thumb`, and SHALL reject any other key
before performing any filesystem or network operation. Validation SHALL NOT be delegated to callers.

#### Scenario: A traversal attempt is rejected by the provider

- **WHEN** any provider is called with a key containing `..`, a leading `/`, a backslash, a null
  byte, or any character outside the hexadecimal-and-hyphen UUID alphabet
- **THEN** the call rejects
- **AND** no file is opened and no HTTP request is issued

#### Scenario: A valid team-sharded key is accepted

- **WHEN** a provider is called with `<teamId>/<attachmentId>` or `<teamId>/<attachmentId>.thumb`
  where both components are lowercase UUIDs
- **THEN** the call proceeds

### Requirement: The local filesystem provider is the default and is complete

The system SHALL default to a local filesystem provider rooted at `STORAGE_LOCAL_DIR` (default
`/var/lib/yapm/files`), and that provider SHALL support the full feature set — upload, serve,
thumbnail, delete and garbage collection — with no object storage configured. Selection between
providers SHALL be explicit configuration, never inference, and a misconfigured or unwritable
storage root SHALL fail the readiness check rather than the first upload.

#### Scenario: A self-hoster with no object store gets full functionality

- **WHEN** an instance boots with no `S3_*` variables set
- **THEN** the local provider is selected
- **AND** uploading, serving, thumbnailing and deleting all work

#### Scenario: An unwritable storage root is a readiness failure

- **WHEN** `STORAGE_LOCAL_DIR` does not exist, or exists but is not writable by the app user
- **THEN** `/readyz` reports not-ready and names storage as the failing check
- **AND** the failure is visible at boot rather than at the first upload

#### Scenario: S3 selection is explicit and all-or-nothing

- **WHEN** `STORAGE_PROVIDER=s3` is set with any member of the required S3 variable set missing
- **THEN** boot fails naming each missing variable

### Requirement: The attachment entity is team-anchored and orphans rather than cascades

The system SHALL store one `attachment` row per uploaded file with a server-minted UUIDv7 primary
key, a non-null `team_id` that is the permission anchor, nullable `issue_id` and `comment_id`, the
uploader's id, the original filename, the **sniffed** content type, the byte size, a thumbnail flag
and a creation timestamp. Deleting the referenced issue or comment SHALL null the reference rather
than delete the row, so the file becomes an orphan collected by the sweep. The row SHALL NOT store a
URL or a storage key.

#### Scenario: Place in the work graph

- **WHEN** an attachment is created
- **THEN** it hangs off a team, and optionally off one issue or one comment within that team
- **AND** it is a leaf: nothing in the work graph references an attachment

#### Scenario: A deleted comment orphans its files

- **WHEN** a comment carrying two attachments is deleted
- **THEN** both attachment rows survive with `comment_id` null
- **AND** their bytes are still readable until the orphan sweep collects them

#### Scenario: The upload response carries the id

- **WHEN** an upload succeeds
- **THEN** the response body contains the server-minted attachment id, the sniffed content type, the
  byte size and whether a thumbnail exists
- **AND** it contains no URL, no path and no storage key

#### Scenario: The stored row carries no capability

- **WHEN** an attachment row is read from the database or from a client's replica
- **THEN** no column contains a URL, a signature, an expiry or a filesystem path

### Requirement: Attachment rows sync team-scoped and read-only

The system SHALL replicate `attachment` rows to clients under the same team scope as other work
data, and SHALL NOT expose any client-callable mutator that writes the table. Every write to the
table SHALL occur on the authenticated REST path, where the row and the bytes move together. A
non-member SHALL receive an empty result from an empty query rather than an error, with
authentication checked before existence.

#### Scenario: A member sees an issue's attachments without a network round trip

- **WHEN** a member of the owning team opens an issue that has attachments
- **THEN** the attachment rows are already present in the local replica
- **AND** rendering the list waits on no request

#### Scenario: A non-member's query returns empty

- **WHEN** a signed-in user who is not a member of the owning team runs the attachments query for
  that issue
- **THEN** the result is empty
- **AND** the response does not distinguish "no attachments" from "not permitted"

#### Scenario: No client mutator can create an attachment row

- **WHEN** the shared mutator map is enumerated
- **THEN** it contains no mutator that writes the `attachment` table
- **AND** there is consequently no attachment entry in the mutator tool registry

### Requirement: Every read-path failure is one byte-identical refusal

For the byte-serving routes, the system SHALL return exactly one refusal response — the same status,
the same body bytes and the same headers — for every outcome that is not a successful read by a
permitted caller: an id matching no row, an id that is not a well-formed UUID, a row belonging to a
team the caller is not a member of, a row whose bytes are absent from the provider, and a thumbnail
request for a row that has no thumbnail. The refusal SHALL NOT be a `403` for one case and a `404`
for another, and SHALL carry `Cache-Control: no-store`. A request with no valid session MAY be
distinguished, since it concerns no particular row.

#### Scenario: Cross-team read is indistinguishable from a nonexistent file

- **WHEN** a member of team A requests an attachment belonging to team B
- **AND** the same caller requests an attachment id that has never existed
- **THEN** both responses have the same status, the same body bytes and the same headers

#### Scenario: A malformed id is not a validation error

- **WHEN** a caller requests `/api/v1/files/not-a-uuid`
- **THEN** the response is the same refusal, not a `400`

#### Scenario: Missing bytes behind a real row are the same refusal

- **WHEN** an attachment row exists and is readable by the caller but its object is absent from the
  provider
- **THEN** the response is the same refusal

#### Scenario: A thumbnail request for a file that has none is the same refusal

- **WHEN** a caller requests `/thumb` for an attachment whose `has_thumbnail` is false
- **THEN** the response is the same refusal

#### Scenario: Permission is checked before existence

- **WHEN** the serve route resolves an attachment
- **THEN** the team-scope predicate is part of the same statement that looks the row up
- **AND** no row is fetched and then rejected

### Requirement: Served bytes are privately cacheable for five minutes

The system SHALL serve attachment bytes with `Cache-Control: private, max-age=300`, so a repeat view
paints from the browser cache with no request. The system SHALL NOT mark attachment responses
publicly cacheable.

#### Scenario: A revisited image costs no request

- **WHEN** a permitted caller loads an issue with thumbnails and then loads it again within five
  minutes
- **THEN** the second load issues no requests for those bytes

#### Scenario: Refusals are never cached

- **WHEN** any refusal is returned from the serve route
- **THEN** it carries `Cache-Control: no-store`

### Requirement: Content type is sniffed and script-capable content is never rendered inline

The system SHALL determine the content type of an uploaded file by inspecting its leading bytes
against a fixed allowlist, SHALL store and serve that sniffed type, and SHALL ignore the type
claimed by the client. Only sniffed raster images (PNG, JPEG, GIF, WebP, AVIF) SHALL be served
`inline`; every other file, including anything whose bytes are SVG, XML or HTML, SHALL be served as
`application/octet-stream` with `Content-Disposition: attachment`. Every byte response SHALL carry
`X-Content-Type-Options: nosniff` and a content security policy that denies all sources and
sandboxes the response. The download filename SHALL be sanitised so it cannot inject header content.

#### Scenario: An SVG is downloaded, never rendered in the origin

- **WHEN** a file whose bytes are an SVG document is uploaded and then requested
- **THEN** the response content type is `application/octet-stream`
- **AND** the response is `Content-Disposition: attachment`
- **AND** the response is never `image/svg+xml`

#### Scenario: A PNG renamed to .jpg is served as a PNG

- **WHEN** a PNG is uploaded with a `.jpg` filename and an `image/jpeg` claimed type
- **THEN** the stored and served content type is `image/png`

#### Scenario: An HTML file disguised as a PNG is not rendered

- **WHEN** a file whose bytes begin with `<!DOCTYPE html` is uploaded claiming `image/png`
- **THEN** it is stored and served as `application/octet-stream` with `Content-Disposition:
  attachment`

#### Scenario: A hostile filename cannot inject a header

- **WHEN** a file is uploaded whose name contains quotes, newlines or control characters
- **THEN** the `Content-Disposition` header of the served response is well-formed and contains none
  of them

### Requirement: Uploads are authenticated, team-scoped, size-bounded and streamed

The system SHALL accept one file per upload request, require the caller to be a member of the target
team with write access, and bound every upload by the configured maximum through **whichever of two
exclusive checks applies**: a request declaring a `Content-Length` above the maximum SHALL be refused
before the body is read, and a request carrying no usable `Content-Length` SHALL have its bytes
counted while reading and be refused the moment the running total passes the maximum. Both checks
SHALL NOT apply to the same request — an over-size body is refused before it is buffered by exactly
one of them. When an issue or comment is named on the upload, it SHALL be required to belong to the
same team, so no cross-team edge can be created.

#### Scenario: A non-member cannot upload into a team

- **WHEN** a signed-in user who is not a member of the target team posts an upload for it
- **THEN** the request is refused and no object is written

#### Scenario: A viewer cannot upload

- **WHEN** a user whose role is viewer posts an upload
- **THEN** the request is refused

#### Scenario: An oversized upload is refused before the body is read

- **WHEN** a request declares a content length above the configured maximum
- **THEN** it is refused without the body being read
- **AND** the body is not then counted a second time while reading

#### Scenario: An upload with no declared length is counted while reading

- **WHEN** a request carries no usable `Content-Length` and streams more bytes than the maximum
- **THEN** it is refused the moment the running total passes the maximum
- **AND** the upload is aborted with no partial object left readable

#### Scenario: A cross-team edge cannot be forged at upload

- **WHEN** an upload names a `teamId` the caller belongs to and an `issueId` belonging to a
  different team
- **THEN** the request is refused and no row is written

### Requirement: Thumbnails are generated at upload and never on the read path

The system SHALL generate a bounded-dimension thumbnail for sniffed raster images at upload time,
store it under its own key, and record its presence on the row. Thumbnail generation SHALL NOT occur
while serving. A failure to generate a thumbnail SHALL NOT fail the upload.

#### Scenario: Serving a thumbnail decodes nothing

- **WHEN** a thumbnail is requested
- **THEN** the stored thumbnail object is streamed through unchanged
- **AND** no image decoding occurs on the request path

#### Scenario: An undecodable image still uploads

- **WHEN** a file that sniffs as a raster image cannot be decoded by the thumbnailer
- **THEN** the upload succeeds with `has_thumbnail` false
- **AND** the original bytes are still served

#### Scenario: A decompression bomb is refused by a pixel limit

- **WHEN** an image declaring an enormous pixel count is uploaded
- **THEN** thumbnail generation is abandoned within the configured pixel limit rather than
  exhausting memory

### Requirement: Orphaned files are collected by a sweep on the existing scheduler

The system SHALL register the attachment garbage collection sweep on the process's existing pg-boss
instance, SHALL NOT construct a second `PgBoss` and SHALL NOT call `start()` a second time. The
sweep SHALL delete objects and thumbnails before their rows, SHALL be bounded per pass, and SHALL
only consider rows that are still unattached and were **created** longer ago than the configured
grace period. The window runs from upload, not from detachment: there is no record of when an edge
was removed, and adding one would be a column maintained on every delete path for a sweep that runs
nightly. The consequence is stated rather than smoothed over — a file whose issue or comment is
deleted long after the upload is collected by the next sweep, with no further grace. The sweep SHALL
re-check that a row is still unattached at the moment it collects it, so a file attached after the
listing is never collected. A failure to register the sweep SHALL NOT prevent the other scheduled
jobs from registering.

#### Scenario: An abandoned upload is collected

- **WHEN** a file is uploaded and never attached to an issue or comment, and the grace period passes
- **THEN** the sweep deletes its object, its thumbnail and its row

#### Scenario: A recently uploaded unattached file is left alone

- **WHEN** a file was uploaded within the grace period and is not yet attached
- **THEN** the sweep does not touch it

#### Scenario: An attached file is never collected

- **WHEN** a file is attached to an issue or a comment
- **THEN** no sweep deletes it, however old it is

#### Scenario: The sweep shares the one scheduler

- **WHEN** the scheduler starts with attachments enabled
- **THEN** exactly one `PgBoss` instance exists in the process and `start()` is called once

#### Scenario: A sweep registration failure is contained

- **WHEN** registering the attachment queue throws
- **THEN** the error is logged and the cycle, notification and search jobs still register

### Requirement: Attachment lifecycle operations are refused with the same shape as reads

The system SHALL provide authenticated routes to attach an unattached file to an issue or comment
within the same team, and to delete an attachment. Both SHALL refuse with the read path's single
refusal shape for anything the caller may not see, and delete SHALL remove object, thumbnail and row
and SHALL be idempotent.

#### Scenario: Attaching another team's file is the standard refusal

- **WHEN** a caller attaches an attachment id belonging to a team they are not a member of
- **THEN** the response is byte-identical to the response for an id that does not exist

#### Scenario: An attached file is not re-parented

- **WHEN** a caller attempts to attach a file that already has an issue or comment
- **THEN** the existing reference is unchanged

#### Scenario: Delete removes both variants

- **WHEN** a permitted caller deletes an attachment that has a thumbnail
- **THEN** the original object, the thumbnail object and the row are all gone
- **AND** repeating the request produces the standard refusal
