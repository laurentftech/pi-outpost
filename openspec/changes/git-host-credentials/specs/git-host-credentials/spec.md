# Spec Delta

## Purpose

Lets a pi-outpost server reach private Git repositories over HTTPS without anyone opening a shell on it:
credentials are asked for in the browser, kept per Git host by the server, and offered to the git
commands that manage Agent resources.

## ADDED Requirements

### Requirement: Credentials are kept per Git host

The system SHALL store an HTTPS Git credential as a user name and a secret for one host, identified by scheme, host name and port. Storing a credential for a host that already has one SHALL replace it. The store SHALL persist across restarts in the agent directory, SHALL be readable and writable by the server's user only, and SHALL NOT hold credentials for any other scheme.

#### Scenario: A stored credential survives a restart
- **GIVEN** a credential stored for `https://git.example.com:8447`
- **WHEN** the server restarts
- **THEN** the credential is still offered to git for that host

#### Scenario: Ports distinguish hosts
- **GIVEN** a credential stored for `https://git.example.com:8447`
- **WHEN** git asks for credentials for `https://git.example.com`
- **THEN** no credential is offered

#### Scenario: Storing again replaces
- **GIVEN** a credential stored for a host
- **WHEN** a new user name and secret are stored for the same host
- **THEN** only the new credential is kept and offered

#### Scenario: The store is private
- **WHEN** the store is written on a POSIX system
- **THEN** its file mode grants no access to group or others

### Requirement: Secrets never leave the server

The system SHALL NOT send a stored secret to any client, write it to a log, include it in an error message, or pass it to git on a command line. A client SHALL learn only which hosts have a credential and the user name stored for each.

#### Scenario: The host list carries no secret
- **GIVEN** a credential stored for a host
- **WHEN** a client receives the list of Git hosts
- **THEN** each entry names the host and the user name, and no message to that client contains the secret

#### Scenario: A failure with a stored credential stays redacted
- **GIVEN** a credential stored for a host whose server rejects it
- **WHEN** the clone or refresh fails
- **THEN** the error shown names the host and the authentication failure without the secret

### Requirement: Stored credentials are offered after the deployment's own

The system SHALL offer stored credentials to the git commands it runs for Agent resources, and to no other process. Authentication the deployment configured for git SHALL be consulted first, and credentials it supplies SHALL NOT be copied into the store. git SHALL remain unable to prompt.

#### Scenario: A stored credential lets a private repository clone
- **GIVEN** a credential stored for a host and no other git authentication
- **WHEN** a repository on that host is cloned from Agent resources
- **THEN** the clone succeeds without any prompt

#### Scenario: A stored credential keeps refresh working
- **GIVEN** a repository cloned with a stored credential
- **WHEN** it is refreshed
- **THEN** the fetch authenticates with the stored credential and the repository's assessment is computed

#### Scenario: Deployment credentials are not captured
- **GIVEN** a deployment whose own git credential helper authenticates a host
- **WHEN** a repository on that host is cloned or refreshed
- **THEN** the operation succeeds and the store holds no credential for that host afterwards

#### Scenario: Other git use is unaffected
- **GIVEN** a credential stored for a host
- **WHEN** git runs for the workspace's own Git features or in a terminal
- **THEN** that git is not offered the stored credential

### Requirement: Sandboxed processes cannot read the store

The store SHALL be unreadable from the confined terminal and from confined agent shells, as the provider credentials are.

#### Scenario: A confined shell cannot read the store
- **GIVEN** a credential stored and a confined terminal
- **WHEN** the terminal tries to read the store's file
- **THEN** the read is refused

### Requirement: A missing credential is asked for in the panel

When a clone or refresh from Agent resources fails because an HTTPS host requires authentication, the panel SHALL name the host and ask for a user name and a secret. Submitting SHALL store the credential and retry the same operation. A rejected credential SHALL be reported on the same prompt so it can be corrected.

#### Scenario: Clone asks, stores and retries
- **GIVEN** an HTTPS repository that requires authentication and no credential for its host
- **WHEN** the user clicks Clone and inspect
- **THEN** the panel shows that the host requires authentication with user name and secret fields
- **AND** submitting them stores the credential and the clone is retried, reaching the preview on success

#### Scenario: A wrong secret is said on the prompt
- **GIVEN** the authentication prompt for a host
- **WHEN** the user submits a credential the host rejects
- **THEN** the prompt stays open, says the credential was refused, and the address and folder are kept

#### Scenario: Refresh asks too
- **GIVEN** an enrolled HTTPS repository whose host now rejects the deployment's credentials
- **WHEN** it is refreshed
- **THEN** its row says the host requires authentication and offers to enter a credential, then refreshes again

#### Scenario: SSH is pointed to the documentation
- **WHEN** a clone or refresh over SSH fails for authentication
- **THEN** the message names the host and the SSH authentication failure and points to the documentation, and no credential prompt is shown

### Requirement: Credentials in an address are kept, not discarded

An HTTPS repository address carrying a user name and secret SHALL store them for its host before the clone, and the clone's configured remote SHALL be recorded without them. The address SHALL be redacted wherever it is shown.

#### Scenario: Embedded credentials outlive the clone
- **WHEN** a repository is cloned from `https://user:secret@host/repo.git`
- **THEN** the clone's origin is `https://host/repo.git`, the store holds `user` for that host, and a later refresh authenticates

### Requirement: Git hosts are listed and removable in Settings

Settings → Accounts SHALL list every Git host with a stored credential, with its user name, and SHALL let one be removed. Removing SHALL delete it from the store, so the next git command for that host is not offered it.

#### Scenario: Removing a host
- **GIVEN** a credential stored for a host
- **WHEN** the user removes it from Settings → Accounts
- **THEN** it disappears from the list and the store, and a refresh of a repository on that host is not offered it

### Requirement: The credentials lock covers Git hosts

With `credentialsLock: true`, the interface SHALL show Git hosts without offering to enter or remove a credential, the server SHALL refuse storing or removing one with the lock reason, and credentials embedded in an address SHALL NOT be stored. An authentication failure SHALL then say that credentials are locked on this server.

#### Scenario: A locked server refuses
- **GIVEN** `credentialsLock: true`
- **WHEN** a client asks to store or remove a Git host credential
- **THEN** the server refuses with the lock reason and the store is unchanged

#### Scenario: A locked server does not prompt
- **GIVEN** `credentialsLock: true` and an HTTPS repository requiring authentication
- **WHEN** the clone fails for authentication
- **THEN** the panel names the host and says credentials are locked here, without a credential prompt
