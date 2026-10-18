# Handover — mxc-linux-bubblewrap (2026-10-18)

State of the implementation of PR #328 when work moved from a Windows machine (disk full, Docker
Desktop down) to macOS. Read with `proposal.md`, the two delta specs and `tasks.md`.

## Branches

- `proposal/mxc-linux-bubblewrap` (this change, PR #328, draft) is stacked on
  `proposal/mxc-network-allowlist` (PR #327, draft: `sandbox.allowedHosts` and the egress proxy).
  #328's PR base is #327's branch; once #327 merges, retarget #328 to `main`.
- PR #326 (`fix/mxc-explicit-ui-policy`: MXC `ui.clipboard: "none"`, `ui.injection: false`) touches
  `mxcTerminalConfig` too: whichever of #326/#327 merges second needs a small rebase.

## Done (code, unit-tested, typecheck and lint clean)

| Piece | Where |
|---|---|
| `"mxc"` resolves per platform: `wxc-exec.exe` on Windows, `lxc-exec` on Linux (`bin/<arch>/`), none on macOS | `server/src/mxcExecutor.ts` (`mxcExecutorName`, `platform` in the lookup); `buildExe.ts` asks for Windows' explicitly |
| A path whose file is `lxc-exec` is MXC (`runnerKind`), `isLinuxMxc` tells the Linux one apart | `server/src/terminalSandbox.ts` |
| Linux self-check: one confined `/bin/true` in Bubblewrap with `egress: allow` (the most demanding shape), MXC's own `{"error":{"message"}}` as the reason; `lxc-exec` refused off Linux, `wxc-exec` refused off Windows | `checkLinuxMxcRunner`, `mxcErrorMessage` in `terminalSandbox.ts` |
| The Bubblewrap request: system trees that exist (`linuxSystemTrees`), search-path installations, shell folder, git config read-only; root and temp writable (or a narrower zone inside a read-only root); agent dir and config denied; POSIX-quoted command line; network `egress: allow`, or under `allowedHosts` `egress: deny` + `ingress: deny` + `runtimeConfig.networkProxy` | `mxcLinuxConfig`, `quotePosixArgument` in `terminalSandbox.ts` |
| Agent's shell uses it | `server/src/confinedBash.ts` (branch `kind === "mxc" && isLinuxMxc`) |
| Terminal uses it | `server/src/index.ts` (`terminalConfinement`); `terminalManager.ts`: `getCwd` finds the shell under `lxc-exec` → `bwrap` → `bwrap`, skipping `slirp4netns` (`shellUnder`, `childrenOf`) |
| `bashImage` refused with MXC's Linux executor (WSLC is Windows only) | `server/src/config.ts` |
| Docs: *Linux, as an option: MXC*, table row, allowedHosts wording, README rows | `docs/sandboxing.md`, `README.md` |

Unit tests added or changed: `server/test/terminalSandbox.test.ts` (runnerKind, Linux check,
`mxcLinuxConfig`), `server/test/mxcExecutor.test.ts` (made platform-explicit — they would otherwise
look for `lxc-exec` on Linux CI — plus the Linux lookup), `server/test/config.test.ts`. On Windows:
183 pass, 0 fail across the touched suites. **Not yet run on Linux or macOS.**

## Not done — what to do on macOS

1. **Run the real-executor tests** (they have never run):

   ```bash
   bash scripts/mxc-linux/test.sh
   ```

   It builds `scripts/mxc-linux/Dockerfile` from the working tree (tracked files, plus new ones under
   `server/` and `scripts/`), then runs the container twice:
   - Docker's default profile with `MXC_LINUX_EXPECT=refused` — `AContainerWithoutNamespacesRefusesWithTheReason`;
   - `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt no-new-privileges --device /dev/net/tun`
     with `MXC_LINUX_EXPECT=confined` — `server/test/confinedBashMxcLinux.test.ts` and
     `server/test/terminalSandboxMxcLinux.test.ts`.

   On Windows every attempt died in `npm ci` (BuildKit EOF, then the engine's data disk read-only):
   the host disk was full. The Dockerfile already installs only `server`, `shared` and `office`, with
   `--maxsockets=4`; revert those if they turn out unnecessary. The CMD picks `bin/x64` or `bin/arm64`
   from `uname -m`, so Apple silicon runs the arm64 `lxc-exec`.

   Things that may need fixing once it runs (unverified guesses, in likely order):
   - npm 11 blocks install scripts without approval (`npm install-scripts approve`): node-pty may not
     build, and the terminal test would fail on `node-pty`. Approve it, or install with scripts allowed.
   - `mxcLinuxConfig` mounts `/usr /etc /lib /lib64 /bin /sbin` and the search path's trees; the
     command's `HOME` is the root. If git or bash need more (e.g. `/run` for DNS on some images), the
     failure will say which path.
   - `getCwd` relies on `/proc/<pid>/cwd` of the shell inside the sandbox reading as the host path
     (Bubblewrap binds paths at the same place). Check the test `the shell's working directory…`.
   - On Docker Desktop for Mac there is no AppArmor; `apparmor=unconfined` is harmless. Whether its
     VM allows user namespaces under `seccomp=unconfined` and has `/dev/net/tun` is not known.

2. **Running-app check with the agent** (CLAUDE.md requires it): run pi-outpost in that container
   (`bashRunner: "mxc"`, `terminal.sandbox: "mxc"`, `allowedHosts: ["registry.npmjs.org"]`), mount an
   agent directory holding only `auth.json` (copy, not the real one), drive it with Playwright or the
   UI, ask it to curl an allowed and an unlisted host and to read outside the root; read back the
   session transcript. Open the terminal panel and run `git status`.

3. **Finish the paperwork**: write `scenario-coverage.md` statuses from the real runs (it lists the
   evidence each scenario needs), tick tasks 7–8, `npx openspec validate mxc-linux-bubblewrap --strict`,
   `npm run check:scenarios`, run the server suite, update PR #328's description (Tests, Documentation
   impact) and take it out of draft.

## Measured facts this rests on (Windows host, Docker Desktop 29.8.2, MXC 1.0.1)

- Bubblewrap under Docker defaults: refused, "unprivileged user and network namespaces … refused".
- With seccomp + AppArmor unconfined: confined; any `network.egress` rule also needs `/dev/net/tun`
  (slirp4netns) and `iptables`. No `network` field at all: no network, no tun needed.
- Under the full flags: siblings and agent dir not found, writes only in the root, no key, git works,
  6 processes visible (PID 1 `bwrap`, the server absent); proxy shape works with `ingress: deny`
  (Bubblewrap refuses `ingress: allow` beside a proxy, the opposite of Windows); MXC rewrites
  `HTTPS_PROXY` to `http://10.0.2.2:<port>/`.
- The runner's own environment is visible inside as `bwrap`'s: pi-outpost must keep handing the runner
  the minimal environment (it does: `confinedBash.ts` `run(..., { env })`).
- A pty through `lxc-exec` works: size 40×120 reaches the shell, a resize to 50×150 too, Ctrl-C
  interrupts without killing it (probe with Python's `pty`, not node-pty).
- `@microsoft/mxc-sdk` has no `os` restriction (installed on Linux); `lxc-exec` is mode 0755 in the
  tarball; `engines.node >= 24` (hence `node:24-bookworm`).
