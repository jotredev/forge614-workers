$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$testRoot = Join-Path $env:RUNNER_TEMP "forge614-workers-w2g"
$forgeHome = Join-Path $testRoot ".forge614"
$portFile = Join-Path $testRoot "publication-port.txt"
$serverScript = Join-Path $PSScriptRoot "windows-publication-server.mjs"
if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $forgeHome "engines/bin") | Out-Null
Copy-Item (Join-Path $repo "dist/windows-e2e/forge614-engines.exe") (Join-Path $forgeHome "engines/bin/forge614-engines.exe") -Force

$env:FORGE614_W2G_PORT_FILE = $portFile
$server = Start-Process -FilePath node -ArgumentList @($serverScript) -PassThru -WindowStyle Hidden
try {
  $portDeadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $portFile) -and (Get-Date) -lt $portDeadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $portFile)) { throw "Local publication server did not start" }
  $env:FORGE614_HOME = $forgeHome
  $env:HOME = $testRoot
  $env:FORGE614_INSTALL_TEST_BASE_URL = "http://127.0.0.1:$((Get-Content $portFile -Raw).Trim())"
  & (Join-Path $repo "install.ps1") --version v1.1.0
  if ($LASTEXITCODE -ne 0) { throw "Could not install Workers from the local publication" }

  $launcher = Join-Path $forgeHome "workers/bin/forge614-workers.exe"
  $uninstallOutput = & $launcher uninstall --json
  $uninstallExit = $LASTEXITCODE
  Write-Host "W2G_PERMANENT_UNINSTALL_EXIT=$uninstallExit"
  Write-Host "W2G_PERMANENT_UNINSTALL_OUTPUT=$($uninstallOutput -join ' ')"
  if ($uninstallExit -ne 0) { throw "Workers uninstall failed from the PowerShell CI step" }

  $parked = @(Get-ChildItem -LiteralPath $forgeHome -Filter ".forge614-workers-old-*.exe" -File -ErrorAction SilentlyContinue)
  $parkDeadline = (Get-Date).AddSeconds(45)
  while ($parked.Count -gt 0 -and (Get-Date) -lt $parkDeadline) {
    Start-Sleep -Milliseconds 100
    $parked = @(Get-ChildItem -LiteralPath $forgeHome -Filter ".forge614-workers-old-*.exe" -File -ErrorAction SilentlyContinue)
  }
  Write-Host "W2G_PERMANENT_PARKED_REMOVED=$($parked.Count -eq 0)"
  if ($parked.Count -gt 0) { throw "Deferred Windows uninstall cleanup left a parked launcher after 45 seconds" }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
Remove-Item -LiteralPath $testRoot -Recurse -Force
