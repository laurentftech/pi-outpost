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
