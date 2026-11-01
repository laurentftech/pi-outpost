# Design

## Context

See proposal.md for the motivation, and `specs/sandbox-approved-grants/spec.md` for the requirements.

The current code already makes most of this possible:

- **Each command gets its own policy.** `confinedBashOperations` (`server/src/confinedBash.ts`) builds a
  fresh policy and a private temporary directory per `exec`, then launches the runner. A grant can
  therefore reach one launch and no other.
- **The writable zone comes from the same inputs in every backend.** All of them build it from
  `allowWrite` and `writableRoot ?? root` (`server/src/terminalSandbox.ts`): `terminalPolicy`
  (landstrip), `mxcTerminalConfig` (MXC Windows), `mxcPosixConfig` (MXC Linux and macOS) and
  `seatbeltPolicy`. MXC Windows also denies, by name, every folder beside the path down to the root
  (`siblingsToDeny`). WSLC mounts fixed volumes when its container starts.
- **The network goes through one proxy per host list.** `sharedEgressProxy` keeps one proxy per
  `allowedHosts` list for the server's life, shared by the sessions and projects that have the same
  list. Each launch's runner may reach only the proxy URL it was given.
- **The shell tool is pi's own.** `createBashToolDefinition` or `createPowerShellToolDefinition` is
  registered in `createSandboxedTools` (`server/src/sandbox.ts`) with sequential execution. Its
  parameter schema belongs to pi.
- **Extension dialogs go through `ExtensionUiBridge`.** It holds pending `select`/`confirm`/`input`
  requests with timeout and abort, sent to clients as `extension_ui_request`.
- **A sandbox implies the embedded runtime.** The configuration refuses `sandbox` with
  `agentRuntime.mode: "rpc"`, so everything here runs in the server's own process.

## Goals / Non-Goals

**Goals:**
- An approval that cannot be forged by the model or by an extension, and that is bound to what it
  approves.
- A grant reaches exactly one launch, or one session's launches, and nothing shared with others.
- Every runner that can express an extra directory applies it the same way. One that cannot says so.

**Non-Goals:**
- Making a grant permanent (for example "add to `allowedHosts`" from the dialog). The user keeps
  editing the configuration or Settings for that.
- Deciding which user may approve in a multi-user deployment. That belongs to
  `multi-user-local-accounts`.
- Re-running the canary for a grant. The canary judges the base policy. A grant is a hole the user
  opened knowingly, and the badge reports it separately.

## Decisions

### D1. Hosts are asked about by the proxy, on connection; directories by the agent, with the command

**Hosts.** When a command connects to a host the list does not name, its proxy holds the connection and
asks the user (`sandbox_grant_request` with `kind: "connection"`), and relays or refuses on the answer.
The agent plays no part: a question exists only once a real connection happened.

*Why:* the first version had the agent ask for hosts, through `run_with_grant`. In the running app a
model asked to "open the website example.com" ran `Start-Process` on the URL, took the sandbox's refusal
for the network, and asked for a host grant that could not help — the user approved it for nothing.
Other runs needed two dialogs for one task, because the command failed after its approval and had to be
asked for again. Codex CLI, which also runs on MXC, does the same as this design: its network proxy holds
a connection to an unapproved host and asks the user (`NetworkApprovalContext`, allow once / for the
session), and the model is only involved for escalations a proxy cannot see.

**Directories.** A file access cannot be held the way a connection is, so the agent asks, with
`run_with_grant { command, directories: [{ path, access }], reason }`: approval is bound to that exact
command text, and the tool runs it once approved.

*Alternatives:* an escalation parameter on `bash`/`powershell`, as Codex's `require_escalated` and
`with_additional_permissions`. That would mean forking pi's tool schemas, and `require_escalated` runs the
command outside the sandbox entirely, which this change never does: a grant widens the sandbox, it never
removes it. A "request grant" tool followed by an ordinary command would let the model approve one
command and run another; binding the grant and the command in one call closes that.

The tool is registered next to the shell tool only under a runner, without `bashFrom`, and with
`sandbox.grants` other than `"never"`. It runs sequentially, like the shell tool.

