# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/windows-foreign-drive-beside-denied/` (1 scenario, `sandbox-runner-bash`).

| Scenario | Status | Evidence |
| --- | --- | --- |
| BesideTheForeignWayDownStaysDenied | covered | Unit: `server/test/terminalSandbox.test.ts`, "BesideTheForeignWayDownStaysDenied: root on D:, a tool and the temporary directory under the profile on C: …" — with a fake reader, the way down on `C:` (`C:\`, `C:\Users`, `…\AppData`, `…\AppData\Local`, `…\Python`, the tool) is in `readonlyPaths` and not in `deniedPaths`, while `C:\Users\me\AppData\Local\Temp` and `…\AppData\Roaming` are in `deniedPaths`, the command's `tmp` stays in `readwritePaths` and not denied, and `C:\Windows`/`C:\Program Files` at the drive root are not denied. Real: `server/test/confinementCanaryMxcForeignDrive.test.ts` runs the canary through the real MXC container with the root on the checkout drive and the system temp on another (CI `mxc-windows` job on `windows-11-arm`, `scripts/mxc-windows/test.ps1` + `.github/workflows/ci.yml`): before the fix the verdict is `leaking` with `beside-root` reached, after the fix `verified` with `beside-root` and `write-beside-root` refused. |
