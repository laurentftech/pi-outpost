# Change Proposal: Integrated Interactive Web Terminal

## Why

When deploying Pi Outpost on a remote server or headless Linux VM (e.g. Red Hat, Ubuntu) and connecting from a remote browser (e.g. Windows/macOS), the operator currently has to open and manage a separate SSH session or terminal to run manual commands, build scripts, or inspect system logs.

Integrating a full-featured interactive pseudo-terminal (PTY) directly into Pi Outpost:
- Eliminates the need for a separate SSH client.
- Automatically opens shells inside the active workspace (`cwd`).
- Leverages the existing authenticated WebSocket connection without requiring extra open ports or complex network configuration.
- Allows running interactive CLI and TUI tools (`htop`, `vim`, `git`, `npm`, etc.) alongside the agent.
- Provides 1-click workspace alignment (`🎯 Sync LLM`) from the active shell's working directory.

## What

1. **Configuration & Opt-in Boundary**:
   - `terminal: { enabled: boolean }` in `config.ts` (defaulting to **false** — explicit opt-in only).
   - CLI flags: `--terminal` / `--no-terminal` and env variable `PI_OUTPOST_TERMINAL`.
   - Sandbox locks: `sandboxLocks.terminal` to prevent UI tampering when locked.
   - Dual server-side enforcement: `config.terminal.enabled && sandbox.allowBash !== false`.

2. **Per-Socket Isolation & Security**:
   - Terminal sessions are strictly scoped to the WebSocket connection that created them (`socketSessions` map).
   - Operations (`write`, `resize`, `getCwd`, `close`) strictly verify socket ownership.
   - Disconnecting a socket automatically terminates and cleans up all of its terminal processes.

3. **Packaging & Graceful Degradation**:
   - `node-pty` declared as `optionalDependencies` so installation never fails on machines lacking C++ build toolchains.
   - `TerminalManager` lazy-loads `node-pty` at runtime; gracefully reports an error if the native module is absent without crashing the server or single-executable SEA builds.

4. **Protocol & Shared Types (`@pi-outpost/shared`)**:
   - `terminal_open`: `{ terminalId: string, cwd?: string, cols?: number, rows?: number }`
   - `terminal_input`: `{ terminalId: string, data: string }`
   - `terminal_resize`: `{ terminalId: string, cols: number, rows: number }`
   - `terminal_get_cwd`: `{ terminalId: string }`
   - `terminal_cwd`: `{ terminalId: string, cwd: string }`
   - `terminal_close`: `{ terminalId: string }`
   - `terminal_data`: `{ terminalId: string, data: string }`
   - `terminal_exit`: `{ terminalId: string, exitCode?: number }`
   - `terminal_error`: `{ terminalId: string, message: string }`
   - `SessionSnapshot.terminal`: `{ enabled: boolean, locked?: boolean }`

5. **Frontend Terminal UI (`@pi-outpost/ui`)**:
   - `@xterm/xterm` with `@xterm/addon-fit` and `@xterm/addon-web-links`.
   - Multi-tab support (`bash 1`, `bash 2`, `+` button) with double-click inline tab renaming.
   - Real-time PWD detection with throttling and OSC 7 sequence parsing.
   - `🎯 Sync LLM` button to reposition the LLM workspace, file browser, and git state in 1 click.
   - Global keyboard shortcut `Ctrl+\`` / `Cmd+\`` to toggle panel visibility without unmounting/killing background tasks.
   - Header button `>_ terminal` styled consistently with the existing `⚒ tools` button.
