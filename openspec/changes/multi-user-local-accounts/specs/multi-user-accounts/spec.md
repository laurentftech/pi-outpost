## Purpose

Lets one pi-outpost server be shared by several people: each signs in to an account of their own,
works only in their own projects, and only administrators manage accounts and everything the server
holds in common.

## ADDED Requirements

### Requirement: MultiUserModeIsOptIn

The configuration MAY declare `accounts`, naming the directory under which each account's root is created
(`accounts.root`) and, optionally, where the account registry is stored. Without `accounts` the server
SHALL behave exactly as it does today: a single user and the optional shared token. With `accounts` the
server SHALL run in multi-user mode, in which every connection and every request belongs to a signed-in
account.

#### Scenario: NoAccountsBlockKeepsTodaysBehaviour
- **GIVEN** a configuration without `accounts`
- **WHEN** the server starts and a client connects
- **THEN** no sign-in is asked for, and the shared token, when set, is the only credential

#### Scenario: AccountsBlockTurnsTheModeOn
- **GIVEN** a configuration declaring `accounts` with an administrator registered
- **WHEN** a client connects without signing in
- **THEN** it is asked to sign in and receives no project, session or file content

### Requirement: MultiUserModeRefusesUnconfinedShells

In multi-user mode no shell SHALL run unconfined, administrator included: a shell running as the server's
operating-system user would reach every account's files and the shared provider keys. The server SHALL
refuse to start when `bash` is allowed without being delegated to an extension through `sandbox.bashFrom`,
naming the settings at fault, and the settings interface SHALL refuse the same values.

#### Scenario: UndelegatedBashIsRefused
- **GIVEN** a multi-user configuration with `bash` allowed and no `sandbox.bashFrom`
- **WHEN** the server starts
- **THEN** it exits with an error naming `allowBash` and `bashFrom`

#### Scenario: DelegatedBashIsAccepted
- **GIVEN** a multi-user configuration with `bash` allowed and delegated through `sandbox.bashFrom`
- **WHEN** the server starts
- **THEN** it starts, and the agent's shell is the delegated extension's

### Requirement: InMultiUserModeTheTerminalIsConfinedToTheAccount

In multi-user mode the web terminal SHALL only ever run confined (see the `terminal` capability's
confined mode), with the account's root as its root and every other account's root unreadable. When the
terminal is enabled without a usable sandbox runner, it SHALL be unavailable to every account, and the
server SHALL still start.

#### Scenario: AlicesTerminalStaysInHerRoot
- **GIVEN** multi-user mode with a usable sandbox runner and `alice` signed in
- **WHEN** her terminal lists `<accounts.root>` or reads a file in `bob`'s root
- **THEN** each is refused, and she can create and edit files in her own root

#### Scenario: NoRunnerNoTerminalForAnyone
- **GIVEN** multi-user mode with the terminal enabled and no usable sandbox runner
- **WHEN** the server starts and `alice`, then an administrator, open the terminal
- **THEN** the server starts and both are refused with the reason

### Requirement: ProviderKeysStayOutOfTheServerEnvironment

In multi-user mode the server SHALL refuse to start while a provider key is present in its own process
environment, naming the variable and saying to store it as a credential instead: a sandboxed process can
read the environment of the server it runs beside.

#### Scenario: AKeyInTheEnvironmentIsRefused
- **GIVEN** a multi-user configuration and `OPENAI_API_KEY` set in the server's environment
- **WHEN** the server starts
- **THEN** it exits with an error naming `OPENAI_API_KEY` and the credential store

### Requirement: MultiUserModeRefusesASharedToken

In multi-user mode the server SHALL refuse to start when a shared token is also configured, saying the
two cannot be combined: every request then belongs to a signed-in account, and a shared secret would
belong to none.

#### Scenario: SharedTokenIsRefused
- **GIVEN** a multi-user configuration that also sets a shared token
- **WHEN** the server starts
- **THEN** it exits with an error saying the two cannot be combined

### Requirement: NothingOpensOnTheServerDesktop

In multi-user mode, opening or revealing a file with the server machine's own desktop applications
SHALL be refused to every account: the server's desktop belongs to no one account.

#### Scenario: OpeningOnTheServerDesktopIsRefused
- **GIVEN** multi-user mode and `alice` signed in
- **WHEN** her client asks to open or reveal one of her files with the native application
- **THEN** the request is refused and nothing is launched on the server

### Requirement: AnAccountIsRegistered

