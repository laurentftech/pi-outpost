<!-- Posted as https://github.com/landstrip/landstrip/issues/203 on 2026-10-10. -->
# pi-landstrip on Windows: launcher environment lacks LOCALAPPDATA/SystemRoot (os error 203); with it fixed, a native shell works

Windows 10 22H2, pi-landstrip **0.19.11** (also seen on 0.19.8), landstrip runner 0.19.11, Pi driving
the agent's `bash` through pi-landstrip. All runs below are from the user's interactive session (over
SSH, sandboxed processes get no window station and fail for that reason alone).

## 1. Every launch fails with `os error 203`

`createLandstripLauncherEnvironment` passes the runner `PATH`, `HOME` and, on Windows, `ProgramData`.
Whatever the shell, each `bash` call fails:

```
{"kind":"launch","code":"LAUNCH_FAILED","program":"C:\\Users\\me\\tools\\sh.exe","message":"The system could not find the environment option that was entered. (os error 203)"}
```

Running the runner directly, `ProgramData` alone reproduces the error and adding `LOCALAPPDATA` clears
it; the launched program also wants `SystemRoot`. Passing these through fixes it:

```js
function createLandstripLauncherEnvironment(providerEnv, hostEnv = process.env, platform = process.platform) {
  if (platform !== "win32" || hostEnv.ProgramData === undefined)
    return providerEnv;
  const extra = Object.fromEntries(
    ["LOCALAPPDATA", "SystemRoot", "windir", "ComSpec", "PATHEXT"]
      .filter((k) => hostEnv[k] !== undefined)
      .map((k) => [k, hostEnv[k]]),
  );
  return { ...providerEnv, ProgramData: hostEnv.ProgramData, ...extra };
}
```

(Locations and machine facts, no credentials.)

## 2. With that fixed, a native shell works; Git Bash still cannot

Git Bash (Pi's default shell on Windows) still dies at start (`NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0…)`,
`0xC0000142`), as already noted in #40. A native shell does work: busybox-w32 copied as `sh.exe`, named in
Pi's `shellPath`, with

```json
{ "shell": { "readAccess": "policy" },
  "filesystem": { "allowRead": [".", "C:\\Windows", "C:\\tools\\sh.exe"] },
  "windows": { "appContainerMode": "standard" } }
```

runs the agent's commands in the project, refuses a write outside it (`Permission denied`) and stops a
read outside it on a permission question. In the default `lpac` mode busybox fails with
`WSAStartup failed, error 18`, also as in #40.

It might be worth documenting this as the supported Windows setup (native shell + standard container),
since the default one cannot work.

## 3. Default policy: the first call waits on a question about the shell itself

With the bundled `sandbox.json`, the first `bash` call raises
`Read blocked: "C:\Program Files\Git\bin\bash.exe" is not in allowRead` as a `select` dialog. In a host
that relays dialogs to a web UI, the tool call looks stuck until someone answers. Allowing the shell Pi
selects (`getShellConfig()`) by default, or failing with that message instead of asking, would make the
state visible.

## Reproduction

A Pi host loading pi-landstrip as the source of `bash`, a scripted provider that makes the agent call
`bash` once, the tool result recorded; I can share the script. Happy to run anything else on this VM.
