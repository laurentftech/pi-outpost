# Design: one Windows MXC policy

## Decision

**Build the Windows MXC policy as a whitelist with the way down enumerable, and no deny list beyond the
agent directory and the configuration file.** One shape for every host; the strict mode and the readable
foreign way down are removed; a host that cannot enumerate gets no shell.

- Rationale: the deny list is what Windows refuses on managed machines (size budget, unopenable entries),
  and each workaround for it opened something (the strict mode's pruned entries, the readable way down on a
  foreign drive). A whitelist has nothing to prune. Measured on both hosts (#594): everything the shell
  runs works, and nothing beside the temporary directory is readable.
- Consequences: file **names** are listable on every drive holding an opened path, because MXC's
  `enumeratePaths` is recursive. Contents are not. A host at enumeration level 2 loses the shell (it would
  not resolve `node` anyway). The `siblings` input stops mattering under MXC on Windows.
- Superseded: the strict deny list (#590/#592, `windows-strict-denies-on-security-environment-refusal`), the
  readable foreign way down and its beside-the-way denies (#572, #582, #585 and their changes).

`record_decision` is not exposed by this workspace's OpenLore preset (`substrate`); this section is the
record.

## The policy

```
readwritePaths  writable root (if allowed), granted writes, the temporary directory
readonlyPaths   the root (when not writable), the shell's folder, Windows' own folders
                (SystemRoot, ProgramFiles*, ProgramData), the search path's tools, their
                installations, junction targets, read-only files, granted reads
enumeratePaths  the drive root of each path above, and every folder above the shell's folder,
                the tools and (level 0) the grants
deniedPaths     the agent directory, the configuration file
```

- **Windows' own folders readable.** Found by the real-executor suite: rustc looks for MSVC's `link.exe`
  under `Program Files` without `PATH` (`linker link.exe not found` under the strict whitelist). They
  were always readable under the drive-readable policy (never denied), hold no user data, and adding
  read-only entries costs Windows' security environment nothing (its budget is the deny list).
- **The root and the temporary directory need no enumerated ancestors**: they resolve through their
  drive's root, as measured on the target (whose policy enumerated only the tools' way down and the
  drive roots).

- **Drive roots enumerable, never readable.** Node's `realpathSync` lstats the drive root before walking a
  path (`EPERM: lstat 'L:\'` without it, measured). Enumerable is enough for it, and readable would open
  the drive.
- **The way down enumerable, never readable.** A readable `C:\Users\me\AppData\Local` opens the temporary
  directory's neighbours. Enumerable, the tools on `C:` still resolve from a root on `L:` — measured on the
  target, which is the case #572 had made readable for. The ancestors are computed as today
  (`ancestorsToEnumerate`); a junction is never enumerated, its target is readable.
- **Two denies.** The agent directory and the configuration file are already outside every allow. They
  stay denied as a second line: two entries, both openable (they were in every policy that launched on the
  target, strict included). Nothing else is denied, so the deny list can neither exceed the budget nor
  hold an entry the host cannot open.

## Levels and refusals

| level | what is enumerable | outcome |
|---|---|---|
| 0 | drive roots, the way down to the tools and to the grants | the policy |
| 1 | drive roots, the way down to the tools only | same confinement, fewer listed folders |
| 2 | nothing | **no shell**: unavailable, with the reason |

A `CreateProcessSecurityEnvironment` refusal steps 0 → 1 as today. At level 1 a refusal ends there: the
shell (and the confined terminal) is unavailable with the reason, and `sandbox:doctor` names the path,
as `sandbox:mxc-unopenable` does. No strict rebuild, no level 2 policy.

## The canary's AuthorizationManager failure

On the target, the dev server's canary failed with `AuthorizationManager check failed`
(`UnauthorizedAccess`, no script position) under the strict policy, while the probe's `.ps1` run the same
way passed. The server writes each command's script under the sandbox cache, and PowerShell's `-File`
resolves the script's path through its parents: under the strict mode a parent on that way was denied,
which fails before a line runs (the docs said so of the profile's `Temp`). The whitelist denies no parent,
so the failure should not recur; task 8 checks it on the target.

## Alternatives rejected

- **A git relay on loopback** (#593's first idea): git runs under the whitelist on both hosts, with and
  without enumeration. Not needed.
- **Node flags** (`--preserve-symlinks[-main]`): breaks pnpm (`Cannot find module 'body-parser'`, even
  unconfined); `-main` alone does not cover `require`.
- **Keeping the strict mode as a fallback**: a second policy to reason about, and its confinement depends on
  what it had to drop. The user asked for one policy.

## Risks

- **Names disclosed.** Stated in `docs/sandboxing.md` with the reason and microsoft/mxc#1461. A file name can
  be sensitive; contents, credentials and the agent's own files are not reachable.
- **A level-1 host refused at level 1** loses the shell where the strict mode used to start one. That host
  then runs with `bashRunner: "none"` or after the MXC fix, and the doctor says so.
- **Untested shapes.** Measured: root on `C:` (home) and root on `L:` with tools on `C:` and `L:` (target).
  A root on a network share or a subst drive is not measured; the unit tests pin the policy shape, the
  canary checks it on every start.
