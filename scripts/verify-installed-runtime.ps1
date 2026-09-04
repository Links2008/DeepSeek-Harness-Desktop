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

function Wait-LogMatch {
  param([string]$Path, [long]$Offset, [string]$Pattern, [int]$TimeoutSeconds)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $stream = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
      try {
        if ($stream.Length -gt $Offset) {
          $stream.Seek($Offset, 'Begin') | Out-Null
          $reader = [IO.StreamReader]::new($stream)
          try { if ($reader.ReadToEnd() -match $Pattern) { return $true } }
          finally { $reader.Dispose() }
        }
      } finally { $stream.Dispose() }
    }
    Start-Sleep -Milliseconds 100
  }
  return $false
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
  param([string]$AppPath, [string]$UserDataPath, [string]$HomePath)
  $stdout = [IO.Path]::GetTempFileName()
  $stderr = [IO.Path]::GetTempFileName()
  # Windows PowerShell 5.1 has no Start-Process -Environment. Clear the two
  # inherited Node-mode flags only while creating the GUI child, then restore.
  $arguments = @("--user-data-dir=$UserDataPath", '--no-login-prewarm')
  $previousRunAsNode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
  $previousAtomRunAsNode = [Environment]::GetEnvironmentVariable('ATOM_SHELL_INTERNAL_RUN_AS_NODE', 'Process')
  $previousUserProfile = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
  $previousDshHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
  try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:ATOM_SHELL_INTERNAL_RUN_AS_NODE -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('USERPROFILE', $HomePath, 'Process')
    [Environment]::SetEnvironmentVariable('DSH_HOME', $HomePath, 'Process')
    $process = Start-Process $AppPath -ArgumentList $arguments -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    return [pscustomobject]@{ Process = $process; Stdout = $stdout; Stderr = $stderr }
  } finally {
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousRunAsNode, 'Process')
    [Environment]::SetEnvironmentVariable('ATOM_SHELL_INTERNAL_RUN_AS_NODE', $previousAtomRunAsNode, 'Process')
    [Environment]::SetEnvironmentVariable('USERPROFILE', $previousUserProfile, 'Process')
    [Environment]::SetEnvironmentVariable('DSH_HOME', $previousDshHome, 'Process')
  }
}

$installerPath = (Resolve-Path $Installer).Path
$acceptanceTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$acceptanceRunId = "$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$installRoot = Join-Path $acceptanceTemp "dsh-i-$acceptanceRunId"
$appPath = Join-Path $installRoot 'DeepSeekHarness.exe'
$acceptanceUserData = Join-Path $acceptanceTemp "dsh-u-$acceptanceRunId"
$acceptanceHome = Join-Path $acceptanceTemp "dsh-h-$acceptanceRunId"
$accepted = $false
$desktop = $null
$cleanupProblems = [Collections.Generic.List[string]]::new()

if (Test-Path -LiteralPath $installRoot) { throw "Temporary install root already exists: $installRoot" }
if (Test-Path -LiteralPath $acceptanceUserData) { throw "Temporary user-data root already exists: $acceptanceUserData" }
if (Test-LocalPort 3080) { throw 'Port 3080 was already occupied before acceptance testing' }

& 'C:\Program Files\7-Zip\7z.exe' t $installerPath
if ($LASTEXITCODE -ne 0) { throw '7-Zip rejected the installer archive' }

try {
  $install = Start-Process $installerPath -ArgumentList @('/S', "/D=$installRoot") -WindowStyle Hidden -PassThru
  if (!$install.WaitForExit(600000)) {
    Stop-Process -Id $install.Id -Force -ErrorAction SilentlyContinue
    throw 'Installer did not finish within 600 seconds'
  }
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

  New-Item -ItemType Directory -Path $acceptanceUserData, $acceptanceHome | Out-Null
  $desktopLog = Join-Path $acceptanceUserData 'dsh_desktop.log'
  $coldWatch = [Diagnostics.Stopwatch]::StartNew()
  $desktop = Start-DesktopApp $appPath $acceptanceUserData $acceptanceHome
  $ready = $false
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(150)
  while ([DateTime]::UtcNow -lt $readyDeadline) {
    Start-Sleep -Milliseconds 500
    if ($desktop.Process.HasExited) { break }
    try {
      $response = Invoke-WebRequest http://127.0.0.1:3080 -UseBasicParsing -TimeoutSec 1
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
      $logPath = Join-Path $acceptanceUserData $logName
      if (Test-Path -LiteralPath $logPath) {
        Write-Host "----- tail of $logName -----"
        Get-Content -LiteralPath $logPath -Tail 40 | ForEach-Object { Write-Host "  $_" }
      } else {
        Write-Host "----- missing $logName (app never wrote it) -----"
      }
    }
    throw 'Installed runtime did not return the expected HTTP 200 page'
  }
  $coldHttpMs = $coldWatch.ElapsedMilliseconds
  if (!(Wait-LogMatch $desktopLog 0 'backend paint-ready' 15)) {
    throw 'Cold start reached HTTP 200 but not renderer paint-ready'
  }
  $coldPaintMs = $coldWatch.ElapsedMilliseconds

  Stop-Process -Id $desktop.Process.Id -Force -ErrorAction SilentlyContinue
  $desktop.Process.WaitForExit(10000) | Out-Null
  $desktop.Process.Dispose()
  Remove-Item -LiteralPath $desktop.Stdout, $desktop.Stderr -Force -ErrorAction SilentlyContinue
  $warmOffset = if (Test-Path -LiteralPath $desktopLog) { (Get-Item -LiteralPath $desktopLog).Length } else { 0 }
  $warmWatch = [Diagnostics.Stopwatch]::StartNew()
  $desktop = Start-DesktopApp $appPath $acceptanceUserData $acceptanceHome
  if (!(Wait-LogMatch $desktopLog $warmOffset 'persistent backend ready reused=true' 10)) {
    throw 'Warm start did not reuse the persistent daemon'
  }
  $warmDaemonMs = $warmWatch.ElapsedMilliseconds
  if (!(Wait-LogMatch $desktopLog $warmOffset 'backend paint-ready' 10)) {
    throw 'Warm start reused the daemon but did not reach renderer paint-ready'
  }
  $warmPaintMs = $warmWatch.ElapsedMilliseconds
  Write-Host "Startup timing ms: cold-http=$coldHttpMs cold-paint=$coldPaintMs warm-daemon=$warmDaemonMs warm-paint=$warmPaintMs"
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
  if (Test-Path -LiteralPath $acceptanceUserData) {
    Remove-Item -LiteralPath $acceptanceUserData -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $acceptanceHome) {
    Remove-Item -LiteralPath $acceptanceHome -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Installed runtime acceptance passed for desktop $ExpectedVersion / Harness $ExpectedRuntimeVersion"
