# Design: Integrated Interactive Web Terminal

## Architecture

```
┌────────────────────────────────────────────────────────┐
│ Browser (React UI)                                     │
│  - Header button: ">_ terminal"                        │
│  - Panel: xterm.js (tabs, inline rename, fit, links)   │
│  - Shortcut: Ctrl+` (toggle minimize)                  │
│  - Throttled PWD query / OSC 7 directory capture       │
└────────────────────────▲───────────────────────────────┘
                         │ WebSocket (JSON RPC protocol)
┌────────────────────────▼───────────────────────────────┐
│ Server (Fastify + WebSocket)                           │
│  - Gate: config.terminal.enabled && sandbox.allowBash  │
│  - TerminalManager (per-socket isolation)              │
│  - node-pty (lazy-loaded optional dependency)          │
│  - Linux: /proc/<pid>/cwd, macOS: lsof                 │
└────────────────────────────────────────────────────────┘
```

## Security & Isolation Model

1. **Explicit Opt-in**:
   The terminal is disabled by default (`config.terminal.enabled: false`). Operators must explicitly opt-in via `--terminal`, `PI_OUTPOST_TERMINAL=1`, or `"terminal": { "enabled": true }` in their configuration file.

2. **Per-Socket Isolation**:
   Sessions are stored in a nested map `socketSessions: Map<WebSocket, Map<string, TerminalSession>>`.
   All operations (`write`, `resize`, `getCwd`, `close`) require the requesting `WebSocket` instance to own the target `terminalId`. Multiple clients connected concurrently cannot inspect or inject commands into each other's shells.

3. **Lifecycle Management**:
   When a client closes its browser or disconnects, the server immediately kills all associated PTY processes and deletes the sessions from memory.

4. **Graceful Degradation**:
   `node-pty` is an optional dependency. In environments where native addons cannot be compiled, the server boots normally, and any client attempting to open a terminal receives a clean `terminal_error` instead of crashing the process.
