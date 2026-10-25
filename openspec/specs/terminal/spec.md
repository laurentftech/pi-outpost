# terminal Specification

## Purpose
Gives the workspace a real shell in the interface itself — tabs, a live buffer that survives being
minimised, and a working directory the agent and the file tree can be moved to — so the work that
needs a command line does not have to leave the application to find one.

## Requirements

### Requirement: Interactive web pseudo-terminal panel

When terminal access is enabled, the web interface SHALL render an interactive xterm.js terminal panel.

#### Scenario: Header button and keyboard shortcut toggle
- **GIVEN** a server with `terminal.enabled: true`
- **WHEN** the user clicks the `>_ terminal` header button or presses `Ctrl+\`` / `Cmd+\``
- **THEN** the terminal panel toggles between visible and minimized
- **AND** running processes and terminal buffers are preserved in the background

#### Scenario: Multi-tab management and inline renaming
- **WHEN** the user clicks the `+` button in the terminal header
- **THEN** a new terminal tab is created and connected to a fresh shell session
- **WHEN** the user double-clicks any tab title
- **THEN** an inline text field allows renaming the tab

#### Scenario: PWD synchronization to workspace root
- **WHEN** the shell process changes its working directory
- **THEN** the panel displays the current directory
- **AND** clicking `🎯 Sync LLM` reposition the agent workspace and file tree to that directory

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

### Requirement: OnWindowsAConfinedTerminalOpensANativeShell

On Windows, when no shell is configured, a confined terminal SHALL open PowerShell (or `cmd` where
PowerShell is absent) rather than Git Bash, which cannot start inside the sandbox runner. A shell named
in `terminal.shell` SHALL still be used as configured.

#### Scenario: OnWindowsTheConfinedShellIsPowerShell
- **GIVEN** a Windows host with Git Bash installed, the terminal confined and no `terminal.shell`
- **WHEN** a terminal is opened
- **THEN** its shell is PowerShell, not Git Bash
- **AND** with `terminal.shell` set, that shell is used instead

### Requirement: OnWindows11MxcMayConfineTheTerminal

`terminal.sandbox` MAY name MXC's executor (`wxc-exec.exe`). It SHALL be accepted only when its probe
reports tier 1 (`base-container`); any other tier, or a host other than Windows, SHALL make the terminal
unavailable with the reason. Under MXC the policy SHALL keep the read and write limits and the denied
secrets of `TheTerminalMayRunConfined`, and git SHALL be able to run in a writable root.

#### Scenario: AnMxcRunnerBelowTier1MeansNoTerminal
- **GIVEN** `terminal.sandbox` naming MXC's executor on a host whose probe reports a tier other than `base-container`
- **WHEN** the runner is checked
- **THEN** it is refused with a reason naming the tier found and the one required

#### Scenario: OnWindowsWithMxcGitRunsConfined
- **GIVEN** a confined terminal under MXC tier 1 in a git repository that is its writable root
- **WHEN** the user runs `git status` and reads the agent directory's `auth.json`
- **THEN** git answers, and the read is refused

### Requirement: AConfinedTerminalGetsAMinimalEnvironment

A confined terminal SHALL receive only the variables a shell needs — search path, locale, terminal type,
shell, a home inside the sandbox root, a private npm cache, and the user's git configuration as
`GIT_CONFIG_GLOBAL` when they have one — and SHALL NOT receive the server's other variables, provider
keys included. That git configuration file SHALL be readable inside, read-only, and nothing beside it.
The shell's history SHALL be kept in the terminal's private temp, never in the sandbox root.

#### Scenario: KeysDoNotReachTheShell
- **GIVEN** the server started with `OPENAI_API_KEY` in its environment and a confined terminal
- **WHEN** the user lists the shell's environment
- **THEN** `OPENAI_API_KEY` is absent

#### Scenario: GitKnowsWhoCommits
- **GIVEN** a user whose `~/.gitconfig` names them, and a confined terminal
- **WHEN** git reads its identity in the terminal
- **THEN** it is the user's, the file cannot be written, and the folder it sits in stays unreadable

#### Scenario: AClosedTerminalLeavesNoHistoryInTheProject
- **GIVEN** a confined terminal on Linux or macOS in which the user typed a command
- **WHEN** the terminal is closed and its shell has exited
- **THEN** no shell history file is left in the sandbox root

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
- **THEN** the agent's root is unchanged, exactly as if `/usr` had been chosen with the picker

### Requirement: OnLinuxMxcMayConfineTheTerminal

On Linux, `terminal.sandbox` MAY name MXC's Linux executor. When an interactive shell runs through it,
the terminal SHALL keep the limits of `TheTerminalMayRunConfined`; when it cannot, the terminal SHALL be
unavailable with the reason, and the agent's shell SHALL NOT be affected.

#### Scenario: OnLinuxWithMxcGitRunsInTheTerminal
- **GIVEN** a confined terminal under MXC's real Linux executor in a git repository that is its writable root
- **WHEN** the user runs `git status` and reads the agent directory's `auth.json`
- **THEN** git answers, and the read is refused

### Requirement: OnMacOsMxcMayConfineTheTerminal

On macOS on Apple silicon, `terminal.sandbox` MAY name MXC's macOS executor. The terminal SHALL then keep
the limits of `TheTerminalMayRunConfined`, its size and resizes SHALL reach the shell, Ctrl-C SHALL
interrupt the running command without ending the shell, and the shell's working directory SHALL be
found as for an unconfined terminal.

