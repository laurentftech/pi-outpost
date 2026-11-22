# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/sandbox-home-said/` (2 scenarios).

| Scenario | Status | Evidence |
| --- | --- | --- |
| TheUsersHomeIsNamed | covered | `server/test/confinedShellFriction.test.ts`, under MXC's real executor, "a command reads the user's home in PI_OUTPOST_USER_HOME; a file there is read with a grant on it": the variable equals the server's `USERPROFILE`, a file written there is not read without a grant and is read with one. `server/test/terminalSandbox.test.ts`, "the user's own profile is named in PI_OUTPOST_USER_HOME, USERPROFILE being the private temp", and the exact environment of "keys and other server variables stay out …" on Linux. |
| TheAgentIsToldHomeIsTheProject | covered | `server/test/confinedShellFriction.test.ts`, "says HOME is the project and names the user's own home, and where a ~ path is read": the guideline with `homedir()` and, on Windows, the other folders; "an unconfined shell is not told so" asserts no `PI_OUTPOST_USER_HOME` line. |
