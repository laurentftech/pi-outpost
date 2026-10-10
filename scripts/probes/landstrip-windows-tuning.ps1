# Two questions about the confined terminal's Windows policy, answered in the interactive session:
#  1. which spelling of the null device lets Git for Windows run (it opens /dev/null = NUL);
#  2. how launch time grows with what is allowed (AppContainer re-grants access to every allowed
#     tree on each launch).
# Run through run-interactive.ps1. Writes ~/landstrip-tuning.txt.
param([string]$Landstrip = "$HOME\pls11\node_modules\@landstrip\landstrip-win32-x64\bin\landstrip.exe")
$ProgressPreference = "SilentlyContinue"
$base = Join-Path $HOME "lstune"; New-Item -ItemType Directory -Force "$base\app", "$base\tmp" | Out-Null
$out = Join-Path $HOME "landstrip-tuning.txt"; "" | Set-Content $out
$w = { param($p) $p.Replace("\", "/") }
$app = & $w "$base\app"; $tmp = & $w "$base\tmp"
$pathEntries = $env:PATH.Split(";") | Where-Object { $_ -and [IO.Path]::IsPathRooted($_) -and (Test-Path $_) } | ForEach-Object { (& $w $_).TrimEnd("/") }
function Try-Policy($label, $allowRead, $allowWrite, $cmd) {
  @{ filesystem = @{ denyRead = @("C:/"); allowRead = $allowRead; allowWrite = $allowWrite }; windows = @{ appContainerMode = "standard" } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$base\p.json"
  Set-Location "$base\app"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $o = & $Landstrip run -p "$base\p.json" -- @cmd 2>&1 | ForEach-Object { "$_" }
  $ms = $sw.ElapsedMilliseconds
  Add-Content $out ("{0,-44} {1,6} ms exit={2} {3}" -f $label, $ms, $LASTEXITCODE, (($o | Select-Object -First 2) -join " | "))
}
$git = "C:\Program Files\Git\cmd\git.exe"
$baseRead = @("C:/Windows", $app, $tmp, "C:/Program Files/Git")
Try-Policy "git, no null device"            $baseRead @($app, $tmp) @($git, "--version")
Try-Policy "git, allowWrite NUL"            $baseRead @($app, $tmp, "NUL") @($git, "--version")
Try-Policy "git, allowWrite //./NUL"        $baseRead @($app, $tmp, "//./NUL") @($git, "--version")
Try-Policy "git, allowWrite \\.\NUL"        $baseRead @($app, $tmp, "\\.\NUL") @($git, "--version")
Try-Policy "git status in a repo, NUL"      $baseRead @($app, $tmp, "NUL") @("cmd.exe", "/c", "`"$git`" init -q && `"$git`" status --short && echo git-ok")
Try-Policy "launch: Windows + root"         @("C:/Windows", $app, $tmp) @($app, $tmp) @("cmd.exe", "/c", "echo ok")
Try-Policy "launch: + Git"                  $baseRead @($app, $tmp) @("cmd.exe", "/c", "echo ok")
Try-Policy ("launch: + all PATH (" + $pathEntries.Count + ")") (@("C:/Windows", $app, $tmp) + $pathEntries) @($app, $tmp) @("cmd.exe", "/c", "echo ok")
Try-Policy "launch: + all PATH, again"     (@("C:/Windows", $app, $tmp) + $pathEntries) @($app, $tmp) @("cmd.exe", "/c", "echo ok")
foreach ($e in $pathEntries) { Try-Policy ("  + " + $e) @("C:/Windows", $app, $tmp, $e) @($app, $tmp) @("cmd.exe", "/c", "echo ok") }
Add-Content $out "done"
