$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$diagnosticRoot = Join-Path $env:RUNNER_TEMP "forge614-workers-w2g"
$forgeHome = Join-Path $diagnosticRoot ".forge614"
$portFile = Join-Path $diagnosticRoot "publication-port.txt"
$probe = Join-Path $repo "dist/windows-e2e/windows-detached-launch-probe.exe"
$serverScript = Join-Path $PSScriptRoot "windows-publication-server.mjs"
if (Test-Path -LiteralPath $diagnosticRoot) { Remove-Item -LiteralPath $diagnosticRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $forgeHome "engines/bin") | Out-Null
Copy-Item (Join-Path $repo "dist/windows-e2e/forge614-engines.exe") (Join-Path $forgeHome "engines/bin/forge614-engines.exe") -Force

bun build (Join-Path $PSScriptRoot "windows-detached-launch-probe.ts") --compile --target=bun-windows-x64 --outfile $probe
if ($LASTEXITCODE -ne 0) { throw "Could not compile the W2g detached-launch probe" }

$env:FORGE614_W2G_PORT_FILE = $portFile
$server = Start-Process -FilePath node -ArgumentList @($serverScript) -PassThru -WindowStyle Hidden
try {
  $portDeadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $portFile) -and (Get-Date) -lt $portDeadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $portFile)) { throw "Local publication server did not start" }
  $env:FORGE614_HOME = $forgeHome
  $env:HOME = $diagnosticRoot
  $env:FORGE614_INSTALL_TEST_BASE_URL = "http://127.0.0.1:$((Get-Content $portFile -Raw).Trim())"
  & (Join-Path $repo "install.ps1") --version v1.1.0
  if ($LASTEXITCODE -ne 0) { throw "Could not install Workers from the local publication" }

  $launcher = Join-Path $forgeHome "workers/bin/forge614-workers.exe"
  $uninstallOutput = & $launcher uninstall --json
  $uninstallExit = $LASTEXITCODE
  Write-Host "W2G_WORKERS_UNINSTALL_EXIT=$uninstallExit"
  Write-Host "W2G_WORKERS_UNINSTALL_OUTPUT=$($uninstallOutput -join ' ')"
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Select-Object ProcessId,CommandLine)
  $processJson = if ($processes.Count) { ConvertTo-Json -Compress -InputObject $processes } else { "none" }
  Write-Host "W2G_WORKERS_POWERSHELL_PROCESSES=$processJson"

  $parked = @(Get-ChildItem -LiteralPath $forgeHome -Filter ".forge614-workers-old-*.exe" -File -ErrorAction SilentlyContinue)
  $parkDeadline = (Get-Date).AddSeconds(35)
  while ($parked.Count -gt 0 -and (Get-Date) -lt $parkDeadline) {
    Start-Sleep -Milliseconds 100
    $parked = @(Get-ChildItem -LiteralPath $forgeHome -Filter ".forge614-workers-old-*.exe" -File -ErrorAction SilentlyContinue)
  }
  Write-Host "W2G_WORKERS_PARKED_AFTER_35S=$($parked.Count -eq 0)"

  function Wait-Marker([string]$Path) {
    $deadline = (Get-Date).AddSeconds(8)
    while (-not (Test-Path -LiteralPath $Path) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    return Test-Path -LiteralPath $Path
  }
  $directMarker = Join-Path $diagnosticRoot "probe-powershell-marker.txt"
  $env:FORGE614_W2G_MARKER = $directMarker
  $env:FORGE614_W2G_SPAWNED = Join-Path $diagnosticRoot "probe-powershell-spawned.txt"
  $env:FORGE614_W2G_SPAWN_ERROR = Join-Path $diagnosticRoot "probe-powershell-error.txt"
  & $probe direct
  $directExit = $LASTEXITCODE
  $directSeen = Wait-Marker $directMarker
  Write-Host "W2G_PROBE_POWERSHELL_EXIT=$directExit SPAWN=$(Test-Path $env:FORGE614_W2G_SPAWNED) MARKER=$directSeen"

  $wmiPowerShellMarker = Join-Path $diagnosticRoot "probe-wmi-powershell-marker.txt"
  $safeMarker = $wmiPowerShellMarker.Replace("'", "''")
  $markerScript = "Start-Sleep -Seconds 3; Set-Content -LiteralPath '$safeMarker' -Value alive"
  $markerEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($markerScript))
  $commandLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand $markerEncoded"
  $create = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
  $wmiPowerShellSeen = Wait-Marker $wmiPowerShellMarker
  Write-Host "W2G_PROBE_WMI_POWERSHELL_CREATE=$($create.ReturnValue) MARKER=$wmiPowerShellSeen"

  $wmiBunMarker = Join-Path $diagnosticRoot "probe-wmi-bun-marker.txt"
  $env:FORGE614_W2G_MARKER = $wmiBunMarker
  $env:FORGE614_W2G_SPAWNED = Join-Path $diagnosticRoot "probe-wmi-bun-spawned.txt"
  $env:FORGE614_W2G_SPAWN_ERROR = Join-Path $diagnosticRoot "probe-wmi-bun-error.txt"
  & $probe wmi
  $wmiBunExit = $LASTEXITCODE
  $wmiBunSeen = Wait-Marker $wmiBunMarker
  Write-Host "W2G_PROBE_WMI_BUN_EXIT=$wmiBunExit SPAWN=$(Test-Path $env:FORGE614_W2G_SPAWNED) MARKER=$wmiBunSeen"
  if (Test-Path -LiteralPath $env:FORGE614_W2G_SPAWN_ERROR) {
    Write-Host "W2G_PROBE_BUN_SPAWN_ERROR=$(Get-Content $env:FORGE614_W2G_SPAWN_ERROR -Raw)"
  }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
