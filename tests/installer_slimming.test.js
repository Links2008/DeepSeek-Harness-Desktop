const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const main = read("main.js");
const builder = read("electron-builder.yml");
const prewarm = read("scripts/prewarm-node-compile-cache.cjs");
const workflow = read(".github/workflows/upstream-sync.yml");
const verifier = read("scripts/verify-installed-runtime.ps1");

assert.match(main,
  /command:\s*process\.execPath[\s\S]*ELECTRON_RUN_AS_NODE:\s*["']1["']/,
  "the packaged backend must reuse Electron as its Node runtime");
assert.match(main, /args:\s*\[\s*["']--expose-internals["'],\s*bundledCli/,
  "Electron Node must expose its internal ESM loader so profile packages resolve from baseUrl");
assert.doesNotMatch(main, /resourcesPath,\s*["']node["'],\s*["']node\.exe["']/,
  "the packaged shell must not require a second Node executable");
assert.match(prewarm, /require\(["']electron["']\)/,
  "compile-cache prewarm must use the same Electron Node runtime as production");
assert.match(prewarm, /ELECTRON_RUN_AS_NODE:\s*["']1["']/,
  "prewarm must explicitly enable Electron's Node mode");
assert.match(prewarm, /spawn\(electron,\s*\[["']--expose-internals["'],\s*cli/,
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
  /function Start-DesktopApp[\s\S]*Start-Process \$AppPath[\s\S]*-Environment\s*@\{[\s\S]*ELECTRON_RUN_AS_NODE\s*=\s*\$null[\s\S]*ATOM_SHELL_INTERNAL_RUN_AS_NODE\s*=\s*\$null[\s\S]*-PassThru/,
  "desktop acceptance must explicitly strip both Electron Node flags from the child environment");
assert.match(verifier, /\.Process\.HasExited[\s\S]*desktop process exited/,
  "desktop acceptance must fail fast with process diagnostics when Electron exits before HTTP readiness");

console.log("installer slimming contract verified");
