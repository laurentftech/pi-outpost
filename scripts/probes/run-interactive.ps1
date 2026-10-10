# Run a command in the logged-on user's interactive desktop session, from SSH.
#
# Processes started over SSH live in a non-interactive service session: AppContainers there get no
# access to a window station, so anything loading user32.dll fails with 0xC0000142 - an artefact of
# the probe, not of what is probed (it misled one investigation). A one-shot scheduled task with
# /IT runs in the real session instead. Someone must be logged on to the VM's desktop.
#   powershell -NoProfile -File scripts\probes\run-interactive.ps1 -Dir <cwd> -Command "<cmd line>" [-TimeoutSeconds 300]
# Prints the command's combined output once it ends.
param([Parameter(Mandatory)][string]$Command, [string]$Dir = $HOME, [int]$TimeoutSeconds = 300)
$ProgressPreference = "SilentlyContinue"
$id = [guid]::NewGuid().ToString("N").Substring(0, 8)
$out = Join-Path $env:TEMP "interactive-$id.log"; $flag = "$out.done"
$worker = Join-Path $env:TEMP "interactive-$id.cmd"
Set-Content -Encoding ascii $worker "@echo off`r`ncd /d `"$Dir`"`r`n$Command > `"$out`" 2>&1`r`necho %ERRORLEVEL% > `"$flag`""
$task = "interactive-probe-$id"
schtasks /Create /TN $task /SC ONCE /ST 23:59 /IT /RL LIMITED /F /TR "cmd /c `"$worker`"" | Out-Null
schtasks /Run /TN $task | Out-Null
for ($i = 0; $i -lt $TimeoutSeconds -and -not (Test-Path $flag); $i++) { Start-Sleep 1 }
schtasks /Delete /TN $task /F | Out-Null
if (Test-Path $flag) { Get-Content $out; "exit: " + (Get-Content $flag).Trim() } else { "timed out after ${TimeoutSeconds}s (is someone logged on to the desktop?)"; if (Test-Path $out) { Get-Content $out -Tail 20 } }
Remove-Item $worker, $flag -ErrorAction SilentlyContinue
