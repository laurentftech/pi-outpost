## ADDED Requirements

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
