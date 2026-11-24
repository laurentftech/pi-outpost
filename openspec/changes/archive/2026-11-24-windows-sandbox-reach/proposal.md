## Why

Three issues from one user of the agent's confined PowerShell under MXC on Windows, all the same shape: a
command is refused something the sandbox means to allow, and the error points elsewhere.

- **#553: a tool beside the project cannot run.** A folder on `PATH` is readable, but the folders above it
  are not — denied by name as siblings of the path to the root (`C:\dev` beside `C:\projects`), or under no
  allow at all. Opening a file inside works; resolving its path does not. Node's `realpathSync` `lstat`s every
  component from the drive down, so any script outside the root — every globally installed npm CLI — died on
  `EPERM: lstat 'C:\dev'`. Reproduced on Windows 11 24H2, mxc-sdk 1.1.0.
- **#552: the company's package mirror is refused.** `uv` failed with `os error 10013` on the internal PyPI
  mirror. Measured: the container reaches the Internet, but an address of the private network is refused
  with WSAEACCES — Windows grants a process container the private network only together with inbound
  connections from it (`ingress.default: "allow"`); an egress allow rule naming the ranges does not. The
  documentation says the network stays open.
- **#554**, the same session's broader probe. Its network part: the user's proxy variables were not passed,
  so behind a company proxy every connection timed out, with no sign the sandbox was involved; and a refused
  connection reads as a network fault. Its `scoop` part: shims installed outside the home were not followed
  to their program. The rest of #554 is not the sandbox: a 280-character file name is over NTFS' limit,
  `'C:\tools\…'` in a JavaScript probe holds a tab, libuv's `access(W_OK)` on Windows checks only the
  read-only attribute, and a process container is not a VM (`whoami`).

## What Changes

- **The folders above a readable tool or grant are enumerated** (MXC's `processContainer.filesystem.enumeratePaths`,
  `baseContainerSupportsEnumeratePaths`): listable and queryable, never read. Only those nothing else lets
  the command read — another drive's, or inside a denied sibling — never one the root's readable drive
  covers, where enumeration would take reading away. MXC enumerates a whole subtree, so what lies beside
  the way down is denied by name in each, as the siblings of the path to the root are. Not where MXC's probe
  says it cannot enumerate.
- **`sandbox.privateNetwork`**, boolean, default `false`: the user's explicit choice. `true`, without
  `allowedHosts`, MXC's request on Windows opens the private network (`ingress.default: "allow"`), keeping
  `hostLoopback` as it is. Absent, it stays closed, as before, and a refused connection says so (below).
  Under `allowedHosts` nothing changes: the proxy is the way out, and it reaches named intranet hosts itself,
  each asked about.
- **The user's package manager configuration is carried in, without credentials**: their `uv.toml`,
  `pip.ini`, `.npmrc`, Maven `settings.xml`, `gradle.properties`, Cargo `config.toml`, Go `env` and
  `NuGet.Config`, copied before each command where the confined tool reads it, each credential taken out by
  the file's own format. Measured: uv, pip, npm, Cargo, Go and dotnet then use the company's mirror (a
  `uv.toml` declaring it was not seen at all: `APPDATA` is the sandbox's).
- **A registry that needs the user's credentials goes through a relay in the server** (`registryRelay.ts`),
  which adds them: the copy names the relay, the agent uses the registry without ever reading the secret.
  Read only (GET, HEAD), the user's registries only, under a key; reached on the host's loopback, or through
  the command's proxy under `allowedHosts`.
- **A refused connection is named**: when a command's output reports WSAEACCES (`os error 10013`, `WinError
  10013`, .NET's sentence), it ends with a note saying the sandbox refused it, not to retry, and what this
  sandbox opens.
- **The user's proxy variables go with the command** when no `allowedHosts` proxy is its way out, and to the
  confined terminal — never one carrying a user or password, which the startup line names instead.
- **scoop's shims outside the home** (`C:\tools\scoop\shims`) are followed to their program, as the home's are.
- Found exercising the sandbox on a real project: under `allowedHosts` a program connecting directly fails
  with WSAENETUNREACH (10051), not 10013 — named by the same note, there only. And under Windows PowerShell
  5.1 a native program's stderr redirected with `2>&1` made `$?` false: `uv … 2>&1`, `java -version 2>&1`
  ended 1 though they succeeded. Such a command now ends with the program's own code.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: adds `AToolBesideTheRootResolves`, `TheIntranetIsReachable`,
  `PrivateNetworkMustBeABoolean`, `ASandboxRefusalIsNamed`, `ARedirectedStderrIsNoFailure`,
  `TheUsersMirrorIsSeen`, `TheCredentialsStayInTheServer`, `TheCompanyProxyReachesTheCommand`.

## Impact

`server/src/terminalSandbox.ts` (`mxcTerminalConfig`, `ancestorsToEnumerate`, `userProxyEnvironment`,
`toolInstallations`), `server/src/mxcSdk.ts`, `server/src/confinedBash.ts`, `server/src/config.ts`,
`server/src/sandbox.ts`, `server/src/confinementStatus.ts`, `server/src/terminalManager.ts`,
`server/src/index.ts`; `docs/sandboxing.md`, `docs/configuration.md`. The terminal follows
`sandbox.privateNetwork` as it follows `sandbox.hostLoopback`.
