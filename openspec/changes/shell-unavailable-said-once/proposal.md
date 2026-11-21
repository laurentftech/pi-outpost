## Why

A colleague installed pi-outpost on a Windows 11 that lacked the August 2026 cumulative update. The default sandbox (`bashRunner: "auto"`) found MXC unable to confine there and refused every command, as it must — but nothing said so plainly:

- The startup line claimed `powershell (confined by mxc, …)`.
- The next line read `could not check mxc's confinement: MXC would confine terminals with tier …` — a hiccup, about terminals, with the consequence (no shell for the agent) unsaid and the fix at the end of a sentence. When the check failed fast, during startup, that line was not printed at all.
- The padlock said `⛔ shell unavailable`, its reason only in a tooltip.
- The reason the agent and the tooltip gave nested three messages: `mxc cannot confine it on this machine — bash is confined by mxc, which cannot run it: MXC would confine terminals …`.

## What Changes

- MXC's check returns, beside its reason, the remedy as data (`windows-update`: installed build, the build needed, the update by name), carried by the shell's verdict to the interface.
- One reason, said the same everywhere — tool, console, padlock: the shell is unavailable on this machine, what is missing, that no command runs unconfined, install the update and restart, and only then the way round (`"sandbox.bashRunner": "none"`) with its cost. Bare, without the wrapping of the error that carried it.
- The console says `checking mxc, chosen automatically: no command runs until it shows it confines` until the check answers, then the refusal itself; a verdict settled before the server listened is told too. The terminal's line says no terminal opens, and what to install.
- A dialog, shown once per cause in a browser, with Windows Update to open and no switch to run unconfined; the padlock reads `unavailable — Windows update needed` and opens it again.
- The startup line names each MSYS2 folder once.

## Capabilities

### Modified Capabilities

- `sandbox-defaults`: `AutoFailsClosed` reworded; adds `AMachineThatCannotConfineIsSaidOnce`.

## Impact

- `shared/src/protocol.ts` (`ConfinementRemedy`, on the failed and unavailable verdicts).
- `server/src/terminalSandbox.ts`, `confinedBash.ts`, `confinementCanary.ts`, `confinementStatus.ts`, `index.ts`.
- `ui/src/components/ShellUnavailableDialog.tsx` (new), `ConfinementLock.tsx`, `ModelBar.tsx`, `App.tsx`.
- Test-only variables `PI_OUTPOST_TEST_MXC_TIER` and `PI_OUTPOST_TEST_WINDOWS_BUILD`: they can make MXC's check fail and change the build it names, never make it pass.