#### Scenario: OnMacOsWithMxcGitRunsInTheTerminal
- **GIVEN** a confined terminal under MXC's real macOS executor in a git repository that is its writable root
- **WHEN** the user runs `git status` — in the shell pi-outpost starts by default, zsh included — and reads the agent directory's key file
- **THEN** git answers without warnings and leaves nothing in the root, and the read is refused

#### Scenario: OnMacOsTheConfinedTerminalBehavesAsATerminal
- **GIVEN** a confined terminal under MXC's real macOS executor, opened at 40 rows by 120 columns
- **WHEN** the user asks the size, resizes it, interrupts a running `sleep`, and changes directory
- **THEN** the shell reports each size, the interrupted command ends with status 130 while the shell lives, and the server finds the new working directory

### Requirement: UnderMxcNothingConfinedReachesTheDesktop

Under MXC, the request for a confined terminal and for the agent's confined shell SHALL ask for no
clipboard access and no keyboard or mouse input injection, while keeping the user interface enabled
that PowerShell and git need. A program run there SHALL NOT inject input into the user's session,
move the cursor, see the user's windows, or open the clipboard.

#### Scenario: TheRequestKeepsTheDesktopOutOfReach
- **GIVEN** a terminal or a confined shell under MXC, with writes allowed, refused, or limited to a zone
- **WHEN** its MXC request is built
- **THEN** the request's user-interface policy is enabled, with clipboard `none` and injection off

#### Scenario: AConfinedProgramCannotDriveTheDesktop
- **GIVEN** the agent's `powershell` confined by MXC's real executor, and a program compiled outside the sandbox into the root
- **WHEN** the command runs it, and it injects an absolute mouse move, sets the cursor, lists the visible windows and opens the clipboard
- **THEN** the cursor is where neither call put it, setting it is refused, no window is visible, and the clipboard does not open

### Requirement: OnMacOsSeatbeltMayConfineTheTerminal

On macOS, `terminal.sandbox` MAY name the Seatbelt runner. The terminal SHALL then keep the limits of
`TheTerminalMayRunConfined`, its size and resizes SHALL reach the shell, Ctrl-C SHALL interrupt the
running command without ending the shell, and the shell's working directory SHALL be found.

#### Scenario: UnderSeatbeltGitRunsInTheTerminal
- **GIVEN** a confined terminal under the Seatbelt runner in a git repository that is its writable root
- **WHEN** the user runs `git status` — in the shell pi-outpost starts by default, zsh included — and reads the agent directory's key file
- **THEN** git answers without warnings and leaves nothing in the root, and the read is refused

#### Scenario: UnderSeatbeltTheConfinedTerminalBehavesAsATerminal
- **GIVEN** a confined terminal under the Seatbelt runner, opened at 40 rows by 120 columns
- **WHEN** the user asks the size, resizes it, interrupts a running `sleep`, and changes directory
- **THEN** the shell reports each size, the interrupted command ends with status 130 while the shell lives, and the server finds the new working directory

### Requirement: GitSeesTheUsersGlobalIgnore

A confined shell SHALL be able to read, and not write, the files the user's `~/.gitconfig` names in
`core.excludesFile` and `core.attributesFile`, when they exist; it SHALL NOT be given their folder.

#### Scenario: GitAppliesTheGlobalIgnoreQuietly
- **GIVEN** a user whose `~/.gitconfig` names a global ignore file in the home folder that ignores `*.log`, and a confined shell in a git repository holding `debug.log`
- **WHEN** the shell runs `git status`
- **THEN** git prints no warning about that file, does not list `debug.log`, and the home folder stays unreadable

### Requirement: TheTerminalBadgeIsEarned

The terminal's confined badge SHALL be shown closed only when the canary passed for the terminal's
runner, with the terminal's policy; when an attempt got through, the badge SHALL be shown open and
marked as a failure, naming it; while the canary runs, it SHALL say so.

#### Scenario: AnUnverifiedTerminalIsNotCalledConfined
- **GIVEN** `terminal.sandbox` set, a runner that passed its self-check, and a canary that has not finished
- **WHEN** the terminal panel opens
- **THEN** the badge says the confinement is being checked, not that it is confined

#### Scenario: ALeakingTerminalSaysSo
- **GIVEN** `terminal.sandbox` set and a canary that could write beside the root
- **WHEN** the terminal panel opens
- **THEN** the badge is open, marked as a failure, and names the write beside the root

### Requirement: ResizeTheTerminalHeight
The terminal SHALL expose a draggable, focusable top border outside maximized mode. Height SHALL range from 160 to 640 pixels, capped at 65vh, defaulting to 288 pixels. Up/Down SHALL adjust by 16 pixels; Home SHALL reset. Completed changes SHALL persist locally; cancellation SHALL roll back. Maximize/restore and minimize/reopen SHALL preserve the preference and session. Actual terminal dimensions SHALL reach the shell.

#### Scenario: ResizeTerminalHeight
- **GIVEN** an open terminal
- **WHEN** its top border is dragged vertically or adjusted with Up/Down
- **THEN** the panel follows that movement and terminal rows are resized without reopening the shell

#### Scenario: TerminalHeightBoundsAndCancel
- **GIVEN** an active height drag
- **WHEN** the pointer crosses the limits or the drag is cancelled
- **THEN** the height is bounded or restored respectively, and cancellation does not persist a change

#### Scenario: RestoreTerminalHeight
- **GIVEN** a completed height adjustment
- **WHEN** the terminal is maximized then restored, minimized then opened, or the page reloads
- **THEN** the preferred height is restored

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
