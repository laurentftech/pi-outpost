# Microsoft eXecution Containers (MXC) on Windows 11: does it confine developer tools where
# landstrip's AppContainer cannot (the null device, git, /dev/null, launch time)?
#
# Same battery as the landstrip probes (docs/investigations/windows-sandboxing.md), run through
# MXC's `processcontainer` backend with its command-line executor, wxc-exec.exe.
#
# Requirements: Windows 11 24H2/25H2 with the August 2026 update or later (26100/26200.9278+),
# Node 24+, npm reaching @microsoft/mxc-sdk (a Nexus proxy of npmjs.org will do). No admin.
# Run it from your own desktop session (not over SSH - sandboxed processes need a window station):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probes\mxc-probe.ps1
# Results: %USERPROFILE%\mxc-probe\results.txt (paste it back into the investigation).
param(
  [string]$SdkVersion = "1.0.0",
  [string]$Work = (Join-Path $HOME "mxc-probe")
)
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $Work | Out-Null
$results = Join-Path $Work "results.txt"
"MXC probe $(Get-Date -Format s)" | Set-Content -Encoding UTF8 $results
function Note([string]$line) { Add-Content -Encoding UTF8 $results $line; Write-Output $line }

# --- 1. The host -----------------------------------------------------------------------------
$cv = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
Note ("OS: {0} {1} build {2}.{3}" -f $cv.ProductName, $cv.DisplayVersion, $cv.CurrentBuildNumber, $cv.UBR)
Note ("Node: " + (node --version 2>&1)); Note ("npm: " + (npm --version 2>&1)); Note ("registry: " + (npm config get registry 2>&1))
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Probe {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr LoadLibraryW(string n);
  [DllImport("kernel32", CharSet=CharSet.Ansi)] public static extern IntPtr GetProcAddress(IntPtr m, string n);
}
"@
$pm = [Probe]::LoadLibraryW("processmodel.dll")
$api = if ($pm -eq [IntPtr]::Zero) { "processmodel.dll not loadable" } elseif ([Probe]::GetProcAddress($pm, "Experimental_CreateProcessInSandbox") -ne [IntPtr]::Zero) { "present" } else { "processmodel.dll loaded, export absent" }
Note "Experimental_CreateProcessInSandbox (MXC tier 1): $api"

# --- 2. The SDK and its executor -------------------------------------------------------------
$sdkDir = Join-Path $Work "sdk"
New-Item -ItemType Directory -Force $sdkDir | Out-Null
Push-Location $sdkDir
if (-not (Test-Path "package.json")) { '{ "private": true }' | Set-Content package.json }
npm install "@microsoft/mxc-sdk@$SdkVersion" --no-audit --no-fund 2>&1 | Select-Object -Last 2 | ForEach-Object { Note "npm: $_" }
Pop-Location
# The package ships one executor per architecture (bin\x64, bin\arm64): take this machine's.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$all = Get-ChildItem -Recurse -Filter "wxc-exec.exe" (Join-Path $sdkDir "node_modules") -ErrorAction SilentlyContinue
$all | ForEach-Object { Note ("found executor: " + $_.FullName) }
$exec = $all | Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
if (-not $exec) { Note "wxc-exec.exe not found under node_modules: stop here and look at the npm output."; exit 1 }
Note ("executor: " + $exec.FullName)

