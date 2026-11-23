## Measured

Windows 11 24H2 (26100.9711), mxc-sdk 1.1.0, probe `base-container` with `baseContainerSupportsEnumeratePaths: true`.

**Folders above a tool.** Root under `C:\Users\…\Temp`, a tool in `C:\zz553\nodejs\current\bin` on `PATH`:

| | before | `enumeratePaths` on `C:\zz553`, `C:\zz553\nodejs` |
| --- | --- | --- |
| `node C:\zz553\…\foo.js` | `EPERM: lstat 'C:\zz553'` | runs |
| `realpath` of the tool's folder | EPERM | OK |
| read `C:\zz553\secret.txt` | refused | refused |
| list `C:\zz553\other` | refused | **listed** — enumeration covers the subtree |
| list `C:\zz553\other`, with `C:\zz553\other` also denied by name | — | refused |

Hence the deny by name beside the way down. Enumerating a folder already readable through the drive
(`C:\Program Files`) would make its subtree list-only: such folders are never enumerated.

**The private network.** A listener on the host, and the machine on `10.0.0.0/24`:

| `network` | `10.0.0.1:80` (gateway) | `1.1.1.1:443` | host's loopback | own LAN address |
| --- | --- | --- | --- | --- |
| `egress allow`, `ingress {deny, hostLoopback allow}` (before) | 10013 | connected | connected | connected |
| same, plus `egress.allow` to 10/8, 172.16/12, 192.168/16 | 10013 | connected | connected | — |
| `egress allow`, `ingress {allow, hostLoopback allow}` | connected | connected | connected | connected |
| `egress allow`, `ingress {allow}` | connected | connected | 10013 | 10013 |
| `egress allow` | 10013 | connected | 10013 | 10013 |

The two keys are independent. What Windows counts as private is the subnets the machine is on (and
intranet ranges a policy names): `10.254.254.254`, off-subnet, is not refused even when closed. The
machine's own address counts as its loopback.

## Decisions

**Enumerate, not read.** The folders above a tool are given the least that lets a path resolve. Reading
them would open other projects' files beside the tool; enumerating with the rest denied by name shows the
names on the way down and nothing else.

**Only what is opened by path beside the root.** The search path's folders, their installations, the
shell's folder and the grants. Not the temporary directory: it sits under the profile, whose `AppData\Local`
holds hundreds of entries each to deny at every launch, and it worked before. Not git's single files.

**`privateNetwork` off unless the user opens it.** Windows cannot open the intranet outbound alone: inbound
connections from it come too. Reaching the company's network is the user's decision, written in the
configuration, never the agent's — the refusal's note says only the user can open it. Under `allowedHosts`
the request is unchanged: each intranet host is asked about there.

**The user's configuration, copied without credentials, at each launch.** Commands cannot be given the
user's files: the profile is denied, and they hold tokens. A copy in the sandbox cache, where each tool
reads it — under the sandbox's `APPDATA` for uv, Go and NuGet (dotnet reads the variable, measured); named
by `PIP_CONFIG_FILE` (pip asks Windows for the roaming folder, measured), `npm_config_userconfig` and
`MAVEN_ARGS`; in Gradle's and Cargo's homes, already in the cache. `UV_CONFIG_FILE` was measured and
rejected: it replaces discovery, and the project's own `[tool.uv]` was no longer read. A copy carries a
first-line mark; only a marked file is replaced or removed, so a file a command wrote there is kept.
Credentials are taken out rather than the file left out: the mirror's address is what the user needs, and a
mirror that wants credentials answers 401, which says so.

**Proxy variables without credentials.** A `user:password@` proxy is a secret: left out, named on the
startup line so the operator knows why the command cannot get out. Under `allowedHosts` none are passed —
`NO_PROXY` would route around the server's proxy.

**A relay for the credentials, not the credentials.** Whatever a confined tool can read, a command can
print: a token in the sandbox is the agent's. The server runs unconfined and holds them; the copies name
its relay, which adds them. Read only, so the agent cannot publish in the user's name; only registries
the user's files name, under a key drawn at start (another local account cannot use it); links in what
a registry answers rewritten to the relay, its cookies dropped. Two routes because the container reaches
two things: the host's loopback, open by default, and, under `allowedHosts`, its proxy's port alone — the
proxy hands the reserved host `registry-relay.pi-outpost.invalid` to the relay. Credentials that cannot be
paired with a URL (Gradle's, Cargo's, encrypted ones) stay out. The user's `NO_PROXY` gains the loopback:
the company proxy must not carry a request for the relay.

**A refused connection judged by the policy, not by the words.** MXC's denial capture reports no
connection: measured, its report holds `file`, `other` (registry), `ui` and `capability` entries, the same
counts with the network open or closed while three connections were refused. And programs word it every
way, or not at all — of Node, curl, git, Python, Go, uv, npm, PowerShell, Java, a note keyed on the error's
words named three, and sent Java's `Permission denied: connect` to the file diagnosis. pi-outpost knows
the policy it asked for: on a failed command it resolves the hosts named in the command line, and in the
output where a URL or a connection names them (a bare address in a log is not one), and judges each
address as Windows does in the container — the machine's subnets, its own addresses as loopback. The
words remain a second signal, with Windows' own sentence asked of Windows in the user's language rather
than listed. All ten then named the host; the bare `Invoke-WebRequest` caught in a `try` printed nothing
failed, and gets nothing.

## Not done

- MXC reporting refused connections itself: to ask upstream (microsoft/mxc), then use it instead.

- A system proxy set by PAC or WinHTTP rather than variables: not read.
- Yarn Berry's `.yarnrc.yml`, bun's `bunfig.toml`, Poetry's and conda's configuration: not carried.
- `sandbox.allowedHosts` behind a company proxy: the server's proxy connects directly, with no upstream.

## Exercised on a real project

Root `C:\Users\<me>\pi-outpost`, the server's own `PATH` and sandbox cache, 18 folders enumerated, 250 paths
denied (78 before), the request built in 47 ms (29 before); each command about a second, as before.

- Every global npm CLI (`openspec`, `tsc`, `openlore`, in `AppData\Roaming\npm`) failed before this change on
  `EPERM: lstat 'C:\Users\<me>\AppData\Roaming'` — `AppData` a denied sibling of a root in the home. #553 was
  not only a tool on another folder of the drive: it was the common case.
- `~\.cargo` was enumerated as the folder above `~\.cargo\bin` and `CargoCredentialsStayOut` failed (listed, not
  read). A folder directly in the home is now never enumerated but `AppData`, as `toolInstallations` never
  opens one.
- `uv run` in a project whose `.venv` was made outside the sandbox works offline. But uv's user configuration
  is looked for under the sandbox's `APPDATA` (`…\sandbox-cache\appdata\Roaming\uv\uv.toml`): a mirror
  declared in the user's own `uv.toml`, `pip.ini` or `.npmrc` was not seen in the sandbox ("your mirrors and
  tokens are not carried in"). Now carried in, without credentials (Decisions).
- `dotnet` printed its first-run banner (welcome, telemetry, certificate) into the agent's output: `DOTNET_NOLOGO=1`.
- Under `allowedHosts`, a program connecting directly fails with 10051, not 10013: named too.
- Windows PowerShell 5.1: `uv pip install … 2>&1`, `java -version 2>&1` ended 1 though they succeeded.
- MXC's SDK runs `whoami /user` at import, through the shell's `PATH`: from Git Bash, GNU's `whoami` answers
  and prints `extra operand '/user'`. MXC's, harmless; to report upstream.
