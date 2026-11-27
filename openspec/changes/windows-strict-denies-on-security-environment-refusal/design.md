# Design: strict deny list as the last fallback before "unavailable"

## Mechanism

- `deniable()` (the normal filter for deny-by-name entries) falls back to a plain open for entries
  the exclusive open cannot take — right for files MXC opens without delete-sharing, but too loose
  when the *security environment builder* opens denied paths with more access: on a domain-joined
  account a denied file can be plain-openable yet make `CreateProcessSecurityEnvironment` fail
  `0x80070005`, refusing the whole policy.
- `strictlyDeniable(entry)` is the strict variant: on Windows a denied **file** must open with
  `O_RDONLY | UV_FS_O_EXLOCK` (no sharing at all); a denied **folder** only needs the plain open and
  must not be a link (Windows cannot open directory handles exclusively). On POSIX (the tests) it
  is `deniable`.
- `mxcTerminalConfig` takes `strictDenies?: boolean` (default: the host's remembered
  `mxcStrictDenies()` flag). In strict mode the beside-the-way listing is filtered with
  `strictlyDeniable`, and the final `deniedPaths` (siblings, beside-the-way, agentDir, configFile)
  is filtered with it too — so a path that would break the security environment is left out, while
  openable folders (the temporary directory) stay denied. The deny list is then capped well under
  the security environment's size budget (`STRICT_DENY_BUDGET = 256`; measured on a domain-joined
  host: 556 denied entries pass, 557 refuse the launch), keeping first the entries that carry the
  confinement — the root's-drive siblings, the agent directory and the configuration file, then the
  temporary directory's parent (the canary's beside-root bait lives there). The foreign drive's way
  down stays readable on top of the drive's root (`foreignWay` stays in `readonlyPaths`): the budget
  is spent on the denied list, not the read-only one, and pruning the readable way down instead left
  the folders above the temporary directory denied — a path resolved through a denied folder fails
  (#553), which broke the canary's own script so its verdict never printed. The way down still
  denies what lies beside it.
- The command's scratch directory is created under a granted write folder (the sandbox cache)
  when there is one, not under the system temporary directory: on a foreign drive the profile's
  Temp is denied by name as a child of the way down, and PowerShell's `-File` resolves the script
  path through its parents — a denied parent fails that (AuthorizationManager,
  UnauthorizedAccess) before any command line runs, so the canary's own script died with no verdict
  (observed on the 0x80070005 host). Under the cache, every ancestor is on the way down and
  readable.
- The retry chains step the enumeration level down first (0→1→2, as before). Only when a refusal
  still occurs at the lowest level do they call `noteMxcStrictDenies()` and rebuild once at the same
  level; the flag is remembered, so later launches on the host go straight to the pruned deny list.
  If it still fails, the launch is refused as before (fail-closed, "unavailable") — never
  unconfined.

## Security

- The fallback only *removes* deny entries the host's own security environment cannot open — the
  alternative is no shell at all. Root's-drive siblings, the agent directory and the configuration
  file are filtered by the same rule: an unopenable one is dropped, an openable one (e.g. the
  profile's `Temp` folder) stays denied, so the canary's beside-root bait is still refused.
- The canary still judges confinement: if a pruned deny would have mattered, the verdict is
  `leaking` and `bashRunner: "auto"` refuses commands — the fallback cannot silently open a hole
  that the canary detects.

## Validation

- Unit: `StrictDeniesKeepOnlyOpenableEntries` in `server/test/terminalSandbox.test.ts` — with
  `strictDenies: true`, a denied entry the host cannot open is left out while an openable folder
  stays in `deniedPaths`; without it, both are kept.
- The existing level tests (`ForeignWayDownDeniedWithoutEnumeration`, `BesideTheForeignWayDownStaysDenied`)
  are unaffected (strict off by default).
