## Context
Requested intent: installed shells per new tab, PowerShell default on Windows, normal terminal keyboard shortcuts. Existing terminal spec covers tabs and Windows confined PowerShell but no general shell choice. OpenLore located TerminalManager.getDefaultShell/open; source confirms Git Bash was the unconfined default. OpenLore graph unavailable; targeted rg inspection supplied wire/UI ownership.

## Decisions
Use server-issued IDs, never executable paths from clients. Resolve again on open so removed executables are refused. Preserve config default and each existing tab. Filter Windows Git Bash under confinement and pass selected shells through the existing runner. Shell choice affects new tabs only; default remains explicit in the selector.
Native browser paste uses xterm's paste handler, avoiding clipboard-read permissions and preserving bracketed paste. Copy selection via clipboard-write; Ctrl+C without selection stays interrupt.

## Risks
Shell discovery reflects server PATH, not client machine. Configured shells retain operator arguments. Windows/macOS confinement stays runner-controlled; existing platform confinement suites remain applicable regressions.
