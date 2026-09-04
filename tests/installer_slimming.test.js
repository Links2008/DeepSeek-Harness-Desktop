const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const main = read("main.js");
const backendSpec = read("runtime/backend-spec.cjs");
const builder = read("electron-builder.yml");
const prewarm = read("scripts/prewarm-node-compile-cache.cjs");
const workflow = read(".github/workflows/upstream-sync.yml");
const verifier = read("scripts/verify-installed-runtime.ps1");
const startupMeasure = read("scripts/measure-packaged-startup.ps1");

assert.match(builder, /electronDist:\s*node_modules\/electron\/dist/,
  "installer builds must reuse the lockfile-installed Electron distribution without a network download");
assert.match(backendSpec,
  /command:\s*execPath[\s\S]*ELECTRON_RUN_AS_NODE:\s*["']1["']/,
  "the packaged backend must reuse Electron as its Node runtime");
assert.match(backendSpec, /args:\s*\[[\s\S]*["']--expose-internals["'],\s*cli/,
  "Electron Node must expose its internal ESM loader so profile packages resolve from baseUrl");
assert.doesNotMatch(backendSpec, /resourcesPath,\s*["']node["'],\s*["']node\.exe["']/,
  "the packaged shell must not require a second Node executable");
assert.match(prewarm, /require\(["']electron["']\)/,
  "compile-cache prewarm must use the same Electron Node runtime as production");
assert.match(prewarm, /ELECTRON_RUN_AS_NODE:\s*["']1["']/,
  "prewarm must explicitly enable Electron's Node mode");
assert.match(prewarm, /spawn\(electron,\s*\[["']--use-system-ca["'],\s*["']--expose-internals["'],\s*cli/,
  "prewarm must exercise the same profile-aware ESM loader path as production");
assert.doesNotMatch(prewarm, /bundle["'],\s*["']node["'],\s*["']node\.exe["']/,
  "prewarm must not depend on the removed standalone Node payload");
assert.doesNotMatch(builder, /from:\s*bundle\/node\/node\.exe/,
  "the installer must not ship the standalone Node executable");
for (const locale of ["en-US", "zh-CN", "zh-TW"]) {
  assert.match(builder, new RegExp(`electronLanguages:[\\s\\S]*- ${locale}`));
}
for (const exclusion of ["*.pdb", "*.d.ts", "*.d.mts", "win32-arm64", "win10-arm64", "fixtures", "*.md"]) {
  assert.ok(builder.includes(exclusion), `runtime filter must exclude ${exclusion}`);
}
assert.doesNotMatch(workflow, /Copy-Item \(Get-Command node\.exe\)\.Source bundle\/node\/node\.exe/,
  "CI must not assemble a Node payload that the v4 installer no longer uses");
assert.match(verifier, /Invoke-ElectronNode[\s\S]*ELECTRON_RUN_AS_NODE/,
  "installed acceptance must run the packaged executable in Node mode");
assert.match(verifier,
  /function Start-DesktopApp[\s\S]*Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:ATOM_SHELL_INTERNAL_RUN_AS_NODE[\s\S]*Start-Process \$AppPath[\s\S]*SetEnvironmentVariable\('ELECTRON_RUN_AS_NODE'[\s\S]*SetEnvironmentVariable\('ATOM_SHELL_INTERNAL_RUN_AS_NODE'/,
  "PowerShell 5.1 acceptance must strip both Electron Node flags only while creating the GUI child");
assert.doesNotMatch(verifier, /Start-Process \$AppPath[\s\S]{0,300}-Environment/,
  "installed acceptance must not use the PowerShell 7-only Start-Process -Environment parameter");
assert.match(verifier, /Remove-Item -LiteralPath \$acceptanceUserData -Recurse -Force/,
  "installed acceptance must remove its isolated user-data directory");
assert.match(verifier, /USERPROFILE[\s\S]*DSH_HOME[\s\S]*\$acceptanceHome/,
  "installed acceptance must isolate the real .dsh profile as well as Electron user data");
assert.match(verifier, /WaitForExit\(600000\)/,
  "a wedged silent installer must not block CI indefinitely");
assert.match(verifier, /\$readyDeadline\s*=\s*\[DateTime\]::UtcNow\.AddSeconds\(150\)/,
  "HTTP readiness must use one absolute 150-second deadline");
assert.match(verifier, /Join-Path \$acceptanceTemp "dsh-i-\$acceptanceRunId"/,
  "the isolated install root must stay short enough for NSIS and long runtime paths");
assert.match(verifier, /Startup timing ms:[\s\S]*cold-http=[\s\S]*cold-paint=[\s\S]*warm-daemon=[\s\S]*warm-paint=/,
  "installed acceptance must report cold and persistent-daemon warm-start timing separately");
assert.match(verifier, /persistent backend ready reused=true/,
  "warm acceptance must prove that the second shell reused the daemon");
assert.match(verifier, /daemon-state\.json[\s\S]*serviceUrl/,
  "installed HTTP acceptance must use the token-bearing URL from daemon state");
assert.match(startupMeasure, /coldHttpMs[\s\S]*coldPaintMs[\s\S]*instantReopenMs[\s\S]*warmDaemonMs[\s\S]*warmPaintMs/,
  "packaged startup measurement must report separate cold and daemon-reuse milestones");
assert.match(startupMeasure, /USERPROFILE[\s\S]*DSH_HOME[\s\S]*--user-data-dir/,
  "packaged startup measurement must isolate profile and Electron data");
assert.match(startupMeasure, /daemon-state\.json[\s\S]*serviceUrl/,
  "startup measurement must probe the authenticated daemon URL");
assert.match(startupMeasure, /instantReopenMs\s*-gt\s*1000/,
  "the packaged shell must enforce its webpage-like one-second reopen budget");
assert.match(verifier, /\.Process\.HasExited[\s\S]*desktop process exited/,
  "desktop acceptance must fail fast with process diagnostics when Electron exits before HTTP readiness");

console.log("installer slimming contract verified");
