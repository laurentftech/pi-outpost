<!-- Draft issue for landstrip/landstrip. Title: -->
# Windows AppContainer: any executable importing user32.dll fails with 0xC0000142 (follow-up to #40)

Following up on #40 as suggested when it was closed. On landstrip **0.19.11** (win32-x64), Windows 10
22H2 (build 19045), the AppContainer backend still cannot start Git Bash. Narrowing it down, the
failure is not specific to MSYS: **every executable I tried that imports `user32.dll` dies at startup
with `0xC0000142` (STATUS_DLL_INIT_FAILED)**, and every one that does not import it starts.

## Observations

Each run: `landstrip run -p policy.json -- <exe> <args>`, policy
`{"filesystem":{"denyRead":["C:/"],"allowRead":["<workspace>","C:/Windows","<the exe>"],"allowWrite":["<workspace>"]},"windows":{"appContainerMode":"standard"}}`
(same results with `"lpac"`).

| Executable | Imports user32.dll | Result |
|---|---|---|
| `C:\Windows\System32\cmd.exe` | no | runs |
| `C:\Windows\System32\findstr.exe` | no | runs |
| `C:\Windows\System32\hostname.exe` | no | runs |
| `C:\Windows\System32\whoami.exe` | yes | `0xC0000142` |
| `C:\Windows\System32\where.exe` | yes | `0xC0000142` |
| `C:\Windows\System32\tasklist.exe` | yes | `0xC0000142` |
| `powershell.exe` (5.1) | yes | `0xC0000142` |
| `busybox64.exe` / `busybox64u.exe` (frippery.org) | yes | `0xC0000142` |
| Git for Windows `usr\bin\bash.exe`, `sh.exe` | yes | `0xC0000142`, plus `*** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…)` |

The import column comes from reading each PE import table. The correlation is exact on this set.
`user32.dll`'s initialisation connects to the process's window station and desktop; my guess is that
the AppContainer token has no access to them (no `lpDesktop`/ACL grant for the container SID), which is
what the Chromium sandbox handles with an alternate desktop. In #40 a busybox run reportedly worked
in a standard AppContainer on a patched 0.17.34 (Windows 11); it does not here, in either mode, with
either busybox build.

Git Bash has a second, independent blocker: MSYS2 creates a directory object under the global
`\BaseNamedObjects`, which an AppContainer may not do.

## Why it matters

Pi's shell on Windows is Git Bash, so `pi-landstrip` cannot run the agent's `bash` on native
Windows at all; and since `git`, PowerShell and most tools import `user32.dll`, a confined shell
there is limited to `cmd.exe` and a few built-ins.

## Reproduction

```powershell
$ls = "<path>\landstrip.exe"; $ws = "$HOME\lsprobe\app"; New-Item -ItemType Directory -Force $ws | Out-Null
$w = $ws.Replace("\","/")
@{ filesystem = @{ denyRead=@("C:/"); allowRead=@($w,"C:/Windows"); allowWrite=@($w) }; windows=@{ appContainerMode="standard" } } |
  ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$HOME\lsprobe\p.json"
Set-Location $ws
& $ls run -p "$HOME\lsprobe\p.json" -- C:\Windows\System32\cmd.exe /c "echo ok";   "exit $LASTEXITCODE"   # ok, 0
& $ls run -p "$HOME\lsprobe\p.json" -- C:\Windows\System32\whoami.exe;            "exit $LASTEXITCODE"   # -1073741502
```

`landstrip doctor` reports `{"ok":true,"platform":"windows","implementation":"appContainer"}`.

Happy to run anything that helps; I have a Windows 10 VM reachable over SSH.