### D2. Dedicated protocol messages, not `extension_ui_request`

The server sends `sandbox_grant_request { id, command, hosts, directories, reason, expiresAt }` and
accepts `sandbox_grant_response { id, decision: "once" | "session" | "refuse" }`. Once a decision is
made, it broadcasts `sandbox_grant_resolved { id, outcome }`, and pending requests are part of the
session snapshot so that a client connecting or reloading shows them.

*Why:*
- An extension can already raise a `confirm` dialog with any title. If grants reused that channel, an
  extension's dialog could imitate an approval, and the bridge's answer path would be one an extension
  could see.
- A distinct message gets a distinct, recognisable dialog. The command is shown verbatim, and the
  reason is labelled as the agent's words.

The pending map takes `ExtensionUiBridge`'s shape: timeout, abort signal, first answer wins, and
`cancelAll` when the session is replaced. It is a separate instance with its own message types.

### D3. A grant goes into the launch's policy inputs

The policy inputs gain `grantedRead` and `grantedWrite` (directories), merged into every backend's
inputs; hosts go to the command's own proxy instead (D4). `confinedBashOperations` reads the session's grants through a provider
function at each `exec`, so session grants apply to every later command without the session being
rebuilt. `run_with_grant` calls the same launch path with the once-grant added. In each backend:

- **landstrip** (`terminalPolicy`): `allowWrite` gets the write grants; the read grants join the
  readable set.
- **MXC Windows** (`mxcTerminalConfig`): the grants join `readwritePaths` and `readonlyPaths`. The
  sibling deny list is left as it is: MXC lets the more specific allow win over a denied sibling, as it
  already does for the temporary directory under the denied profile. A grant equal to a denied sibling
  drops that deny, since a path both allowed and denied is never sent. Measured with the real
  `wxc-exec.exe` (`sandboxGrantsReal.test.ts`): the granted directory beside the root is reached, and
  the next command without the grant reaches neither it nor its neighbour.
- **MXC Linux and macOS, Seatbelt**: the same additions to their read and write lists.
- **WSLC**: a directory grant is refused before the dialog
  (`EachRunnerAppliesAGrantOrSaysItCannot`).

`allowWrite: false` does not stop a write grant. The user approving it is the exception the setting
otherwise forbids. The dialog says so when it applies.

### D4. A proxy per command, asking about the hosts it is given

With someone to ask, each launch gets a proxy of its own for `allowedHosts ∪ sessionHosts`, with an
`ask` hook bound to that command, closed after it. An unlisted host is asked about once per command:
every connection to it waits on the same answer and keeps it. A forbidden host (an IP literal, a loopback
name) is refused without asking. "For this session" adds the host to the session's grants, so the next
command's proxy lists it. The shared proxy of the base list is left as it is, for commands with no one to
ask.

