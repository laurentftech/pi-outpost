## ADDED Requirements

### Requirement: TheTerminalMayRunConfined

When `terminal.sandbox` names a sandbox runner, every terminal SHALL run inside it: reading limited to
the workspace's sandbox root (or project root), the system directories and a private temporary
directory; writing limited to the writable zone and that directory; the agent directory and the
configuration unreadable; no signal to processes outside it. Without `terminal.sandbox` the terminal
SHALL behave as it does today.

#### Scenario: ReadsStayInsideTheRoot
- **GIVEN** a confined terminal in a workspace whose sandbox root is `/work/app`
- **WHEN** the user reads a file in `/work/other`, the agent directory's `auth.json`, or a path reached through `/proc/<pid>/root`
- **THEN** each read is refused

#### Scenario: WritesStayInsideTheWritableZone
- **GIVEN** a confined terminal whose sandbox root is `/work/app` and writable zone `/work/app/out`
- **WHEN** the user writes a file in `/work/app/out` and then in `/work/app/src`
- **THEN** the first write succeeds and the second is refused

#### Scenario: TheConfinedTerminalStaysInteractive
- **GIVEN** a confined terminal
- **WHEN** the user runs git, starts a background job and lists it
- **THEN** they work as in an unconfined terminal

#### Scenario: TheServerCannotBeSignalled
- **GIVEN** a confined terminal
- **WHEN** the user sends a signal to the server's process
- **THEN** it is refused and the server keeps running

#### Scenario: NoRunnerConfiguredKeepsTodaysTerminal
- **GIVEN** the terminal enabled and no `terminal.sandbox`
- **WHEN** a terminal is opened
- **THEN** it behaves exactly as before this change

### Requirement: AConfinedTerminalGetsAMinimalEnvironment

A confined terminal SHALL receive only the variables a shell needs — search path, locale, terminal type,
shell and a home inside the sandbox root — and SHALL NOT receive the server's other variables, provider
keys included.

#### Scenario: KeysDoNotReachTheShell
- **GIVEN** the server started with `OPENAI_API_KEY` in its environment and a confined terminal
- **WHEN** the user lists the shell's environment
- **THEN** `OPENAI_API_KEY` is absent

### Requirement: AnUnusableRunnerMeansNoTerminal

When `terminal.sandbox` is set but the runner is missing or fails its self-check, the terminal SHALL be
unavailable, with the reason shown to the user, and SHALL NOT fall back to an unconfined shell. The rest
of the server SHALL keep working.

#### Scenario: ARunnerThatFailsItsSelfCheck
- **GIVEN** `terminal.sandbox` pointing at a runner whose self-check fails
- **WHEN** the server starts and the user opens the terminal
- **THEN** the server starts, the terminal is refused with the runner's reason, and no shell is spawned

#### Scenario: AMissingRunner
- **GIVEN** `terminal.sandbox` pointing at a path that does not exist
- **WHEN** the user opens the terminal
- **THEN** the terminal is refused with a reason naming that path

### Requirement: SyncFromAConfinedTerminalWidensNothing

Moving the agent to a confined terminal's current directory SHALL be subject to the same rules as
choosing that directory with the directory picker — project and sandbox locks, and the confinement of
the deployment — so a confined terminal SHALL NOT be a way to move the agent where the picker could not.

#### Scenario: SyncUnderALockedSandbox
- **GIVEN** a confined terminal in a workspace whose sandbox is locked by configuration
- **WHEN** the user changes directory to `/usr` and asks to sync the agent to it
- **THEN** the request is refused as the picker would refuse it, and the agent's root is unchanged