Each account SHALL have an id, a display name, a role that is either `admin` or `user`, a root at
`<accounts.root>/<id>/`, and a state that is enabled or disabled. An id SHALL be lowercase letters,
digits, `-` and `_`, start with a letter or digit, and be unique; it SHALL be refused otherwise, so it is
always usable as a directory name on every platform. Creating an account SHALL create its root. The
registry SHALL survive a restart and SHALL never hold a password in clear.

#### Scenario: CreatingAnAccountCreatesItsRoot
- **WHEN** an administrator creates the account `alice`
- **THEN** the directory `<accounts.root>/alice/` exists
- **AND** `alice` is listed with role `user`, enabled

#### Scenario: AnUnusableIdIsRefused
- **WHEN** an account is created with the id `../bob`, `Alice` or an id already registered
- **THEN** the creation is refused with the reason, and nothing is created

#### Scenario: NoPasswordInClear
- **GIVEN** an account created with the password `correct horse`
- **WHEN** the registry is read on disk
- **THEN** the text `correct horse` appears nowhere in it

### Requirement: TheFirstAdministratorIsCreatedFromTheCommandLine

The command line SHALL create an account in the configured registry, as administrator when asked
(`pi-outpost user add <id> --admin`), reading the initial password without echoing it, and SHALL reset an
account's password and list the accounts. A multi-user server with no enabled administrator SHALL refuse
to start, naming that command.

#### Scenario: BootstrappingTheFirstAdministrator
- **GIVEN** a multi-user configuration and an empty registry
- **WHEN** `pi-outpost user add root --admin` is run and a password is typed
- **THEN** the server starts and `root` can sign in as administrator

#### Scenario: NoAdministratorNoStart
- **GIVEN** a multi-user configuration whose registry holds no enabled administrator
- **WHEN** the server starts
- **THEN** it exits with an error naming `pi-outpost user add <id> --admin`

### Requirement: SignInWithALocalPassword

A client SHALL sign in with an account id and password. A successful sign-in SHALL yield a session token
that the client presents wherever the shared token is presented today — the WebSocket, the HTTP API and
raw file URLs — checked with the same timing-safe comparison. A failed sign-in SHALL answer identically
whether the id is unknown, the password wrong or the account disabled.

#### Scenario: SignedInClientReachesItsProjects
- **WHEN** `alice` signs in with her password
- **THEN** the client connects with the session token and is served `alice`'s default project

#### Scenario: FailuresLookAlike
- **WHEN** a sign-in names an unknown id, then a known id with a wrong password, then a disabled account
- **THEN** all three receive the same refusal, with no hint of which part was wrong

### Requirement: SessionsExpireAndEnd

A session token SHALL stop being accepted after a configurable period without use, and at once when its
holder signs out.

#### Scenario: ExpiredSessionAsksToSignInAgain
- **GIVEN** a session token unused for longer than the configured period
- **WHEN** the client reconnects with it
- **THEN** the connection is refused as unauthorized and the sign-in screen is shown

#### Scenario: SignOutEndsTheSession
- **WHEN** a signed-in user signs out
- **THEN** their session token is refused from then on

### Requirement: PasswordsAreStoredHashed

A password SHALL be at least 8 characters, and SHALL be stored only as a salted scrypt hash.

#### Scenario: AShortPasswordIsRefused
- **WHEN** an account is created or a password changed with a 7-character password
- **THEN** it is refused with the minimum length named

### Requirement: RepeatedFailuresAreThrottled

The server SHALL slow down sign-in attempts after repeated failures for the same account id and from the
same address, answering further attempts with a refusal that says to wait, for a period that grows with
the failures. A successful sign-in SHALL reset the account's count.

#### Scenario: GuessingIsSlowedDown
- **GIVEN** ten failed sign-ins for `alice` in a row
- **WHEN** an eleventh attempt is made at once, even with the right password
- **THEN** it is refused with a message to wait, and not checked

### Requirement: AnAdministratorSetPasswordMustBeChanged

An account whose password was set by an administrator — at creation or by a reset — SHALL be signed in
only to choose a new password: until it does, every other request on its connection SHALL be refused.
Choosing a password SHALL require the current one, SHALL refuse the same password again, and SHALL end the
account's other sessions.

#### Scenario: FirstSignInAsksForANewPassword
- **GIVEN** `alice` created by an administrator with an initial password
- **WHEN** `alice` signs in with it
- **THEN** she is asked to choose a new password and sees no project until she has

