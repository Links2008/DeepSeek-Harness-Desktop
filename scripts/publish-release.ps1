[CmdletBinding()]
param(
  [switch]$Publish,
  [string]$Repository = 'Links2008/DeepSeek-Harness-Desktop'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
  if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is required. Install it with: winget install --id GitHub.cli'
  }

  gh auth status | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated. Run: gh auth login --web' }
  $login = (gh api user --jq '.login').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the GitHub account' }
  if ($login -match '\[bot\]$|^github-actions' -or $login -ne 'Links2008') {
    throw "Release must be published by Links2008, not '$login'"
  }

  $workingTree = @(git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git working tree' }
  if ($workingTree.Count -gt 0) { throw 'Working tree must be clean before publishing' }
  if ((git branch --show-current).Trim() -ne 'main') { throw 'Release must be created from main' }
  git fetch origin main --tags
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh origin/main and tags' }
  $head = (git rev-parse HEAD).Trim()
  $originMain = (git rev-parse origin/main).Trim()
  if ($head -ne $originMain) { throw "origin/main ($originMain) must match HEAD ($head)" }

  $workflowRuns = gh api "repos/$Repository/actions/workflows/upstream-sync.yml/runs?head_sha=$head&status=completed&per_page=20" | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the release validation workflow' }
  $successfulRun = @($workflowRuns.workflow_runs | Where-Object {
    $_.head_sha -eq $head -and $_.conclusion -eq 'success'
  } | Select-Object -First 1)
  if ($successfulRun.Count -ne 1) {
    throw "Current HEAD $head has no successful Validate DeepSeek Harness upstream run"
  }

  $manifest = Get-Content package.json -Raw | ConvertFrom-Json
  $version = [string]$manifest.version
  $tag = "v$version"
  $notes = Join-Path $root "release-notes-v$version.md"
  $installer = Join-Path $root "installer-dist\DeepSeekHarness-Setup-$version.exe"
  $blockmap = Join-Path $root "installer-dist\DeepSeekHarness-Setup-$version.exe.blockmap"
  $metadata = Join-Path $root 'installer-dist\latest.yml'
  foreach ($artifact in @($notes, $installer, $blockmap, $metadata)) {
    if (!(Test-Path -LiteralPath $artifact)) { throw "Required release file is missing: $artifact" }
  }
  if ((Get-Item -LiteralPath $installer).Length -le 0 -or (Get-Item -LiteralPath $blockmap).Length -le 0) {
    throw 'Release artifacts must not be empty'
  }

  $latest = Get-Content -LiteralPath $metadata -Raw
  $installerName = Split-Path $installer -Leaf
  if ($latest -notmatch "(?m)^version:\s*$([regex]::Escape($version))\s*$" -or
      $latest -notmatch "(?m)^\s+- url:\s*$([regex]::Escape($installerName))\s*$") {
    throw 'latest.yml does not describe the requested installer version'
  }
  $expectedSize = [long][regex]::Match($latest, '(?m)^\s+size:\s*(\d+)\s*$').Groups[1].Value
  if ($expectedSize -ne (Get-Item -LiteralPath $installer).Length) {
    throw 'Installer size does not match latest.yml'
  }
  $expectedSha512 = [regex]::Match($latest, '(?m)^\s+sha512:\s*(\S+)\s*$').Groups[1].Value
  $stream = [IO.File]::OpenRead($installer)
  $hasher = [Security.Cryptography.SHA512]::Create()
  try { $actualSha512 = [Convert]::ToBase64String($hasher.ComputeHash($stream)) }
  finally { $hasher.Dispose(); $stream.Dispose() }
  if (!$expectedSha512 -or $actualSha512 -ne $expectedSha512) {
    throw 'Installer SHA512 does not match latest.yml'
  }

  gh release view $tag --repo $Repository *> $null
  if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists; refusing to overwrite it" }
  $localTag = @(git tag --list $tag)
  if ($localTag.Count -gt 0 -and (git rev-list -n 1 $tag).Trim() -ne $head) {
    throw "Local tag $tag does not point to HEAD"
  }
  $remotePeeled = @(git ls-remote --tags origin "refs/tags/${tag}^{}")
  $remoteDirect = @(git ls-remote --tags origin "refs/tags/$tag")
  $remoteCommit = if ($remotePeeled.Count) { ($remotePeeled[0] -split '\s+')[0] }
    elseif ($remoteDirect.Count) { ($remoteDirect[0] -split '\s+')[0] } else { $null }
  if ($remoteCommit -and $remoteCommit -ne $head) { throw "Remote tag $tag does not point to HEAD" }

  $sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  Write-Host "Release preflight passed: $tag, author=$login, CI=$($successfulRun[0].html_url), bytes=$expectedSize, SHA-256=$sha256"
  if (!$Publish) { Write-Host 'Dry run only. Add -Publish to create the tag and GitHub Release.'; return }

  if (!$localTag.Count) { git tag -a $tag -m "DeepSeek Harness Desktop $tag" }
  if ($LASTEXITCODE -ne 0) { throw "Could not create local tag $tag" }
  if (!$remoteCommit) { git push origin "refs/tags/$tag" }
  if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag" }

  $assets = @($installer, $blockmap, $metadata)
  gh release create $tag @assets --repo $Repository --verify-tag --latest --title "DeepSeek Harness Desktop $tag - Architecture and release reliability update" --notes-file $notes
  if ($LASTEXITCODE -ne 0) { throw "GitHub Release $tag was not created" }

  $published = gh release view $tag --repo $Repository --json tagName,isLatest,author,assets | ConvertFrom-Json
  $publishedNames = @($published.assets | ForEach-Object name)
  foreach ($expected in @($installerName, (Split-Path $blockmap -Leaf), 'latest.yml')) {
    if ($expected -notin $publishedNames) { throw "Published Release is missing $expected" }
  }
  if ($published.tagName -ne $tag -or !$published.isLatest -or $published.author.login -ne $login) {
    throw 'Published Release identity, tag, or Latest state is incorrect'
  }
  Write-Host "Published $tag successfully as $login"
} finally {
  Pop-Location
}
