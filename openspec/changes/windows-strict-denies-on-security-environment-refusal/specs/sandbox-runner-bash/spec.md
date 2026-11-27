# Spec Delta

## ADDED Requirements

### Requirement: StrictDeniesKeepOnlyOpenableEntries

Under MXC on Windows, when the host's process security environment refuses the policy over a denied
path it cannot open (`0x80070005`), the deny list SHALL be pruned — as the last fallback after the
enumeration levels — to the entries the host can open there, and capped well under the security
environment's size budget (measured 556 denied pass, 557 refuse the launch) with the entries that
carry the confinement first: the root's-drive siblings, the agent directory, the configuration file,
then the temporary directory's parent. Openable folders (the system temporary directory included)
SHALL stay denied by name.

#### Scenario: StrictDeniesKeepOnlyOpenableEntries
- **GIVEN** a Windows host joined to a domain, where building the process security environment over
  a denied file under the profile fails with `0x80070005`, the project root on `D:\projects\app`,
  and a denied entry that the host cannot open at all alongside the temporary directory
  `C:\Users\me\AppData\Local\Temp`
- **WHEN** a command of the confined shell is launched and the policy is refused at every enumeration
  level, then rebuilt in strict mode
- **THEN** the unopenable denied entry is absent from `deniedPaths`, the openable temporary directory
  is still present in `deniedPaths`, the launch succeeds confined, and the canary's beside-root bait
  in a fresh directory under `%TEMP%` is refused — the verdict is `verified`, not `leaking`, and the
  shell is not reported unavailable. On a foreign drive the way down SHALL also stay readable on top
  of the drive's root in strict mode: a path resolved through a denied folder fails (#553), which
  would break the shell's own scripts (observed: the canary's verdict never printed after the
  read-only pruning)