# --- 3. The layout every check runs against -------------------------------------------------
$base = Join-Path $Work "layout"; Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue
$app = Join-Path $base "app"; $out = Join-Path $app "out"; $other = Join-Path $base "other"; $agent = Join-Path $base "agent"
New-Item -ItemType Directory -Force $out, $other, $agent | Out-Null
"mine" | Set-Content (Join-Path $app "readme.txt")
"other-secret" | Set-Content (Join-Path $other "secret.txt")
'{"key":"sk-agent"}' | Set-Content (Join-Path $agent "auth.json")
$busybox = @("$HOME\tools\sh.exe", "$HOME\busybox64.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source

function Run-Contained([string]$label, [string]$commandLine, [switch]$Debug, [switch]$RootWritable) {
  # busybox re-launches itself for pipes and non-final commands: its folder must be readable, or
  # it answers "unable to spawn shell" and the /dev/null line measures that instead.
  $tools = @(); if ($busybox) { $tools = @(Split-Path $busybox) }
  $fs = if ($RootWritable) { @{ readwritePaths = @($app); readonlyPaths = $tools; deniedPaths = @($other, $agent) } }
        else { @{ readwritePaths = @($out); readonlyPaths = @($app) + $tools; deniedPaths = @($other, $agent) } }
  $config = @{
    version = "1.0.0"
    containment = "processcontainer"
    process = @{ commandLine = $commandLine; cwd = $app; timeout = 30000 }
    filesystem = $fs
    # MXC blocks Win32k (UI) by default, and anything loading user32.dll then fails with
    # 0xC0000142 - git, PowerShell, busybox. A terminal needs it on.
    ui = @{ disable = $false }
  }
  $file = Join-Path $Work "config.json"
  # No BOM: Windows PowerShell's -Encoding UTF8 writes one, and MXC's JSON parser rejects it.
  [IO.File]::WriteAllText($file, ($config | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
  $execArgs = @(); if ($Debug) { $execArgs += "--debug" }; $execArgs += $file
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $o = & $exec.FullName @execArgs 2>&1 | ForEach-Object { "$_" }
  $ms = $sw.ElapsedMilliseconds
  $text = (($o | Where-Object { $_ -ne "" }) -join " | ")
  if ($text.Length -gt 300 -and -not $Debug) { $text = $text.Substring(0, 300) }
  # An empty answer is not a pass: an executor that never ran the workload looks exactly like this.
  if ($text -eq "") { $text = "(no output at all - did anything run?)" }
  Note ("{0,-36} {1,6} ms exit={2,-11} {3}" -f $label, $ms, $LASTEXITCODE, $text)
}

# --- 4. Which tier, and the battery ----------------------------------------------------------
Note ""; Note "== diagnostic run (look for the tier MXC selected: BaseContainer / CreateProcessInSandbox vs AppContainer)"
Run-Contained "debug: cmd echo" 'cmd.exe /c echo hello' -Debug
Note ""; Note "== battery"
Run-Contained "cmd echo"                 'cmd.exe /c echo shell-ok'
Run-Contained "read inside (readme)"     ('cmd.exe /c type "{0}"' -f (Join-Path $app "readme.txt"))
Run-Contained "read inside, root rw"     ('cmd.exe /c type "{0}"' -f (Join-Path $app "readme.txt")) -RootWritable
Run-Contained "read sibling secret"      ('cmd.exe /c type "{0}"' -f (Join-Path $other "secret.txt"))
Run-Contained "read agent auth.json"     ('cmd.exe /c type "{0}"' -f (Join-Path $agent "auth.json"))
Run-Contained "write writable zone"      ('cmd.exe /c echo inside> "{0}" && type "{0}"' -f (Join-Path $out "a.txt"))
Run-Contained "write elsewhere in root"  ('cmd.exe /c echo outside> "{0}"' -f (Join-Path $app "b.txt"))
Run-Contained "write in profile"         ('cmd.exe /c echo x> "{0}"' -f (Join-Path $HOME "mxc-escape.txt"))
Run-Contained "NUL read"                 'cmd.exe /c type nul && echo nul-readable'
Run-Contained "NUL write"                'cmd.exe /c echo x > nul && echo nul-writable'
Run-Contained "whoami"                   'whoami.exe'
Run-Contained "powershell"               'powershell.exe -NoProfile -Command "Write-Output ps-ok"'
if ($git) {
  Run-Contained "git --version" ('"{0}" --version' -f $git)
  # Real work needs the working directory, which Git for Windows resolves by listing every parent.
  Run-Contained "git init in writable zone" ('cmd.exe /c cd out && "{0}" init -q repo && echo init-ok' -f $git)
} else { Note "git: not on PATH, skipped" }
if ($busybox) {
  # busybox-w32 picks its applet from its own name: as sh.exe it is already sh.
  $sh = if ((Split-Path -Leaf $busybox) -ieq "sh.exe") { '"{0}"' -f $busybox } else { '"{0}" sh' -f $busybox }
  Run-Contained "busybox echo"             ('{0} -c "echo bb-ok"' -f $sh)
  Run-Contained "busybox 2>/dev/null"      ('{0} -c "ls missing 2>/dev/null; echo devnull-ok"' -f $sh)
} else { Note "busybox: not found (~\tools\sh.exe or ~\busybox64.exe), skipped" }
$gitBash = "C:\Program Files\Git\usr\bin\bash.exe"
if (Test-Path $gitBash) { Run-Contained "Git Bash" ('"{0}" -c "echo gitbash-ok"' -f $gitBash) }

Note ""; Note ("after the run: b.txt in root exists = {0}; escape file in profile exists = {1}" -f (Test-Path (Join-Path $app "b.txt")), (Test-Path (Join-Path $HOME "mxc-escape.txt")))
Remove-Item (Join-Path $HOME "mxc-escape.txt") -ErrorAction SilentlyContinue
Note "done - results in $results"
