# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/windows-foreign-drive-denied-at-every-level/` (1 scenario, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| ForeignWayDownDeniedWithoutEnumeration | covered | Unit: `server/test/terminalSandbox.test.ts`, "ForeignWayDownDeniedWithoutEnumeration: whatever the enumeration level — level 2 … or level 1 — …" — with a fake reader, at `enumerateAncestors: false` (level 2) and `enumerateGrants: false` (level 1): `C:\` and the way down on it (`C:\Users`, `…\AppData`, `…\AppData\Local`, the tool, the cache's folders) are in `readonlyPaths` and not in `deniedPaths`, `C:\Users\me\AppData\Local\Temp` and `…\AppData\Roaming` are in `deniedPaths`, the command's `tmp` stays in `readwritePaths` and not denied, `C:\Windows`/`C:\Program Files` are not denied, and at level 2 `enumeratePaths` is empty. Real: `server/test/confinementCanaryMxcForeignDrive.test.ts` (CI `mxc-windows` job on `windows-11-arm`) still runs the two-drive canary at the runner's level. Diagnosed from issue #585: host at `MXC enumeration level 2` (domain machine), `%TEMP%` on the foreign drive `C:` confirmed on the reporter's machine. |
