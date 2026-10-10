# Same landstrip runs as landstrip-shells.ps1, but from the user's interactive desktop session.
#
# Processes started over SSH live in a non-interactive service session whose window station
# does not grant AppContainers access, so user32.dll initialisation can fail there for reasons
# that have nothing to do with landstrip. This registers a one-shot scheduled task that runs
# in the logged-on user's interactive session (/IT), waits for it, and prints its results.
# Someone must be logged on to the VM's desktop. Run over SSH:
#   powershell -NoProfile -File scripts\probes\landstrip-interactive.ps1
param([string]$Landstrip = "$HOME\pls11\node_modules\@landstrip\landstrip-win32-x64\bin\landstrip.exe")
$ProgressPreference = "SilentlyContinue"
$base = Join-Path $HOME "lsprobe"; New-Item -ItemType Directory -Force "$base\app" | Out-Null
$results = "$base\interactive-results.txt"; Remove-Item $results -ErrorAction SilentlyContinue
$run = Join-Path $PSScriptRoot "landstrip-run.mjs"
$w = { param($p) $p.Replace("\", "/") }
$exes = @(
  @("C:\Windows\System32\cmd.exe", "/c", "echo shell-ok"),
  @("C:\Windows\System32\whoami.exe"),
  @("C:\Windows\System32\where.exe", "cmd"),
  @("$HOME\busybox64.exe", "sh", "-c", "echo shell-ok"),
  @("C:\Program Files\Git\usr\bin\bash.exe", "-c", "echo shell-ok"),
  @("C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", "-NoProfile", "-Command", "Write-Output shell-ok")
)
# The worker script the task runs: one line of JSON per run, plus where it ran.
$worker = "$base\interactive-worker.ps1"
$lines = @('$ErrorActionPreference = "Continue"', "Add-Content '$results' ('session: ' + (Get-Process -Id `$PID).SessionId + ' / ' + [Environment]::UserInteractive)")
foreach ($mode in @("standard", "lpac")) {
  $policy = "$base\pi-$mode.json"
  @{ filesystem = @{ denyRead = @("C:/"); allowRead = @((& $w "$base\app"), "C:/Windows", (& $w "$HOME\busybox64.exe"), "C:/Program Files/Git"); allowWrite = @((& $w "$base\app")) }; windows = @{ appContainerMode = $mode } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii $policy
  foreach ($e in $exes) {
    $quoted = ($e | ForEach-Object { "'" + $_ + "'" }) -join " "
    $lines += "Add-Content '$results' ('$mode ' + (node '$run' '$Landstrip' '$policy' '$base\app' -- $quoted))"
  }
}
$lines += "Add-Content '$results' 'done'"
Set-Content -Encoding UTF8 $worker $lines
$task = "landstrip-interactive-probe"
schtasks /Delete /TN $task /F 2>$null | Out-Null
schtasks /Create /TN $task /SC ONCE /ST 23:59 /IT /RL LIMITED /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$worker`"" | Out-Null
schtasks /Run /TN $task | Out-Null
for ($i = 0; $i -lt 120 -and -not ((Test-Path $results) -and (Select-String -Quiet -Path $results -Pattern "^done$")); $i++) { Start-Sleep 1 }
schtasks /Delete /TN $task /F | Out-Null
if (Test-Path $results) { Get-Content $results } else { "no results: is someone logged on to the desktop?" }
