param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [int]$TimeoutSeconds = 150
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path $AppPath).Path
$appRoot = Split-Path $app
$runId = [Guid]::NewGuid().ToString('N')
$tempRoot = [IO.Path]::GetTempPath()
$userData = Join-Path $tempRoot "dsh-packaged-user-$runId"
$isolatedHome = Join-Path $tempRoot "dsh-packaged-home-$runId"
$desktop = $null

function Test-DshHttp {
  try {
    $response = Invoke-WebRequest 'http://127.0.0.1:3080' -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200 -and $response.Content -match '<title>\s*DeepSeek Harness\s*</title>'
  } catch { return $false }
}

function Start-IsolatedDesktop {
  param([string[]]$ExtraArgs = @())
  $oldUser = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
  $oldDsh = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
  $oldNode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
  $oldAtom = [Environment]::GetEnvironmentVariable('ATOM_SHELL_INTERNAL_RUN_AS_NODE', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('USERPROFILE', $isolatedHome, 'Process')
    [Environment]::SetEnvironmentVariable('DSH_HOME', $isolatedHome, 'Process')
    Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:ATOM_SHELL_INTERNAL_RUN_AS_NODE -ErrorAction SilentlyContinue
    $arguments = @("--user-data-dir=$userData", '--no-login-prewarm') + $ExtraArgs
    return Start-Process $app -ArgumentList $arguments `
      -WindowStyle Hidden -PassThru
  } finally {
    [Environment]::SetEnvironmentVariable('USERPROFILE', $oldUser, 'Process')
    [Environment]::SetEnvironmentVariable('DSH_HOME', $oldDsh, 'Process')
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $oldNode, 'Process')
    [Environment]::SetEnvironmentVariable('ATOM_SHELL_INTERNAL_RUN_AS_NODE', $oldAtom, 'Process')
  }
}

function Wait-NewLogText {
  param([string]$Path, [long]$Offset, [string]$Pattern, [DateTime]$Deadline)
  while ([DateTime]::UtcNow -lt $Deadline) {
    try {
      if (Test-Path -LiteralPath $Path) {
        $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if ($text.Length -gt $Offset -and $text.Substring($Offset) -match $Pattern) { return $true }
      }
    } catch {}
    Start-Sleep -Milliseconds 100
  }
  return $false
}

if (Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 3080 must be free before packaged startup measurement'
}

New-Item -ItemType Directory -Path $userData, $isolatedHome | Out-Null
$logPath = Join-Path $userData 'dsh_desktop.log'
try {
  $cold = [Diagnostics.Stopwatch]::StartNew()
  $desktop = Start-IsolatedDesktop -ExtraArgs @('--benchmark-hide-after-ready')
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline -and !$desktop.HasExited -and !(Test-DshHttp)) {
    Start-Sleep -Milliseconds 200
  }
  if (!(Test-DshHttp)) { throw 'Packaged cold start did not reach HTTP readiness' }
  $coldHttpMs = $cold.ElapsedMilliseconds
  if (!(Wait-NewLogText $logPath 0 'backend paint-ready' $deadline)) {
    throw 'Packaged cold start did not reach renderer paint-ready'
  }
  $coldPaintMs = $cold.ElapsedMilliseconds

  if (!(Wait-NewLogText $logPath 0 'benchmark window hidden' $deadline)) {
    throw 'Benchmark window did not enter the instant-reopen state'
  }
  $reopenOffset = (Get-Item -LiteralPath $logPath).Length
  $reopen = [Diagnostics.Stopwatch]::StartNew()
  $secondInstance = Start-IsolatedDesktop
  if (!(Wait-NewLogText $logPath $reopenOffset 'window restored from second instance' ([DateTime]::UtcNow.AddSeconds(5)))) {
    throw 'Second launch did not restore the retained window'
  }
  $instantReopenMs = $reopen.ElapsedMilliseconds
  if ($instantReopenMs -gt 1000) { throw "Instant reopen regressed to $instantReopenMs ms" }
  $secondInstance.WaitForExit(5000) | Out-Null
  $secondInstance.Dispose()

  Stop-Process -Id $desktop.Id -Force
  $desktop.WaitForExit(10000) | Out-Null
  $desktop.Dispose()
  $desktop = $null
  $warmOffset = (Get-Item -LiteralPath $logPath).Length
  $warm = [Diagnostics.Stopwatch]::StartNew()
  $desktop = Start-IsolatedDesktop
  $warmDeadline = [DateTime]::UtcNow.AddSeconds(15)
  if (!(Wait-NewLogText $logPath $warmOffset 'persistent backend ready reused=true' $warmDeadline)) {
    throw 'Packaged warm start did not reuse the daemon'
  }
  $warmDaemonMs = $warm.ElapsedMilliseconds
  if (!(Wait-NewLogText $logPath $warmOffset 'backend paint-ready' $warmDeadline)) {
    throw 'Packaged warm start did not reach renderer paint-ready'
  }
  [pscustomobject]@{
    coldHttpMs = $coldHttpMs
    coldPaintMs = $coldPaintMs
    instantReopenMs = $instantReopenMs
    warmDaemonMs = $warmDaemonMs
    warmPaintMs = $warm.ElapsedMilliseconds
  } | ConvertTo-Json
} finally {
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appRoot, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  for ($attempt = 0; $attempt -lt 20 -and (Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  Remove-Item -LiteralPath $userData, $isolatedHome -Recurse -Force -ErrorAction SilentlyContinue
}
