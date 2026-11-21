## Why

The dialog of #534 put Windows Update first and running commands unconfined as small print. Many machines cannot take the update when their user wants: their updates are scheduled for them, or they are still on 23H2, which needs a move to 24H2 rather than a cumulative update. For them the way out is the configuration file, and editing JSON by hand to loosen a sandbox is the wrong place for a mistake. On 23H2 the dialog also had no remedy at all: only the server's raw reason.

## What Changes

- `pi-outpost config --unconfine`: sets `"sandbox.bashRunner": "none"`, one key, the file's layout kept, the cost printed, `--confine` named as the way back. It replaces the code comment that said there would be no such command: it is a command the user runs on their machine, as editing the file is; a confined command cannot write the file, and nothing in the interface runs it.
- A Windows before 24H2 gets a remedy: "Windows 11 24H2 or later, with the August 2026 cumulative update (KB5120998)", build 26100.9278.
- The dialog gives two ways out side by side — update Windows; if you cannot, run commands unconfined with the command, a copy button, and its cost in red — instead of a "To fix it" and a grey footnote. Still no button that loosens anything.
- The refusal, console and terminal lines say "Update Windows to build … or later" and name `pi-outpost config --unconfine`.

## Capabilities

### Modified Capabilities

- `sandbox-defaults`: adds `UnconfiningIsOneCommand` and `TheWaysOutAreSideBySide`.

## Impact

`server/src/confineCommand.ts`, `cli.ts`, `index.ts`, `terminalSandbox.ts`, `confinementStatus.ts`; `ui/src/components/ShellUnavailableDialog.tsx`; `docs/sandboxing.md`, `docs/command-line.md`.
