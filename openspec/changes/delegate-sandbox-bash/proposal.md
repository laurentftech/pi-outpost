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

## Capabilities

### New Capabilities

- `sandbox-delegated-bash`: bash supplied by a named sandboxing extension in place of pi-outpost's
  own, checked when the session starts and preserved across Settings changes.

### Modified Capabilities

None.

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
- `README.md`: the key, and a section on confining bash with an extension.
- No UI change. Embedded runtime only: a sandbox is refused under the RPC runtime already.
