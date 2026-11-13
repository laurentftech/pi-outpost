# Design

## Context

- `gitFailureMessage` (`server/src/git.ts`) is shared by every git command the server runs and keeps
  the first stderr line. For a clone that is `Cloning into '…'...`; the cause is on a later `fatal:`
  line. `resourceRepositories.ts` then cuts the message again with its own `firstLine`.
- `resourceRepositories.ts` runs git with `nonInteractiveEnv()` (no terminal prompt, empty askpass,
  `GCM_INTERACTIVE=Never`, ssh `BatchMode`). It fetches **any** known repository, not only the
  clones it manages — some are the user's own working copies, with their own credential setup.
- After a clone from `https://user:token@host/…`, `repositoryAddressWithoutCredentials` rewrites
  `origin` without the credential, so the next fetch has none.
- Provider credentials live in the agent directory (`auth.json`, `models.json`, written `0600`).
  `terminalSandbox.ts` denies reading the agent directory and the configuration file to confined
  terminals and shells. Under Docker the agent directory is `/data/agent`, a volume; `HOME`
  (`/home/node`) is not.
- `credentialsLock` is enforced in `server/src/index.ts` (`credentialsRefused`), and the Accounts
  section of `SettingsMenu.tsx` renders the credentials snapshot.

## Goals / Non-Goals

**Goals:**
- One place decides what a git failure says, for every git caller.
- A credential reaches git without appearing on a command line, in an environment variable, in a log
  or in a client message.
- The deployment's existing git authentication is consulted first and never captured.

**Non-Goals:**
- SSH keys, known_hosts, or passphrases managed by pi-outpost.
- Credentials for the workspace's own Git features (commit map, diff, terminal git): those use the
  user's own git configuration, unchanged.
- Per-repository (path-scoped) credentials: one credential per scheme + host + port.
- Encrypting the store at rest: it has the same protection as `auth.json` (file mode, sandbox deny).

## Decisions

### 1. Reason line, chosen once in `gitFailureMessage`

Pick, from git's stderr split on `/\r?\n/`, the first line starting with `fatal:` or `error:`;
otherwise the last non-empty line. `resourceRepositories.ts` stops re-cutting with `firstLine` for
git errors (it keeps it for non-git errors such as `fs`). Fixing it at the source fixes every caller;
fixing it only in Agent resources would leave the same truncation in the Git panel.

### 2. Classify authentication failures from git's stderr

`runGit` in `resourceRepositories.ts` keeps the full stderr on its error object (not only the
message), and a classifier reads it:

- HTTPS: `could not read Username`, `could not read Password`, `Authentication failed`,
  `The requested URL returned error: 401` / `403`, `terminal prompts disabled`.
- SSH: `Permission denied (publickey`, `Host key verification failed`.

The result is `{ kind: "auth", scheme: "https" | "ssh", host }`, with the host taken from the
address the server already parsed, never from stderr. It travels to the client as a structured
outcome (see 6), not as text to be re-parsed.

Alternative considered: probing with `git ls-remote` before cloning. Rejected — one more round trip
on every clone, and refresh would still need classification.

### 3. Store: `<agentDir>/git-credentials`, in `git credential-store`'s format

One `https://user:secret@host[:port]` line per host, user and secret percent-encoded, written
atomically (temp file + rename) with mode `0600` and serialised per file. Keys are normalised:
lowercase scheme and host, default port omitted. Git reads the file directly on every lookup, so a
change takes effect at once without a restart.

Why the agent directory rather than the user config dir: it is where the server's credentials already
live, it is already unreadable from confined shells, and it is a volume in the Docker image. The
user config dir is not denied to sandboxes, and keeping the provider and Git secrets in one place
keeps one rule. When no agent directory is configured (the SDK default `~/.pi/agent`), the same rule
applies: the store goes where the server's `auth.json` is.

Why git's own format: lookups are then answered by `git credential-store`, a native git command,
instead of a pi-outpost process (see 4).

### 4. A read-only credential helper, as one shell line

Git is offered the store through a credential helper configured only on the git processes
`resourceRepositories.ts` spawns, through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
`GIT_CONFIG_VALUE_n` in their environment, with the store's path in `PI_OUTPOST_GIT_CREDENTIALS`:

