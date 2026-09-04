const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const verifier = fs.readFileSync(path.join(root, "scripts", "verify-installed-runtime.ps1"), "utf8");
const hostSource = fs.readFileSync(path.join(root, "runtime", "daemon-host.cjs"), "utf8");
const { createBackendSpec } = require(path.join(root, "runtime", "backend-spec.cjs"));
const {
  daemonPaths,
  isReusableState,
  pipeNameFor,
} = require(path.join(root, "runtime", "daemon-controller.cjs"));

const resourcesPath = "C:\\Program Files\\DeepSeekHarness\\resources";
const userData = "C:\\Users\\tester\\AppData\\Roaming\\dsh-desktop";
const spec = createBackendSpec({
  packaged: true,
  execPath: "C:\\Program Files\\DeepSeekHarness\\DeepSeekHarness.exe",
  resourcesPath,
  userData,
  port: 3080,
  exists: () => true,
  prepareCompileCache: () => ({ dir: path.join(resourcesPath, "node-compile-cache"), packaged: true, error: null }),
});

assert.equal(spec.mode, "packaged-electron-node");
assert.deepEqual(spec.args.slice(0, 2), ["--use-system-ca", "--expose-internals"]);
assert.equal(spec.env.ELECTRON_RUN_AS_NODE, "1");
assert.equal(spec.env.NODE_COMPILE_CACHE_PORTABLE, "1");
assert.equal(spec.env.DSH_TELEMETRY_DISABLED, "1");

const paths = daemonPaths(userData);
assert.equal(paths.state, path.join(userData, "daemon-state.json"));
assert.equal(paths.launch, path.join(userData, "daemon-launch.json"));
assert.equal(paths.lock, path.join(userData, "daemon-launch.lock"));
assert.match(pipeNameFor(userData), /^\\\\\.\\pipe\\dsh-desktop-[a-f0-9]{16}$/);
assert.equal(isReusableState({ version: "4.0.0", port: 3080 }, { version: "4.0.0", port: 3080 }), true);
assert.equal(isReusableState({ version: "3.2.3", port: 3080 }, { version: "4.0.0", port: 3080 }), false);

assert.match(hostSource, /net\.createServer/);
assert.match(hostSource, /request\.token\s*!==\s*config\.token/);
assert.match(hostSource, /MAX_RESPAWN\s*=\s*3/);
assert.match(hostSource, /quarantineBrokenPlugin\(stderrTail\)/);
assert.match(main, /new DaemonController\(/);
assert.match(main, /--daemon-prewarm/);
assert.match(main, /setLoginItemSettings/);
assert.match(main, /--no-login-prewarm/);
assert.match(main, /isDaemonPrewarm\s*\|\|\s*app\.requestSingleInstanceLock\(\)/,
  "login prewarm must not own the foreground shell's single-instance lock");
assert.doesNotMatch(main, /function resolveBackend\(/, "the legacy in-window backend resolver must be removed");
assert.doesNotMatch(main, /function ensureDshBackend\(/, "the legacy in-window supervisor must be removed");
assert.doesNotMatch(main, /\bdshProc\b/, "the Electron main process must not own the persistent backend child");
assert.doesNotMatch(main, /function quarantineBrokenPlugin\(/,
  "broken-plugin recovery must remain available after the desktop window exits");
assert.doesNotMatch(main, /mainWindow\.on\("closed"[\s\S]{0,500}killBackendTree\(\)/);
assert.doesNotMatch(main, /app\.on\("window-all-closed"[\s\S]{0,300}killBackendTree\(\)/);
assert.match(main, /mainWindow\.on\("close"[\s\S]*event\.preventDefault\(\)[\s\S]*mainWindow\.hide\(\)/,
  "ordinary close must retain the ready Chromium shell for instant reopen");
assert.match(main, /CommandOrControl\+Q[\s\S]*isQuitting\s*=\s*true[\s\S]*app\.quit\(\)/,
  "Ctrl+Q must remain an explicit full shell exit");

assert.match(builder, /runtime\/backend-spec\.cjs/);
assert.match(builder, /runtime\/daemon-controller\.cjs/);
assert.match(builder, /runtime\/daemon-host\.cjs/);
assert.match(verifier, /\$acceptanceUserData/);
assert.match(verifier, /--user-data-dir=/);
assert.match(verifier, /--no-login-prewarm/);
assert.match(verifier, /Join-Path \$acceptanceUserData \$logName/);

console.log("persistent daemon architecture verified");
