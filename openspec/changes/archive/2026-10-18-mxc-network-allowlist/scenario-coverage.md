# Scenario coverage

`orient` pointed at `server/src/terminalSandbox.ts` (`mxcTerminalConfig`) and the configuration; the
confined shell is built in `server/src/sandbox.ts` (`createSandboxedTools` → `confinedBashOperations`).
Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/mxc-network-allowlist`.

The real-executor tests run where `MXC_EXEC` names `wxc-exec.exe` and the host reaches
registry.npmjs.org (no CI runner has MXC tier 1); they passed on Windows 11, MXC 1.0.1.

| Scenario | Status | Test file and name |
|---|---|---|
| AnAllowedHostIsReached | covered | `server/test/confinedNetworkMxc.test.ts`: `AnAllowedHostIsReached: curl and git reach the allowed hosts, through the proxy` — real `wxc-exec.exe`, the agent's `powershell` operations with the proxy; asserts `curl=200` from registry.npmjs.org, a `git ls-remote` line from github.com, both targets in the proxy's relayed list, and no refusal note. `server/test/egressProxy.test.ts`: `a listed host is relayed, on its own port` — the tunnel answers 200 and carries the upstream's body. |
| PowerShellFetchesThroughTheProxy | covered | `server/test/confinedNetworkMxc.test.ts`: `PowerShellFetchesThroughTheProxy: Invoke-WebRequest, naming no proxy, reaches an allowed host` — asserts exit 0 and `status=200`. Without the prelude default, the same call goes direct and is refused (measured in the proposal). `server/test/confinedPowerShell.test.ts`: `the web cmdlets default to the sandbox's proxy when one is set, before the command runs`. |
| NoAllowlistKeepsTheNetwork | covered | `server/test/terminalSandbox.test.ts`: `NoAllowlistKeepsTheNetwork: …` — without a proxy, `network` is `{ egress: { default: "allow" } }` and `runtimeConfig` is absent; with one, denied egress, inbound and loopback allowed, the proxy set, and the same filesystem policy. `server/test/config.test.ts`: `AnAllowlistNeedsMxcWithoutAnImage: …` — no key leaves `allowedHosts` undefined. |
| AnotherHostIsRefusedWithTheReason | covered | `server/test/confinedNetworkMxc.test.ts`: `AnotherHostIsRefusedWithTheReason: …` — asserts curl's non-zero exit, that the output ends with `[pi-outpost] network refused: example.com — not in sandbox.allowedHosts.`, that the proxy's status line seen by `curl -v` names the host and the key, and that the refusal was logged. `server/test/egressProxy.test.ts`: `another host is refused with the host and the key in the status line, and logged` — also that a watcher hears refusals only while it watches. |
| TheProxyCannotBeBypassed | covered | `server/test/confinedNetworkMxc.test.ts`: `TheProxyCannotBeBypassed: …` — `curl --noproxy` to an allowed host returns `000` with a non-zero exit, `curl --noproxy` to another HTTP service on the host's loopback fails without its body, a raw TCP connect is refused, and the proxy relayed nothing. |
| AnAllowlistNeedsMxcWithoutAnImage | covered | `server/test/config.test.ts`: `AnAllowlistNeedsMxcWithoutAnImage: …` — kept (lower-cased) with `"mxc"` and with a `wxc-exec.exe` path; refused with the message naming the key, MXC and `bashImage` with no runner, with landstrip, and beside `bashImage`; malformed entries refused. |

Running app: a server with `allowedHosts: ["registry.npmjs.org"]` and MXC, the agent
(`openai-codex/gpt-6.1-sol`) asked to curl registry.npmjs.org and example.com — the tool result held
`HTTP 200`, then `response 403` and the note, and the agent answered that example.com is not in
`sandbox.allowedHosts`; the server logged the refusal. After a Settings apply sent as the browser sends
it (no `allowedHosts`), the same request was refused again with the note: the list is kept.