```
!f() { if [ "$1" = get ]; then <git> credential-store --file="$PI_OUTPOST_GIT_CREDENTIALS" get; else cat >/dev/null; fi; }; f
```

- **Appended, not reset.** Environment config is read after the user's files, so git asks the
  deployment's own helpers first and ours last. An empty `credential.helper=` reset was rejected:
  these commands also fetch the user's own working copies, whose helpers must keep working.
- **`get` only.** After a successful authentication git sends `store` to *every* configured helper;
  git's `store` helper as such would then copy the deployment's credentials into our file. The
  wrapper swallows `store` and `erase` (reading stdin so git never writes into a closed pipe).
- **Rejected credentials.** On failure git sends `erase`; the wrapper ignores it. The stored
  credential stays until the user replaces or removes it, and the panel says it was refused.
- **`<git>`** is the executable the server runs, single-quoted, not a bare `git`: on a machine whose
  PATH lacks git, the helper would otherwise not find it. git runs `!` helpers through its shell,
  which Git for Windows ships.
- Nothing about the store — not even its path — appears on a command line; the secret reaches git
  only through git's own reader.

Alternatives considered:
- A hidden `pi-outpost git-credential` command answering `get`: rejected after measuring it. The
  bundle's external imports (the pi SDK, fastify) load before any code runs, so each call costs
  ~1.3 s with the npm bundle and ~2.5 s in development, and git calls a helper several times per
  operation.
- `http.extraHeader: Authorization: Basic …` through `GIT_CONFIG_*`: puts the secret in git's
  environment (readable from `/proc/<pid>/environ` by any process of the same user) and sends it on
  every request, redirects included.
- `GIT_ASKPASS` pointing at a script: contradicts the non-interactive rule, and git asks askpass for
  user name and password separately with only a prompt string to go by.

### 5. Embedded credentials go to the store before the clone

`cloneAndPreview` parses the address; when it carries a user name and secret for HTTPS (and the
lock is off), it stores them for that host, then clones the credential-free address, so the
credential is used through the helper exactly as a later fetch will use it. Under `credentialsLock`
nothing is stored and the embedded address is used for this clone only, as today.

### 6. Protocol

- `agent_resource_error` and the `failed` assessment gain an optional
  `auth?: { scheme: "https" | "ssh"; host: string }`. Whether credentials are locked is already in
  the credentials snapshot (`locked`), so the panel reads it there rather than per failure.
- New client messages: `set_git_host_credential { host, username, secret, requestId }` and
  `remove_git_host_credential { host, requestId }`, both refused under `credentialsLock` through
  `credentialsRefused`.
- The credentials snapshot gains `gitHosts: { host, username }[]`.

The panel keeps the address and folder it sent, stores the credential, then re-sends the same clone
(or refresh) request. A second authentication failure for the same host is shown on the prompt.

### 7. Sandbox

The store sits in the agent directory, already in `denyRead` for confined terminals and shells. A test
asserts the store's path is denied, so moving it later cannot silently expose it.

## Risks / Trade-offs

- [The helper is a shell line] → It contains no user data: the path travels in an environment
  variable and the git executable is single-quoted. Tested against real git on every CI platform.
- [A user's own helper prompts graphically despite `GCM_INTERACTIVE=Never`] → Unchanged from
  today: non-interactive rules already apply to it.
- [Secret at rest in clear text] → Same protection as provider keys (`0600`, sandbox deny, volume
  owned by the server user). Documented.
- [The deployment's credential is wrong and ours right] → git stops at the first helper that answers;
  ours is never reached. The message names the host; the documentation explains that deployment
  credentials win. Accepted: overriding the operator's setup would be worse.
- [Classifier misses a phrasing (localised git, unusual server)] → It falls back to the reason line
  from decision 1, which is already correct, just without the prompt. The patterns are tested against
  real git output for both schemes.
- [Multi-user mode] → Git host credentials are server-wide, like provider credentials; under
  `multi-user-local-accounts` their management is an administrator action like the rest of Agent
  resources.

## Migration Plan

Additive. No existing file changes format. A deployment that already relies on its own credential
helper keeps working unchanged, because that helper is consulted first. Rollback: remove the version;
the store file is left behind, unread, and can be deleted.
