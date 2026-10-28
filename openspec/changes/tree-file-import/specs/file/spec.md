## ADDED Requirements

### Requirement: ImportExternalFilesIntoTreeFolders
The file tree SHALL accept external files on writable folder rows and an explicit workspace-root
target. It SHALL import their bytes into that directory, without attaching them to the composer.
The target SHALL be highlighted while accepted, and pending uploads, the actual saved paths and
per-file errors SHALL be visible in the tree. A second drop during a pending batch SHALL NOT start
a duplicate import. Internal file moves and copies SHALL retain their existing behaviour.

#### Scenario: ReopeningFilesKeepsAnImport
- **WHEN** the user closes and reopens Files during an import
- **THEN** the pending progress remains visible and repeated drops do not start another batch

#### Scenario: ImportIntoAFolder
- **WHEN** the user drops external files onto a writable folder
- **THEN** their exact bytes are stored there, the saved paths are shown, the folder's tree updates,
  and no chat attachment or global attachment overlay is created

#### Scenario: ImportIntoTheRoot
- **WHEN** the user drops a file on the writable workspace-root target
- **THEN** the file is stored at the browser root

#### Scenario: ReadOnlyDropIsNotAnAttachment
- **WHEN** external files are dropped onto a read-only folder or tree
- **THEN** nothing is imported and the drop does not fall through to chat attachments

#### Scenario: ImportReportsCollisions
- **GIVEN** a file already exists under the requested name
- **WHEN** that name is imported
- **THEN** the existing file is untouched and the distinct saved path is shown

#### Scenario: ImportReportsIndividualFailures
- **WHEN** a batch contains a file over 25 MiB and a valid file
- **THEN** the oversized file is refused before reading it, the valid file is imported,
  and the refusal and saved path are both shown

#### Scenario: FolderDropsAreRefused
- **WHEN** a directory is dropped onto a folder target
- **THEN** the tree explains that only files can be imported and never uploads a directory placeholder

#### Scenario: AWorkspaceSwitchDoesNotRedirectImports
- **WHEN** the workspace changes while dropped files are being read or uploaded
- **THEN** no subsequent request from that batch writes into the new workspace,
  and feedback from the previous workspace is not shown in the new tree

### Requirement: ExistingDirectoryUploads
An upload_file request with existingDirectory=true SHALL require workspaceId to match the socket's
workspace. It SHALL target an existing writable directory inside the browser root, including the
root, without creating parents. Existing size, name, symlink, binary, atomic-write and no-overwrite
rules SHALL apply. Default uploads SHALL remain pinned to uploads below the writable root and MAY
create that directory.

#### Scenario: UploadToAnExistingDirectory
- **WHEN** an upload explicitly targets an existing writable folder
- **THEN** the file is stored there, the actual path is returned and connected clients are notified

#### Scenario: ImportDoesNotResurrectAMissingDirectory
- **WHEN** the target directory no longer exists
- **THEN** the upload is refused and no directory or file is created

#### Scenario: ImportCannotEscapePermissions
- **WHEN** the import target is read-only, outside the writable zone, or escapes the browser root
  directly or through a symlink
- **THEN** the upload is refused without writing a file

## MODIFIED Requirements

### Requirement: UploadFileFromBrowser

The system SHALL store a file supplied by the browser under exactly the permission rules that
govern a write: refused when the sandbox is read-only, refused when the resolved destination —
symlinks included — falls outside the writable zone, and refused when it falls outside the browser
root.

The content SHALL be written as bytes decoded from base64, not as text. A binary payload MUST be
stored unchanged: the NUL-byte rejection that guards text writes SHALL NOT apply here, because
storing a PDF is the point of the operation.

The stored size SHALL be capped at the maximum upload size, and the cap SHALL be enforced before
the payload is materialised on disk. The cap SHALL be at least as large as the largest document the
path-based extraction tools accept, so a file the agent could read is never rejected at the door.

The final segment SHALL be a name, not a route: a segment containing a path separator, or equal to
`.` or `..`, SHALL be refused, as SHALL an empty or whitespace-only name. The system SHALL not
rewrite a supplied name before storing it.

A name SHALL also be refused when another platform would resolve it to something other than what it
says — a trailing dot or space, a `:`, or a reserved device name — and when it is too long to be a
single path component. These are refused on every platform, not only the one that would misread
them: a workspace is shared, and the no-overwrite guarantee depends on the name the filesystem
resolves being the name that was checked.

The temporary file the write goes through SHALL NOT be openable by name by anything else: it SHALL
be created exclusively, under an unpredictable name, so that a pre-existing entry at that path —
including a symlink pointing out of the sandbox — fails the write instead of redirecting it.

An existing path SHALL NOT be overwritten. The system SHALL pick a distinct name and SHALL report
the path it wrote. Missing directories in the default uploads destination SHALL be created. An explicit existing-directory import SHALL instead refuse a missing destination without creating it.

The write SHALL be atomic: an interruption MUST NOT leave a truncated file where the reported path
points. On success the system SHALL report the written path and SHALL notify connected clients that
the tree changed, so every open tree shows the upload.

#### Scenario: UploadInsideWritableZone
- **WHEN** an upload is requested for a destination inside the writable zone
- **THEN** the file exists at the reported path with the supplied bytes, and connected clients are notified

#### Scenario: UploadPreservesBinaryContent
- **WHEN** the supplied content is binary, such as a PDF
- **THEN** the bytes on disk match the supplied bytes exactly and the write is not refused for containing NUL

#### Scenario: UploadOutsideWritableZone
- **WHEN** the destination is outside the writable zone, or the sandbox is read-only
- **THEN** it is refused as denied and nothing is written

#### Scenario: UploadOutsideRoot
- **WHEN** the destination resolves outside the browser root, by traversal or through a symlink
- **THEN** it is refused and nothing is written

#### Scenario: UploadedNameIsNotAPath
- **WHEN** the supplied name contains a path separator, or is `.`, `..`, empty, or whitespace only
- **THEN** it is refused as invalid, and nothing is written outside the destination directory

#### Scenario: UploadedNameIsPortable
- **WHEN** the supplied name ends in a dot or a space, contains `:`, is a reserved device name, or is longer than one path component may be
- **THEN** it is refused as invalid and nothing is written

#### Scenario: UploadDoesNotOverwrite
- **GIVEN** a file already at the requested path
- **WHEN** an upload is requested for that name
- **THEN** the existing file is untouched, the upload is stored under a distinct name, and that path is reported

#### Scenario: UploadCreatesMissingDirectories
- **WHEN** the destination directory does not exist inside the writable zone
- **THEN** it is created and the file is written inside it

#### Scenario: UploadBeyondSizeLimit
- **WHEN** the payload exceeds the maximum upload size
- **THEN** it is refused as too large and nothing is written

