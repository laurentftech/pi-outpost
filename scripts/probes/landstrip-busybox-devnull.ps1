# Does busybox-w32 hit the NUL wall (landstrip#204) as soon as a command uses /dev/null?
# Run through run-interactive.ps1; writes ~/landstrip-busybox-devnull.txt.
param([string]$Landstrip = "$HOME\pls11\node_modules\@landstrip\landstrip-win32-x64\bin\landstrip.exe")
$ProgressPreference = "SilentlyContinue"
$base = Join-Path $HOME "lsbb"; New-Item -ItemType Directory -Force "$base\app" | Out-Null
$out = Join-Path $HOME "landstrip-busybox-devnull.txt"; "" | Set-Content $out
$bb = "$HOME\busybox64.exe"; $w = { param($p) $p.Replace("\", "/") }
@{ filesystem = @{ denyRead = @("C:/"); allowRead = @("C:/Windows", (& $w "$base\app"), (& $w $bb)); allowWrite = @((& $w "$base\app")) }; windows = @{ appContainerMode = "standard" } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$base\p.json"
Set-Location "$base\app"
foreach ($c in @("echo plain", "echo x > /dev/null && echo redirect-ok", "ls missing 2>/dev/null; echo stderr-discard-ok", "cat /dev/null && echo read-devnull-ok")) {
  $o = & $Landstrip run -p "$base\p.json" -- $bb sh -c $c 2>&1 | ForEach-Object { "$_" }
  Add-Content $out ("{0,-50} exit={1} {2}" -f $c, $LASTEXITCODE, (($o | Select-Object -First 2) -join " | "))
}
Add-Content $out "done"
