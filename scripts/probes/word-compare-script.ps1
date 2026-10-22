$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$app = $null; $original = $null; $revised = $null; $result = $null
try {
  $running = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $app = New-Object -ComObject Word.Application
  $started = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $running -notcontains $_.Id })
  if ($started.Count -eq 1) { [Console]::Out.WriteLine('word-pid=' + $started[0].Id) }
  $missing = [Type]::Missing
  $original = $app.Documents.Open($env:PI_OUTPOST_COMPARE_ORIGINAL, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, 0, $missing, $false)
  $revised = $app.Documents.Open($env:PI_OUTPOST_COMPARE_REVISED, $false, $true, $false, $missing, $missing, $missing, $missing, $missing, 0, $missing, $false)
  $result = $app.CompareDocuments($original, $revised, 2, 1, $false, $true, $true, $true, $true, $true, $true, $true, $true, $true, $env:PI_OUTPOST_COMPARE_AUTHOR, $true)
  $result.SaveAs2($env:PI_OUTPOST_COMPARE_OUTPUT, 16)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message); exit 1
} finally {
  foreach ($doc in @($result, $revised, $original)) { if ($doc -ne $null) { try { $doc.Close(0) } catch { } } }
  if ($app -ne $null -and $app.Documents.Count -eq 0) { $app.Quit([ref]0) }
}
