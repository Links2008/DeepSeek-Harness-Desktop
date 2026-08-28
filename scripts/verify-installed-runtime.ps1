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

function Invoke-ElectronNode {
  param([string]$AppPath, [string[]]$Arguments)
  $stdout = [IO.Path]::GetTempFileName()
  $stderr = [IO.Path]::GetTempFileName()
  $previous = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $nodeArguments = @('--expose-internals') + $Arguments
    $child = Start-Process $AppPath -ArgumentList $nodeArguments -WindowStyle Hidden -Wait -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $errorText = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
    if ($child.ExitCode -ne 0) { throw "Electron Node probe exited $($child.ExitCode): $errorText" }
    return (Get-Content -LiteralPath $stdout -Raw).Trim()
  } finally {
    if ($null -eq $previous) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $previous }
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Start-DesktopApp {
  param([string]$AppPath)
  $stdout = [IO.Path]::GetTempFileName()
  $stderr = [IO.Path]::GetTempFileName()
  # The probes intentionally run this binary as Node. Strip both current and
  # legacy flags from the GUI child itself instead of mutating the parent shell.
  $process = Start-Process $AppPath -WindowStyle Hidden `
    -Environment @{
      ELECTRON_RUN_AS_NODE = $null
      ATOM_SHELL_INTERNAL_RUN_AS_NODE = $null
    } -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  return [pscustomobject]@{ Process = $process; Stdout = $stdout; Stderr = $stderr }
}

$installerPath = (Resolve-Path $Installer).Path
$acceptanceTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$installRoot = Join-Path $acceptanceTemp "DeepSeekHarness-$ExpectedVersion"
$appPath = Join-Path $installRoot 'DeepSeekHarness.exe'
$accepted = $false
$desktop = $null
$cleanupProblems = [Collections.Generic.List[string]]::new()

if (Test-Path -LiteralPath $installRoot) { throw "Temporary install root already exists: $installRoot" }
if (Test-LocalPort 3080) { throw 'Port 3080 was already occupied before acceptance testing' }

& 'C:\Program Files\7-Zip\7z.exe' t $installerPath
if ($LASTEXITCODE -ne 0) { throw '7-Zip rejected the installer archive' }

try {
  $install = Start-Process $installerPath -ArgumentList @('/S', "/D=$installRoot") -WindowStyle Hidden -PassThru
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

  $cli = Join-Path $installRoot 'resources\dsh-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js'
  $runtimeVersion = Invoke-ElectronNode $appPath @($cli, '--version')
  if ($runtimeVersion -ne $ExpectedRuntimeVersion) {
    throw "Bundled Harness version '$runtimeVersion' does not match '$ExpectedRuntimeVersion'"
  }
  $runtimeModules = Join-Path $installRoot 'resources\dsh-runtime\node_modules'
  $probeScript = Join-Path $PSScriptRoot 'electron-node-runtime-probe.cjs'
  $probe = Invoke-ElectronNode $appPath @($probeScript, $runtimeModules) | ConvertFrom-Json
  foreach ($name in @('node-pty', 'sharp', 'koffi')) {
    if ($null -eq $probe.packages.$name) { throw "Electron Node could not load native package $name" }
  }

  $registeredApp = $null
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $registeredApp = Get-StartApps | Where-Object AppID -eq 'com.deepseek.dsh' | Select-Object -First 1
    if ($registeredApp) { break }
    if ($attempt -lt 9) { Start-Sleep -Seconds 1 }
  }
  if (!$registeredApp) { throw 'Start Menu AppID com.deepseek.dsh is not registered' }

  $desktop = Start-DesktopApp $appPath
  $ready = $false
  for ($attempt = 0; $attempt -lt 75; $attempt++) {
    Start-Sleep -Seconds 2
    if ($desktop.Process.HasExited) { break }
    try {
      $response = Invoke-WebRequest http://127.0.0.1:3080 -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200 -and $response.Content -match '<title>\s*DeepSeek Harness\s*</title>') {
        $ready = $true
        break
      }
    } catch {}
  }
  if (!$ready) {
    if ($desktop.Process.HasExited) {
      $desktopStdout = Get-Content -LiteralPath $desktop.Stdout -Raw -ErrorAction SilentlyContinue
      $desktopStderr = Get-Content -LiteralPath $desktop.Stderr -Raw -ErrorAction SilentlyContinue
      Write-Host "----- desktop stdout -----`n$desktopStdout"
      Write-Host "----- desktop stderr -----`n$desktopStderr"
      Write-Host "desktop process exited with code $($desktop.Process.ExitCode) before HTTP readiness"
    }
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
  if ($desktop) {
    try { $desktop.Process.Dispose() } catch {}
    Remove-Item -LiteralPath $desktop.Stdout, $desktop.Stderr -Force -ErrorAction SilentlyContinue
  }
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
      $uninstall = Start-Process $uninstallers[0].FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru
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
