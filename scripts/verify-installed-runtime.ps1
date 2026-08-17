param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedRuntimeVersion
)

$ErrorActionPreference = 'Stop'

function Test-LocalPort {
  param([int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    return $client.ConnectAsync('127.0.0.1', $Port).Wait(400) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Stop-InstalledProcesses {
  param([string]$InstallRoot)
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$installerPath = (Resolve-Path $Installer).Path
$installRoot = Join-Path $env:RUNNER_TEMP "DeepSeekHarness-$ExpectedVersion"
$appPath = Join-Path $installRoot 'DeepSeekHarness.exe'
$accepted = $false
$cleanupProblems = [Collections.Generic.List[string]]::new()

if (Test-Path -LiteralPath $installRoot) { throw "Temporary install root already exists: $installRoot" }
if (Test-LocalPort 3080) { throw 'Port 3080 was already occupied before acceptance testing' }

& 'C:\Program Files\7-Zip\7z.exe' t $installerPath
if ($LASTEXITCODE -ne 0) { throw '7-Zip rejected the installer archive' }

try {
  $install = Start-Process $installerPath -ArgumentList @('/S', "/D=$installRoot") -PassThru
  $install.WaitForExit()
  if ($install.ExitCode -ne 0) { throw "Installer failed with exit code $($install.ExitCode)" }
  if (!(Test-Path -LiteralPath $appPath)) { throw 'Installed executable is missing' }

  $fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($appPath).FileVersion
  if ([Version]$fileVersion -ne [Version]$ExpectedVersion) {
    throw "Installed FileVersion $fileVersion does not match $ExpectedVersion"
  }

  $updatePath = Join-Path $installRoot 'resources\app-update.yml'
  $updateFeed = Get-Content $updatePath -Raw
  if ($updateFeed -notmatch '(?m)^owner:\s*Links2008\s*$' -or
      $updateFeed -notmatch '(?m)^repo:\s*DeepSeek-Harness-Desktop\s*$') {
    throw 'Installed updater feed is incorrect'
  }

  $node = Join-Path $installRoot 'resources\node\node.exe'
  $cli = Join-Path $installRoot 'resources\dsh-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js'
  $runtimeVersion = ((& $node $cli --version) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $runtimeVersion -ne $ExpectedRuntimeVersion) {
    throw "Bundled Harness version '$runtimeVersion' does not match '$ExpectedRuntimeVersion'"
  }

  $registeredApp = $null
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $registeredApp = Get-StartApps | Where-Object AppID -eq 'com.deepseek.dsh' | Select-Object -First 1
    if ($registeredApp) { break }
    if ($attempt -lt 9) { Start-Sleep -Seconds 1 }
  }
  if (!$registeredApp) { throw 'Start Menu AppID com.deepseek.dsh is not registered' }

  Start-Process $appPath
  $ready = $false
  for ($attempt = 0; $attempt -lt 75; $attempt++) {
    Start-Sleep -Seconds 2
    try {
      $response = Invoke-WebRequest http://127.0.0.1:3080 -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200 -and $response.Content -match '<title>\s*DeepSeek Harness\s*</title>') {
        $ready = $true
        break
      }
    } catch {}
  }
  if (!$ready) {
    foreach ($logName in @('dsh_desktop.log', 'dsh_backend.log')) {
      $logPath = Join-Path $env:APPDATA "DeepSeekHarness\$logName"
      if (Test-Path -LiteralPath $logPath) {
        Write-Host "----- tail of $logName -----"
        Get-Content -LiteralPath $logPath -Tail 40 | ForEach-Object { Write-Host "  $_" }
      } else {
        Write-Host "----- missing $logName (app never wrote it) -----"
      }
    }
    throw 'Installed runtime did not return the expected HTTP 200 page'
  }
  $accepted = $true
} finally {
  Stop-InstalledProcesses $installRoot
  $portReleased = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (!(Test-LocalPort 3080)) {
      $portReleased = $true
      break
    }
  }
  if (!$portReleased) { $cleanupProblems.Add('Port 3080 remained open after process cleanup') }

  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue)
  if ($uninstallers.Count -ne 1) {
    $cleanupProblems.Add("Expected one uninstaller, found $($uninstallers.Count)")
  } else {
    try {
      $uninstall = Start-Process $uninstallers[0].FullName -ArgumentList '/S' -PassThru
      $uninstall.WaitForExit()
      if ($uninstall.ExitCode -ne 0) { $cleanupProblems.Add("Uninstaller exited with $($uninstall.ExitCode)") }
      for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $appPath); $attempt++) {
        Start-Sleep -Milliseconds 500
      }
      if (Test-Path -LiteralPath $appPath) { $cleanupProblems.Add('Installed executable remained after uninstall') }
    } catch {
      $cleanupProblems.Add("Uninstall failed: $($_.Exception.Message)")
    }
  }

  if ($cleanupProblems.Count -gt 0) {
    $message = $cleanupProblems -join '; '
    if ($accepted) { throw $message }
    Write-Warning "Cleanup also reported: $message"
  }
}

Write-Host "Installed runtime acceptance passed for desktop $ExpectedVersion / Harness $ExpectedRuntimeVersion"
