## Why
The terminal starts Git Bash first on Windows and offers no per-tab choice. Users need installed shell choices and desktop clipboard shortcuts.

## What Changes
- Discover installed shells on the server and offer a choice beside the new-tab button.
- Default to Windows PowerShell; preserve explicit terminal.shell and shellArgs.
- Validate selected identifiers on the server, keep confinement, and do not offer Git Bash under Windows confinement.
- Ctrl+C copies selected text; without selection it interrupts. Ctrl+V and Ctrl+Shift+V use native paste.

## Capabilities
### Modified Capabilities
- terminal: shell selection and clipboard keyboard behavior.

## Impact
Terminal manager, protocol, React panel, tests and README.
