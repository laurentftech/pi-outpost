# Proposal

## Why

pi-outpost confines its file tools to the sandbox, but its `bash` is not path-confined: once
`allowBash` is on, a command can do anything the server's user can. A sandboxing extension such as
pi-landstrip supplies a confined `bash` (seccomp on Linux, its own file and network policy). Loaded
into pi-outpost today, it does nothing: the SDK keeps an application's tool over an extension's of
the same name, so pi-outpost's unconfined `bash` shadows the confined one, silently. This was
confirmed on the real server with pi-landstrip 0.19.4.

A deployment that cannot install a container runtime or bubblewrap — a corporate WSL machine — has
no other way to confine the agent's shell.

## What Changes

- **`sandbox.bashFrom`** names the extension that supplies `bash`: its package source as pi lists
  it (`"npm:pi-landstrip"`), or the path of its file or directory. While `allowBash` is on,
  pi-outpost then supplies no `bash` of its own, and does not exclude the name, so the extension's
  tool is the one in the session.
- **Fail closed.** A session whose `bash` does not come from the named extension refuses to start,
  naming the `bash` it found: none, Pi's own, pi-outpost's, or another extension's.
- **Settings keep it.** `bashFrom` is not edited from Settings. It is carried over when the sandbox
  is applied, and a change that would leave bash with nobody to supply it is rolled back, in memory
  and on disk, so the next start is not refused.
- Without `allowBash`, nothing changes: no `bash` is registered, the extension's included.
- **Warn when it is missed.** With `allowBash` on, no `bashFrom`, and an extension that registers
  `bash`, the server logs a warning and every browser opening the project gets it as a notification:
  the extension, the fact that the bash in use is not confined, and the `bashFrom` line to add.
- **Extensions read the server's agent directory.** pi-landstrip reads its global `sandbox.json`
  from `PI_CODING_AGENT_DIR`, or `~/.pi/agent` without it, not from the `agentDir` pi-outpost hands to
  its sessions. A policy written beside the server's packages was therefore never the one enforced.
  pi-outpost now exports `PI_CODING_AGENT_DIR` = `agentDir` in the embedded runtime. The terminal panel
  keeps the user's value.
- **Loaded skills are readable.** Skills live outside the project: bundled with pi-outpost, installed
  into the agent directory, in `~/.agents/skills`. The sandboxed `read` refused every one of them, so
  the agent was shown a skill it could not open, and went looking for it in the installation. This
  was seen often in the embedded widget. The read tools now also read each loaded skill's directory,
  read-only. Never the disk's root, the home directory, or a directory holding the agent directory.
- **The agent cannot rewrite what confines it.** None of pi-outpost's file-writing tools may write
  in a `.pi` directory under the writable zone. Every project counts as trusted, so pi-landstrip
  merges the project's `.pi/sandbox.json` over its global policy before every command. The agent
  could otherwise widen its own sandbox with `write`. Reading stays allowed, and so does the file
  browser.

## Capabilities

### New Capabilities

- `sandbox-delegated-bash`: bash supplied by a named sandboxing extension in place of pi-outpost's
  own, checked when the session starts and preserved across Settings changes.

### Modified Capabilities

- `file`:
  - the agent's file-writing tools refuse paths inside a `.pi` directory;
  - its read tools also read the loaded skills' directories.

## Impact

- `server/src/config.ts`: `SandboxConfig.bashFrom` and its validation.
- `server/src/sandbox.ts`:
  - no pi-outpost `bash` when delegated;
  - `delegatedBuiltIns`, `isFromExtension`, `assertDelegatedBash`, `SandboxDelegationError`.
- `server/src/index.ts`:
  - the session factory excludes and checks according to the delegation;
  - Settings carry `bashFrom`, and roll back a refused delegation.
- Tests:
  - `server/test/sandboxDelegatedBash.test.mjs`, on the real server and agent;
  - `server/test/config.test.ts`.
- `server/src/sandbox.ts` and `server/src/extractionOutput.ts`: `piConfigWriteRefusal` in `write`/`edit` and in
  `assertWritableDestination`, which every file-writing tool goes through.
- `server/test/sandboxPiConfig.test.ts`.
- `server/src/index.ts`: the `PI_CODING_AGENT_DIR` export; the shadowed-bash warning, logged and sent
  to each binding browser.
- `server/src/terminalManager.ts`: `terminalEnvironment` with overrides; the terminal gets the user's
  `PI_CODING_AGENT_DIR` back.
- `README.md`: the key, and a section on confining bash with an extension.
- `docs/sandboxing.md` (new) and `docs/how-to.md`.
- No UI change. Embedded runtime only: a sandbox is refused under the RPC runtime already.
