# Installs pi-outpost with the pi-permission-system extension and a team policy,
# and optionally OpenLore's structural code tools.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-WithOpenLore] [-Policy policy.json]
# The policy file defaults to permission-policy.json next to this script.
param(
  [string]$Policy = (Join-Path $PSScriptRoot "permission-policy.json"),
  [switch]$WithOpenLore
)
$ErrorActionPreference = "Stop"

$agentDir = if ($env:PI_OUTPOST_AGENT_DIR) { $env:PI_OUTPOST_AGENT_DIR } else { Join-Path $HOME ".pi\agent" }
if (-not (Test-Path $Policy)) { throw "Policy file not found: $Policy" }

# pi's own installer, fetched by npx: it records a package in $agentDir, where
# pi-outpost loads it on start. No global pi needed.
function Install-PiPackage([string]$Source) {
  $env:PI_CODING_AGENT_DIR = $agentDir
  npx -y @earendil-works/pi-coding-agent install $Source
  if ($LASTEXITCODE -ne 0) { throw "installing $Source failed" }
}

Write-Host "1/4  pi-outpost"
npm install -g pi-outpost
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "2/4  permission system extension"
Install-PiPackage "npm:@gotgenes/pi-permission-system"

Write-Host "3/4  policy"
$target = Join-Path $agentDir "extensions\pi-permission-system"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $Policy (Join-Path $target "config.json") -Force

if ($WithOpenLore) {
  Write-Host "4/4  OpenLore"
  Install-PiPackage "npm:openlore"
} else {
  Write-Host "4/4  OpenLore skipped (-WithOpenLore to install it)"
}

Write-Host "Done. Start it with: pi-outpost"