#### Scenario: ChangingThePasswordEndsOtherSessions
- **GIVEN** `alice` signed in from two browsers
- **WHEN** she changes her password in one
- **THEN** the other is disconnected and must sign in again

### Requirement: AnAccountSeesOnlyItsOwnProjects

A connection SHALL belong to the account that signed in and SHALL only ever be bound to that account's
projects, which lie inside its root; its default project SHALL be its root. A request naming a project
outside the account's root — by path, by id or as a workspace parameter — SHALL be refused exactly as a
project that does not exist.

#### Scenario: NamingAnotherAccountsProjectIsRefused
- **WHEN** `alice` connects with `?workspace=` set to a project in `bob`'s root, or asks to switch to it
- **THEN** the request is refused the same way as for a project that does not exist
- **AND** `alice` stays on her own project

### Requirement: ProjectContentReachesOnlyItsAccount

Sessions, files, git state, work plans, outcomes and attention of a project SHALL reach only clients of
the account that owns it. An administrator SHALL be bound by the same rule: administering accounts does
not grant access to their work.

#### Scenario: TwoUsersDoNotSeeEachOther
- **GIVEN** `alice` and `bob` each working in a project of their own
- **WHEN** `alice` lists projects, sessions and files
- **THEN** nothing of `bob`'s appears

#### Scenario: AnAdministratorDoesNotReadOthersWork
- **GIVEN** an administrator and `bob` working in a project
- **WHEN** the administrator lists projects, sessions and files
- **THEN** `bob`'s project is not among them

### Requirement: AdministrationIsReservedToAdministrators

Only an `admin` account SHALL manage accounts, change the server configuration or sandbox, set or declare
provider credentials, manage pi packages and agent-resource repositories, restart the server, and receive
server update and restart notices. The server SHALL refuse these from a `user` account whatever its client
shows, and the interface SHALL not offer them to it.

#### Scenario: AUserCannotChangeTheConfiguration
- **WHEN** a `user` account sends a configuration change, a credential, a package update or a restart
- **THEN** the server refuses it as not permitted and nothing changes

#### Scenario: AUserDoesNotSeeAdministrationControls
- **WHEN** a `user` account opens the settings
- **THEN** no credential, package, sandbox, account or restart control is shown

### Requirement: ProviderCredentialsAreShared

Provider credentials set by an administrator SHALL be usable by every account. Each account SHALL still
choose the model and thinking level of its own sessions among those available.

#### Scenario: AnAdministratorSetsTheSharedKey
- **WHEN** an administrator sets a provider key
- **THEN** every account's sessions can use that provider

#### Scenario: AUserChoosesItsModel
- **WHEN** a `user` account changes the model of its current session
- **THEN** the change applies to that session only

### Requirement: AdministratorsManageAccounts

An administrator SHALL be able to list accounts, create an account with an initial password and a role,
reset an account's password, change its role, disable it, re-enable it and delete it. The server SHALL
refuse any change that would leave no enabled administrator. Disabling or deleting an account SHALL close
its connections and end its sessions at once, and SHALL retire its projects; deleting SHALL remove it from
the registry and keep its root on disk.

#### Scenario: DisablingCutsTheUserOff
- **GIVEN** `bob` connected with an agent turn running
- **WHEN** an administrator disables `bob`
- **THEN** `bob`'s connections close, his turn is stopped and his projects are retired
- **AND** `bob` can no longer sign in

#### Scenario: TheLastAdministratorStays
- **GIVEN** a single enabled administrator
- **WHEN** it tries to disable itself, delete itself or become a `user`
- **THEN** the change is refused with the reason

#### Scenario: DeletingKeepsTheFiles
- **WHEN** an administrator deletes `bob`
- **THEN** `bob` is no longer listed and cannot sign in
- **AND** `<accounts.root>/bob/` is still on disk

### Requirement: AnAccountsIdleProjectsAreRetired

Idle retirement SHALL apply to every account's projects, its default project included, once none of the
account's clients is bound to them: an account with no connection SHALL hold no running agent once its
projects have been idle for the configured time. Reconnecting SHALL restore them as retirement does today.

#### Scenario: ALeftAccountReleasesItsAgents
- **GIVEN** `alice` disconnects with her default project idle
- **WHEN** the idle timeout elapses
- **THEN** her projects are retired and hold no running agent
- **AND** when she signs in again her default project is served as before
