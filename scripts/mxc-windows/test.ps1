#!/usr/bin/env pwsh
# MXC's process container on Windows, tested where it runs: a runner with the tier 1 base
# container (CI's windows-11-arm; spike #558). Sets MXC_EXEC to the SDK's wxc-exec.exe and runs
# the real-MXC suites — the same ones a maintainer runs on a Windows 11 machine with MXC_EXEC
# set (docs/development.md § Releasing). Needs `npm ci --foreground-scripts` done: koffi and
# the SDK's native parts install through scripts.
$ErrorActionPreference = 'Stop'
Set-Location (git rev-parse --show-toplevel)
if ($env:OS -ne 'Windows_NT') { throw "These are Windows' runners; this is $env:OS" }
$sdkDir = node -p "require('path').dirname(require.resolve('@microsoft/mxc-sdk/package.json'))"
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$executor = Join-Path $sdkDir "bin\$arch\wxc-exec.exe"
if (-not (Test-Path $executor)) { throw "wxc-exec.exe not found at $executor" }
$env:MXC_EXEC = $executor
Write-Host "MXC_EXEC=$env:MXC_EXEC"

# A clean temporary directory, on a second drive when the runner has one (and off the user
# profile, whose 8.3 short name makes roots under it denied by name) — the two-drive shape of
# issue #582 comes from the runner that way.
$cwdDrive = (Get-Location).Path.Substring(0, 2) # "C:"
$other = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -cmatch '^[A-Z]$' -and $_.Name -ne $cwdDrive[0] } | Select-Object -First 1 -ExpandProperty Name
$tempRoot = if ($other) { "$($other):" + '\t' } else { "$cwdDrive" + '\t' }
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
Write-Host "TEMP=$tempRoot"

Set-Location server
$tests = @(
  'test/confinementCanaryMxcForeignDrive.test.ts',
  'test/terminalSandboxMxc.test.ts',
  'test/confinedBashMxc.test.ts',
  'test/confinedPowerShellMxc.test.ts',
  'test/confinedBashMxcSecurityEnvironment.test.ts',
  'test/windowsSandboxReachMxc.test.ts',
  'test/confinedNetworkMxc.test.ts',
  'test/sandboxGrantsReal.test.ts',
  'test/confinementCanary.test.ts'
)
node --import tsx/esm --test @tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
