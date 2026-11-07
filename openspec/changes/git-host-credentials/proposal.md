# Proposal

## Why

Adding a private Git repository under **Agent resources** is a dead end today (issue #425). Git runs
non-interactively by design, so a repository that needs a login fails, and the failure message shows
git's first stderr line, `Cloning into '…'...`, instead of the `fatal: could not read Username…`
line that says why. Even once the cause is known, the product offers no way to supply credentials:
the operator has to open a shell on the server (in Docker, inside the container, in a home directory
that is not even a volume) and configure a git credential helper the documentation never mentions.
Model credentials stopped being a dead end when the browser started asking for them; Git hosts
should work the same way.

## What Changes

- **Git failures name their cause.** A failing git command reports its `fatal:` / `error:` line
  rather than its first line, which for a clone is a progress line. This applies to every git command
  the server runs, not only Agent resources.
- **Authentication failures are recognised** on clone and on refresh of an Agent-resources
  repository (`could not read Username`, `Authentication failed`, HTTP 401/403, `Permission denied
  (publickey)`) and reported as such, naming the host, instead of as a generic clone failure.
- **pi-outpost keeps HTTPS credentials per Git host**, in the agent directory next to the provider
  credentials, readable by the server only, and never sent back to a client. They are offered to
  Agent-resources git commands through a read-only credential helper of pi-outpost's own, consulted
  **after** whatever authentication the deployment already configured, so existing helpers, SSH
  agents and keys keep working and are never copied.
- **The panel asks instead of failing.** When a clone or refresh fails for authentication over
  HTTPS, Agent resources shows "`<host>` requires authentication" with a user name and a token, stores
  them, and retries.
- **An address with embedded credentials** (`https://user:token@host/…`) feeds the same store instead
  of being discarded after the clone, so later refreshes keep working. The stored remote stays free of
  credentials, as today.
- **Settings → Accounts lists Git hosts** with stored credentials (host and user name, never the
  token) and lets them be removed. `credentialsLock: true` makes the list read-only and refuses
  storing or removing, as for model providers.
- **Sandboxed shells cannot read the store**, like `auth.json`.
- **Documentation**: a *Git credentials for Agent resources* section — the panel, the address form,
  the deployment-side alternatives (credential helper, SSH key or agent), and where they must live to
  survive a container being recreated.
- SSH is out of scope for storage: an SSH authentication failure is named and points to the
  documentation, but no key is managed by pi-outpost.

## Capabilities

### New Capabilities
- `git-host-credentials`: HTTPS credentials pi-outpost keeps per Git host — where they are stored and
  who may read them, how git is offered them, how they are entered, listed, removed and locked.

### Modified Capabilities
- `agent-resource-management`: *Non-interactive git execution* no longer forbids storing
  credentials — it keeps git prompt-free, keeps deployment authentication first, and turns an
  authentication failure into a request for credentials; embedded address credentials are stored
  rather than discarded.
- `git`: *GitFailuresSayWhy* keeps git's reason line (`fatal:` / `error:`), not its first line.

## Impact

- **Server**: `server/src/git.ts` (`gitFailureMessage`), `server/src/resourceRepositories.ts`
  (clone, fetch, error classification, embedded-credential capture), a new credential store and
  helper entry point, WebSocket handlers in `server/src/index.ts` with the `credentialsLock` check,
  `server/src/terminalSandbox.ts` (deny reading the store — covered if it lives in the agent
  directory, verified by test), CLI dispatch for the helper entry point.
- **Protocol**: `shared/src/protocol.ts` — an authentication-required clone/refresh outcome, messages
  to store and remove a host credential, the host list in the credentials snapshot (no secret).
- **UI**: `ui/src/components/AgentResourceManager.tsx` (credential prompt and retry),
  `ui/src/components/SettingsMenu.tsx` (Git hosts under Accounts), `ui/src/useAgent.ts`.
- **Docs**: `docs/configuration.md`, `docs/docker.md`.
- **Multi-user mode** (`multi-user-local-accounts`, in flight): Git host credentials are server-wide
  like provider credentials, so their management falls under the administrator role there.
- No new dependency. No change to the clone safety rules (hooks off, no submodules, address passed as
  data).
