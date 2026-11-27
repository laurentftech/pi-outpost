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
  openable folders (the temporary directory) stay denied. The foreign drive's way down is also not
  made readable on top of the drive's root (`foreignWay` stays out of `readonlyPaths`, the drive root
  stays in): a folder of the way down the security environment cannot open would refuse the whole
  policy, and the drive's root being readable is enough for traversal (#572). The way down still
  denies what lies beside it.
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
