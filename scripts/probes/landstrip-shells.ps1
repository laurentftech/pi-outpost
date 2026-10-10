# Which shells start inside landstrip's AppContainer on Windows, outside pi-landstrip?
#
# Runs `echo` through each candidate shell under landstrip, varying what the policy allows,
# so a failure can be pinned on the shell, the policy, or the runner. Run on the Windows VM:
#   powershell -NoProfile -File scripts\probes\landstrip-shells.ps1 <path to landstrip.exe>
param([string]$Landstrip = "$HOME\pls11\node_modules\@landstrip\landstrip-win32-x64\bin\landstrip.exe")
$ProgressPreference = "SilentlyContinue"
$base = Join-Path $HOME "lsprobe"; Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$base\app", "$base\tmp" | Out-Null
$f = { param($p) $p.Replace("\", "/") }
$git = "C:/Program Files/Git"
$shells = [ordered]@{
  "cmd"              = @("cmd.exe", "/c", "echo shell-ok")
  "git bin\bash"     = @("$git/bin/bash.exe", "-c", "echo shell-ok")
  "git usr\bin\bash" = @("$git/usr/bin/bash.exe", "-c", "echo shell-ok")
  "git usr\bin\sh"   = @("$git/usr/bin/sh.exe", "-c", "echo shell-ok")
  "powershell"       = @("powershell.exe", "-NoProfile", "-Command", "Write-Output shell-ok")
}
# busybox-w32: a native Win32 sh (no MSYS2 runtime). Fetched once beside the probe output.
$busybox = Join-Path $HOME "busybox64.exe"
if (-not (Test-Path $busybox)) { try { Invoke-WebRequest -UseBasicParsing https://frippery.org/files/busybox/busybox64.exe -OutFile $busybox } catch { "busybox download failed: $_" } }
if (Test-Path $busybox) {
  $shells["busybox sh"] = @($busybox, "sh", "-c", "echo shell-ok")
  $shells["busybox sh: ls+grep"] = @($busybox, "sh", "-c", "ls / | grep -c . >/dev/null && echo shell-ok")
}
$policies = [ordered]@{
  "read git"             = @{ denyRead = @("C:/"); allowRead = @((& $f "$base\app"), "C:/Windows", $git, (& $f $HOME) + "/busybox64.exe"); allowWrite = @((& $f "$base\app")) }
  "read git, write tmp"  = @{ denyRead = @("C:/"); allowRead = @((& $f "$base\app"), "C:/Windows", $git, (& $f "$base\tmp"), (& $f $HOME) + "/busybox64.exe"); allowWrite = @((& $f "$base\app"), (& $f "$base\tmp")) }
}
$env:TMP = "$base\tmp"; $env:TEMP = "$base\tmp"; $env:HOME = "$base\app"
foreach ($mode in @("standard", "lpac")) {
  foreach ($pk in $policies.Keys) {
    @{ filesystem = $policies[$pk]; windows = @{ appContainerMode = $mode } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$base\p.json"
    foreach ($sk in $shells.Keys) {
      $cmd = $shells[$sk]
      Set-Location "$base\app"
      $out = & $Landstrip run -p "$base\p.json" -- @cmd 2>&1 | ForEach-Object { "$_" }
      $code = $LASTEXITCODE
      $ok = ($out -join " ") -match "shell-ok"
      $why = if ($ok) { "" } else { (($out | Where-Object { $_ -ne "" } | Select-Object -First 1) -replace "\s+", " ") }
      "{0,-9} {1,-20} {2,-17} {3} exit={4} {5}" -f $mode, $pk, $sk, $(if ($ok) { "OK  " } else { "FAIL" }), $code, $why
    }
  }
}