A proxy per command is what makes the question this command's — a shared proxy could not tell whose
connection it holds — and keeps a host allowed in one session out of every other. It holds only if each
runner lets a command reach its own proxy port and no other loopback port. MXC Windows is measured to
(`TheProxyCannotBeBypassed`, and a command cannot reach another command's proxy). MXC Linux, MXC macOS
and Seatbelt are tested in CI (`sandboxGrantsReal.test.ts`), and until that passes there nobody is asked
about a host under them (`hostGrantsRefusal`): an unlisted host is refused, as before.

The command's output ends with what was answered about each host (`[pi-outpost] network: the user
allowed example.com for this command.`); a refusal adds that the host is not to be retried for this
request. With no one to ask, the note is the one before this change.

*Alternative:* one proxy with per-command credentials (`http://token@127.0.0.1:port`). It needs fewer
ports, but the question is then only as good as every tool honouring proxy credentials. Rejected.

*Known limit:* a client may stop waiting before the user answers (curl's `-m`, git's own timeouts); the
command then fails, and the answer — kept for the session if given so — serves the next run.

### D5. Forbidden targets are checked by the server, after resolving

A directory is resolved with `realpath`. A directory that does not exist yet resolves through its
nearest existing ancestor. The result is refused if it equals, holds or lies inside the agent
directory or the configuration file, if it is or lies inside a `.pi` directory, or if it is a drive's
root or the home directory itself. On Windows these comparisons ignore case: `realpath` cannot give the
case of a part that does not exist yet, and `.PI` about to be created is the `.pi` it becomes. This
reuses `isWithin` and `realResolve` from `sandbox.ts`. A directory the sandbox already gives, with the
access asked, is dropped from the request; a request left empty runs as an ordinary command, without a
dialog.

A host a command connects to is never asked about when it is an IP literal or a loopback name
(`localhost`, `*.localhost`): its connection is refused at once, the proxy's answer and the note after
the command saying it is never granted.

The refusal happens before any dialog. A user cannot be talked into these targets.

### D6. Lifetime and storage

Session grants live in memory, keyed by the session's id within its workspace. They are cleared when
that session is replaced (new, switched to, forked), when the project's sandbox settings are applied,
and of course when the server restarts. Nothing is written to the configuration, to the project's
settings, or to the session file beyond the tool result.

### D7. Approval policy

- Five minutes without an answer refuses the request. So does an aborted turn.
- A request made while no client is connected to the workspace is refused at once.
- `sandbox.grants: "ask" | "never"` is read from the configuration only. Settings never edit it, like
  `bashRunner`.

**Default: `"ask"`.** A confined deployment that upgrades therefore gains the tool. An operator who
wants the old behaviour sets `"never"`.

### D8. Audit and display

The server logs one line per request, of the form `[sandbox] grant <approved once|approved for session|
refused|expired|forbidden>: <targets> for "<command>" — <reason>`. An approved command's tool result
starts with a line naming its grant, so the transcript keeps it.

The snapshot's confinement entry gains `grants`, the session's active grants. `ConfinementLock` shows
`🔒 shell confined · N grants` and lists them in its description. The verdict's `state` is never
changed by grants.

## Risks / Trade-offs

- **Approval fatigue.** Users click "allow" without reading, and grants become a rubber stamp.
  → Mitigation: the command is shown verbatim, targets with their access, and "session" is a deliberate
  second button, never the default. Forbidden targets are refused before the dialog. And "never" stays
  available to operators.
- **The model argues for a grant through its reason.** → Mitigation: the reason is shown as the agent's
  words, below the command and targets, never as the dialog's title.
- **MXC Windows denies by name at launch.** Something created after the launch is not denied, as
  already documented. A granted directory's siblings are denied as they exist at that launch.
  → Mitigation: this is the same limit as today; the docs say so for grants too.
- **Proxy isolation is assumed per runner.** If a runner let a command reach any loopback port,
  another command's proxy — and the question it holds — would be reachable. → Mitigation: a test per
  runner, and nobody is asked about hosts on a runner until it passes (`hostGrantsRefusal`).
- **A proxy per command.** Each command of a shell that can ask starts and closes a listener on the
  loopback. → Mitigation: it is a socket, not a process, and closing it ends the connections still
  waiting on an answer, so a command's end is never held by one.
- **Questions about hosts nobody typed.** Windows' TLS fetches a certificate authority's revocation
  list over HTTP (`crls.ssl.com` in the running app), and the user is asked about it. → Mitigation: it
  is a real connection, said as such; the docs recommend listing the authorities in `allowedHosts`.
- **The default changes behaviour on upgrade.** → Mitigation: the changelog and docs name
  `sandbox.grants: "never"`.

## Migration Plan

The change is additive. When it ships, confined shells gain `run_with_grant` and the refusal note
mentions it. Rollback for a deployment is `sandbox.grants: "never"`; for the code, a revert, since no
data is stored.

## Open Questions

- Should the dialog offer a third, permanent choice that adds the host to the project's settings?
  It is deferrable: it would be one more button and Settings write, without changing these grants.
- Is five minutes the right timeout, and should it be configurable? This can be tuned later without
  changing the specs' shape.
