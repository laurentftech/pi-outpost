<!-- Draft issue (or PR) for landstrip/landstrip, package pi-landstrip. Title: -->
# pi-landstrip on Windows: launcher environment lacks LOCALAPPDATA/SystemRoot (os error 203), and the default policy stops on Git Bash

Two pi-landstrip-side problems seen on Windows 10 22H2 with pi-landstrip **0.19.8 and 0.19.11**,
driving the agent's `bash` through it (the runner-side `user32.dll` failure is reported separately,
#NNN).

## 1. The launcher environment is too bare: `LAUNCH_FAILED … (os error 203)`

`createLandstripLauncherEnvironment` passes the runner `PATH`, `HOME` and, on Windows, `ProgramData`.
With Git Bash allowed by the policy, every `bash` call fails with:

```
{"kind":"launch","code":"LAUNCH_FAILED","program":"C:\\Program Files\\Git\\bin\\bash.exe","message":"The system could not find the environment option that was entered. (os error 203)"}
```

Running the runner directly, I bisected this: with `ProgramData` alone the launch fails with
error 203; adding **`LOCALAPPDATA`** makes the runner start. The launched program also needs
**`SystemRoot`** (and usually `windir`, `ComSpec`, `PATHEXT`). Passing those through clears the
error:

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

None of these are credentials: locations and machine facts. (With it, `bash` gets as far as the
runner-side `0xC0000142`.)

## 2. With the bundled policy, the first `bash` call waits on a permission question

The bundled `sandbox.json` does not allow reading the shell Pi selects on Windows, so the first call
raises `Read blocked: "C:\Program Files\Git\bin\bash.exe" is not in allowRead` as a `select` dialog.
In a host that relays dialogs to a web UI the tool call looks stuck until someone answers. Allowing
the shell Pi selects (from `getShellConfig()`) by default on Windows, or failing with that message
rather than asking, would make the state visible.

## Reproduction

A pi host with `pi-landstrip` loaded and named as `bash`'s source, a scripted provider that calls
`bash` once (`echo from-the-shell`), the tool result recorded. With the default policy: the dialog
above, no result. With `{"shell":{"readAccess":"policy"},"filesystem":{"allowRead":[".","C:\\Windows","C:/Program Files/Git"]}}`
in the agent dir's `sandbox.json`: the `os error 203` result above. With the launcher fix: exit
`0xC0000142` (runner side).
