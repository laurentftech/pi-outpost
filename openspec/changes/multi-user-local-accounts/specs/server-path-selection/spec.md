## MODIFIED Requirements

### Requirement: Browse server directories
The system SHALL let an authenticated connected client request the immediate directories beneath any server-side path readable by the pi-outpost process and select one as a configuration value. Exploration SHALL start at the top of the host's filesystem and SHALL not impose an additional path-root restriction. Where the host has more than one filesystem root, that top SHALL list the roots themselves, so every readable path is reachable by walking.

In multi-user mode exploration SHALL instead start at, and SHALL stay within, the signed-in account's root: a request for a path outside it SHALL be refused without listing it, and walking up from the account's root SHALL not go further.

#### Scenario: Browse a mounted skills share
- **WHEN** the user explores from the filesystem root to a mounted server directory containing a skills folder
- **THEN** the UI presents its child directories and returns the selected server path

#### Scenario: Reach a directory on another Windows drive
- **GIVEN** a Windows host with more than one drive
- **WHEN** the user walks up from a drive root
- **THEN** the drives are listed and the other one can be entered

#### Scenario: Refuse an unreadable path
- **WHEN** the client requests a path that cannot be listed by the server
- **THEN** the UI receives an error naming that path and the current setting remains unchanged

#### Scenario: A signed-in account browses only its root
- **GIVEN** multi-user mode and `alice` signed in
- **WHEN** she opens the directory picker
- **THEN** it starts at `<accounts.root>/alice/` and cannot walk above it

#### Scenario: A path outside the account root is refused
- **GIVEN** multi-user mode and `alice` signed in
- **WHEN** her client requests the listing of `/` or of `<accounts.root>/bob/`
- **THEN** the request is refused and nothing is listed
