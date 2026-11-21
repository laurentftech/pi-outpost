## Why

The goal of the sandbox is that an agent does real work without friction while the user stays protected. A real-agent run of a small model (Mistral's codestral, a canary: a small model shows where a tool's words mislead, which a strong one papers over) asked to build, test and run a FastAPI project with uv under the default configuration on Windows found four things standing between the agent and the work, none of them a refusal the sandbox owed the user:

- **A command given no timeout never ended.** The agent started `uv run uvicorn … --reload` to check its server answered; the turn waited on it for over an hour.
- **PowerShell wrote into the user's project.** `Microsoft\Windows\PowerShell\ModuleAnalysisCache` appeared in the project root: inside MXC's container `[Environment]::GetFolderPath('LocalApplicationData')` is empty, and PowerShell's module cache, written a few seconds after a lookup, lands in the working directory.
- **Python's messages reached the model damaged.** Python writes to a pipe in the ANSI code page, read as UTF-8: `Le fichier sp�cifi� est introuvable`.
- **Asking for the project's own folder was refused.** `pi-outpost init` writes the configuration into the project; a request for the folder the agent already works in was refused because it *holds* the configuration file — "the configuration file says what the sandbox is" — and the model asked again, run after run.

(The notes about the sandbox given where it refused nothing are `durable-sandbox-rules`' to fix, and are fixed there.)

## What Changes

- A confined command given no timeout is stopped after 300 seconds, its output ending with a sentence saying why and that a server needs a timeout of its own. It says nothing about the sandbox.
- `PSModuleAnalysisCachePath` points into the command's private temporary directory, for the agent's shell and the confined terminal.
- `PYTHONIOENCODING=utf-8` in the confined environment on Windows.
- A grant request for what the sandbox already gives grants nothing and runs, even when that directory holds a protected file; a request for the protected target itself, or anything outside the root holding it, is still refused.
- Found by running the task with a real model through a throwaway script (not kept; every defect it found has a test of its own).

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: adds `ACommandGivenNoTimeoutEnds`, `TheConfinedShellLeavesTheProjectAsItWas`, `ConfinedOutputReachesTheAgentUndamaged`.
- `sandbox-approved-grants`: `SomeTargetsCanNeverBeGranted` no longer refuses a directory the sandbox already gives for holding a protected file.

## Impact

- `server/src/confinedBash.ts` (default timeout), `server/src/terminalSandbox.ts` (`confinedEnvironment`), `server/src/sandboxGrants.ts`.
- `docs/sandboxing.md`.
