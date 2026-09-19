# Installs pi-outpost with the pi-permission-system extension and a team policy.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Policy policy.json]
# The policy file defaults to permission-policy.json next to this script.
param([string]$Policy = (Join-Path $PSScriptRoot "permission-policy.json"))
$ErrorActionPreference = "Stop"

$agentDir = if ($env:PI_OUTPOST_AGENT_DIR) { $env:PI_OUTPOST_AGENT_DIR } else { Join-Path $HOME ".pi\agent" }
if (-not (Test-Path $Policy)) { throw "Policy file not found: $Policy" }

Write-Host "1/3  pi-outpost"
npm install -g pi-outpost
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "2/3  permission system extension"
# pi's own installer, fetched by npx: it records the package in $agentDir, where
# pi-outpost loads it on start. No global pi needed.
$env:PI_CODING_AGENT_DIR = $agentDir
npx -y @earendil-works/pi-coding-agent install npm:@gotgenes/pi-permission-system
if ($LASTEXITCODE -ne 0) { throw "extension install failed" }

Write-Host "3/3  policy"
$target = Join-Path $agentDir "extensions\pi-permission-system"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $Policy (Join-Path $target "config.json") -Force

Write-Host "Done. Start it with: pi-outpost"
