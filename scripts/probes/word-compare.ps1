<#
  Word's CompareDocuments on the installed Word, as docx_compare will drive it.

  Builds two versions of a fixture with Word itself — every tracked change rejected
  (the original) and every one accepted (the revised) — then runs the comparison the
  design describes and saves Word's result. Read that result with the review reading:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/probes/word-compare.ps1 [-Fixture <docx>] [-OutDir <dir>] [-UserDocument <docx>]
    node --import tsx/esm scripts/probes/word-compare-read.mts <OutDir>/compared.docx

  -UserDocument opens that file in a visible Word first, as a user would have it, and
  reports afterwards whether it is still open and which WINWORD.EXE processes remain.
#>
param(
  [string]$Fixture = (Join-Path $PSScriptRoot '..\..\server\test\fixtures\docx-review-office-web.docx'),
  [string]$OutDir = (Join-Path ([IO.Path]::GetTempPath()) 'pi-outpost-word-compare'),
  [string]$UserDocument = ''
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$Fixture = (Resolve-Path $Fixture).Path
$original = Join-Path $OutDir 'original.docx'
$revised = Join-Path $OutDir 'revised.docx'
$compared = Join-Path $OutDir 'compared.docx'
Remove-Item -Force -ErrorAction SilentlyContinue $original, $revised, $compared

function Get-WordPids { @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }

# The two versions, written by a Word of their own that quits afterwards.
# Opened read-write from a copy: Revisions.AcceptAll() refuses a read-only, invisible
# document ("not available because no document window is active").
$builder = New-Object -ComObject Word.Application
$builder.DisplayAlerts = 0
try {
  foreach ($version in @(@{ Path = $original; Accept = $false }, @{ Path = $revised; Accept = $true })) {
    Copy-Item $Fixture $version.Path -Force
    $doc = $builder.Documents.Open($version.Path, $false, $false, $false)
    try {
      $doc.TrackRevisions = $false
      if ($version.Accept) { $doc.Revisions.AcceptAll() } else { $doc.Revisions.RejectAll() }
      $doc.Save()
    } finally { $doc.Close(0) }
  }
} finally {
  $builder.Quit([ref]0)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($builder)
}
[GC]::Collect(); [GC]::WaitForPendingFinalizers()
Start-Sleep -Milliseconds 1500

$userWord = $null; $userDoc = $null
if ($UserDocument -ne '') {
  $userWord = New-Object -ComObject Word.Application
  $userWord.Visible = $true
  $userDoc = $userWord.Documents.Open((Resolve-Path $UserDocument).Path)
}
$before = Get-WordPids
Write-Output "WINWORD before: $($before -join ', ')"

# The comparison, as a separate PowerShell — the way the server runs it.
$env:PI_OUTPOST_COMPARE_ORIGINAL = $original
$env:PI_OUTPOST_COMPARE_REVISED = $revised
$env:PI_OUTPOST_COMPARE_OUTPUT = $compared
$env:PI_OUTPOST_COMPARE_AUTHOR = 'Word comparison'
$started = Get-Date
# Bounded, as the server bounds it: a Word stuck on a dialog shows up here as a timeout.
$run = Start-Process powershell.exe -PassThru -NoNewWindow -RedirectStandardError (Join-Path $OutDir 'compare.err') `
  -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'word-compare-script.ps1')
$null = $run.Handle  # without it, ExitCode reads empty after WaitForExit
if (-not $run.WaitForExit(120000)) { $run.Kill(); Write-Output 'compare TIMED OUT after 120 s' }
$code = $run.ExitCode
Get-Content -ErrorAction SilentlyContinue (Join-Path $OutDir 'compare.err')
Write-Output ("compare exit {0} in {1:n1} s; compared.docx {2}" -f $code, ((Get-Date) - $started).TotalSeconds, $(if (Test-Path $compared) { "$((Get-Item $compared).Length) bytes" } else { 'missing' }))
Start-Sleep -Milliseconds 1500
$after = Get-WordPids
Write-Output "WINWORD after: $($after -join ', ')"
$left = @($after | Where-Object { $before -notcontains $_ })
Write-Output "WINWORD started by the comparison and left running: $($left.Count)"

if ($userWord -ne $null) {
  $stillOpen = $false
  try { $stillOpen = ($userWord.Documents.Count -ge 1 -and $userDoc.FullName -ne '') } catch { }
  Write-Output "user document still open: $stillOpen"
  try { $userDoc.Close(0) } catch { }
  try { $userWord.Quit([ref]0) } catch { }
}
exit $code
