# Implementation Tasks: Integrated Interactive Web Terminal

## Tasks

- [x] Protocol definitions in `@pi-outpost/shared/src/protocol.ts`
  - [x] Client messages: `terminal_open`, `terminal_input`, `terminal_resize`, `terminal_get_cwd`, `terminal_close`
  - [x] Server messages: `terminal_data`, `terminal_cwd`, `terminal_exit`, `terminal_error`
  - [x] Session snapshot extension: `terminal?: { enabled: boolean, locked?: boolean }`
- [x] Server configuration and CLI in `@pi-outpost/server`
  - [x] Add `TerminalConfig` and `terminal.enabled` (default `false`) in `config.ts`
  - [x] Add `terminal` lock in `sandboxLocks`
  - [x] Add `--terminal` and `--no-terminal` CLI flags in `cli.ts`
  - [x] Support `PI_OUTPOST_TERMINAL` environment variable
- [x] Server PTY manager in `@pi-outpost/server/src/terminalManager.ts`
  - [x] Lazy-load `node-pty` to support single-file bundles and environments without C++ build tools
  - [x] Enforce per-socket session isolation (`socketSessions`)
  - [x] Resolve current working directory (`/proc/<pid>/cwd` on Linux, `lsof` on macOS)
  - [x] Clean up all PTY processes on socket disconnect
- [x] React UI in `@pi-outpost/ui`
  - [x] `TerminalPanel.tsx`: xterm.js integration with `@xterm/addon-fit` and `@xterm/addon-web-links`
  - [x] Multi-tab terminal management with tab adding and closing
  - [x] Double-click inline tab renaming
  - [x] Throttled PWD resolution and OSC 7 directory capture
  - [x] 1-click `🎯 Sync LLM` button to reposition workspace root
  - [x] Header toggle button `>_ terminal` matching `⚒ tools` typography
  - [x] Global keyboard shortcut `Ctrl+\`` (or `Cmd+\``)
- [x] Documentation & Tests
  - [x] Server unit tests in `server/test/terminalManager.test.ts`
  - [x] UI unit tests in `ui/src/components/TerminalPanel.test.tsx`
  - [x] OpenSpec delta specifications in `specs/`
  - [x] Documentation in `README.md`
