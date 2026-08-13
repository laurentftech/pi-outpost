## ADDED Requirements

### Requirement: CreateFileFromBrowser

The system SHALL create an empty file at a path supplied by the browser, under exactly the
permission rules that govern a write: refused when the sandbox is read-only, refused when the
resolved path — symlinks included — falls outside the writable zone, and refused when it falls
outside the browser root.

A path that already exists SHALL be refused as a conflict. Creation MUST NOT truncate, replace, or
otherwise modify anything that is already there.

The final segment SHALL be a name, not a route: a segment containing a path separator, or equal to
`.` or `..`, SHALL be refused. An empty or whitespace-only name SHALL be refused.

On success the system SHALL report the new file's size and mtime, and SHALL notify connected
clients that the path changed, so every open tree shows it.

#### Scenario: CreateInsideWritableZone
- **WHEN** creation is requested for a new path inside the writable zone
- **THEN** an empty file exists at that path, its size and mtime are returned, and connected clients are notified

#### Scenario: CreateOutsideWritableZone
- **WHEN** creation is requested for a path outside the writable zone, or the sandbox is read-only
- **THEN** it is refused as denied and nothing is created

#### Scenario: CreateOutsideRoot
- **WHEN** creation is requested for a path that resolves outside the browser root, by traversal or through a symlink
- **THEN** it is refused and nothing is created

#### Scenario: NameAlreadyTaken
- **GIVEN** a file or directory already at that path
- **WHEN** creation is requested for it
- **THEN** it is refused as a conflict and the existing content is untouched

#### Scenario: NameIsNotAPath
- **WHEN** the requested name contains a path separator, or is `.`, `..`, empty, or whitespace only
- **THEN** it is refused and nothing is created

### Requirement: CreateDirectoryFromBrowser

The system SHALL create a directory from the browser under the same rules as file creation:
confined to the browser root, inside the writable zone, refusing an existing path and a name that
is not a name. It SHALL create one directory, not a chain of missing parents.

On success the system SHALL notify connected clients that the tree changed.

#### Scenario: CreateDirectoryInsideWritableZone
- **WHEN** directory creation is requested for a new path inside the writable zone
- **THEN** the directory exists, and connected clients are notified

#### Scenario: CreateDirectoryRefused
- **WHEN** the path is outside the writable zone, already exists, or the name is not a name
- **THEN** it is refused with the same reason a file creation would give, and nothing is created

### Requirement: CreateFromTree

The frontend SHALL let the user create a file or a directory from the file tree, in a directory the
tree shows as writable. The affordance SHALL NOT be offered on a directory outside the writable
zone, and SHALL follow the tree's existing convention for row controls: revealed on hover where
hovering exists, and always present where it does not.

The name SHALL be entered in the tree itself, at the directory it will be created in, so the
destination is shown rather than typed. Confirming SHALL request creation; cancelling SHALL leave
the tree as it was.

A created file SHALL open in the viewer, ready to be edited. A created directory SHALL be expanded
instead. A refusal SHALL be reported next to the input, which SHALL keep what the user typed so a
rejected name can be corrected rather than retyped.

#### Scenario: CreateFileFromTree
- **GIVEN** a directory inside the writable zone
- **WHEN** the user activates its creation control, types a name and confirms
- **THEN** the file is created in that directory and opens in the viewer ready to be edited

#### Scenario: CreateDirectoryFromTree
- **WHEN** the user creates a directory this way
- **THEN** it appears in the tree, expanded, and no viewer opens

#### Scenario: ReadOnlyDirectoryOffersNothing
- **GIVEN** a directory outside the writable zone, or a read-only sandbox
- **THEN** no creation control is offered on it

#### Scenario: CancelCreation
- **WHEN** the user cancels the input
- **THEN** nothing is created and the tree returns to its previous state

#### Scenario: RefusedNameKeepsTheInput
- **WHEN** creation is refused, because the name is taken or not usable
- **THEN** the reason is shown next to the input and the typed name is still there to correct
