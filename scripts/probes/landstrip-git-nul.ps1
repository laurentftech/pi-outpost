# Why does Git for Windows fail inside landstrip with "could not open '/dev/null'"?
# Hypothesis: the container's standard handles are not valid, git replaces them with /dev/null (NUL),
# and opening NUL is refused in the AppContainer. Run through run-interactive.ps1; writes ~/landstrip-git-nul.txt.
param([string]$Landstrip = "$HOME\pls11\node_modules\@landstrip\landstrip-win32-x64\bin\landstrip.exe")
$ProgressPreference = "SilentlyContinue"
$base = Join-Path $HOME "lsgit"; Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force "$base\app" | Out-Null
"x" | Set-Content "$base\app\in.txt"
$out = Join-Path $HOME "landstrip-git-nul.txt"; "" | Set-Content $out
$w = { param($p) $p.Replace("\", "/") }
@{ filesystem = @{ denyRead = @("C:/"); allowRead = @("C:/Windows", (& $w "$base\app"), "C:/Program Files/Git"); allowWrite = @((& $w "$base\app")) }; windows = @{ appContainerMode = "standard" } } | ConvertTo-Json -Depth 5 | Set-Content -Encoding ascii "$base\p.json"
Set-Location "$base\app"
$env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH
function T($label, [string[]]$cmd) { $o = & $Landstrip run -p "$base\p.json" -- @cmd 2>&1 | ForEach-Object { "$_" }; Add-Content $out ("{0,-40} exit={1} {2}" -f $label, $LASTEXITCODE, (($o | Select-Object -First 2) -join " | ")) }
T "cmd: type nul"                  @("cmd.exe", "/c", "type nul && echo nul-readable")
T "cmd: echo > nul"                @("cmd.exe", "/c", "echo x > nul && echo nul-writable")
T "git --version"                  @("cmd.exe", "/c", "git --version")
T "git --version < in.txt"         @("cmd.exe", "/c", "git --version < in.txt")
T "git --version < in.txt 2>&1"    @("cmd.exe", "/c", "git --version < in.txt 2>&1")
T "git init + status, stdin file"  @("cmd.exe", "/c", "git init -q < in.txt && git status --short < in.txt && echo git-ok")
Add-Content $out "done"
