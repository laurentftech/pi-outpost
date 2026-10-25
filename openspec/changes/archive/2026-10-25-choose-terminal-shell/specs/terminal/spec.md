## ADDED Requirements

### Requirement: ChooseAnInstalledShellPerTerminalTab
The server SHALL advertise only installed compatible shells. Each new terminal tab MAY select an advertised shell identifier; existing tabs SHALL retain their shell. With no selection, Windows SHALL default to PowerShell, then cmd if PowerShell is absent. An explicit terminal.shell and terminal.shellArgs SHALL remain the default. Selected IDs SHALL be validated and confinement preserved; confined Windows SHALL exclude Git Bash.

#### Scenario: InstalledShellsOnly
- **GIVEN** a host with some known shells missing or duplicated on PATH
- **WHEN** shell choices are discovered, including after removal of an executable
- **THEN** only existing executable files appear, without duplicates

#### Scenario: PowerShellByDefault
- **GIVEN** Windows with PowerShell and Git Bash installed and no configured shell
- **WHEN** the user opens a terminal without a shell selection
- **THEN** PowerShell is started

#### Scenario: ConfiguredShellWins
- **GIVEN** terminal.shell and terminal.shellArgs explicitly configured
- **WHEN** a terminal opens without a selection
- **THEN** that shell and those arguments are used

#### Scenario: ChooseShellPerTab
- **GIVEN** an open terminal and advertised shells
- **WHEN** the user chooses another shell and creates a tab
- **THEN** the new tab executes that shell and the original shell remains running

#### Scenario: ShellListChanges
- **GIVEN** a selected shell disappears from the server snapshot
- **WHEN** the user creates a new tab
- **THEN** the selector and new tab use the default instead of a stale identifier

#### Scenario: UnknownShellIsRefused
- **GIVEN** a client sends an identifier not advertised by the server
- **WHEN** terminal_open is received
- **THEN** an error is returned and input cannot reach a spawned terminal

#### Scenario: ConfinedChoicesStayConfined
- **GIVEN** a confined Windows terminal and installed Git Bash
- **WHEN** shells are advertised
- **THEN** Git Bash is absent and native PowerShell arguments keep confined progress handling

### Requirement: TerminalClipboardShortcuts
Ctrl+C (or Cmd+C) SHALL copy selected terminal text. Without selection Ctrl+C SHALL keep shell interruption. Ctrl+V, Ctrl+Shift+V and Cmd+V SHALL paste through the browser and xterm without sending control-V. Clipboard refusal SHALL be reported without breaking the terminal. Other shell shortcuts SHALL remain available.

#### Scenario: CopySelectionOrInterrupt
- **GIVEN** a terminal with selected output
- **WHEN** Ctrl+C is pressed
- **THEN** the selection reaches the clipboard without interruption
- **WHEN** Ctrl+C is pressed during a running command with no selection
- **THEN** the command is interrupted and the shell remains usable

#### Scenario: PasteIntoTheShell
- **GIVEN** text in the clipboard and a focused terminal
- **WHEN** Ctrl+V or Ctrl+Shift+V is pressed
- **THEN** the text reaches the terminal and can be executed

#### Scenario: ClipboardRefusalIsReported
- **GIVEN** clipboard write is refused
- **WHEN** selected output is copied
- **THEN** the terminal reports the refusal without an uncaught error


### Requirement: TerminalSessionsRecoverAfterReconnect
A disconnected terminal SHALL start a new session after the next connection handshake, preserving its chosen shell, last known working directory and dimensions. The buffer SHALL state that this is a new session; closed or exited terminals SHALL NOT restart.

#### Scenario: TerminalRecoversAfterReconnect
- **GIVEN** a live Git Bash terminal and another terminal already closed or exited
- **WHEN** the socket disconnects and reconnects
- **THEN** the live tab starts one new Git Bash session and accepts commands
- **AND** its buffer announces the restart and the closed or exited terminal does not reopen
