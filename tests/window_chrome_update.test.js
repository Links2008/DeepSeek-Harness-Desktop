const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const controlsPath = path.join(root, "window-controls.html");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const workflowPath = path.join(root, ".github", "workflows", "upstream-sync.yml");
const verifier = fs.readFileSync(path.join(root, "scripts", "verify-installed-runtime.ps1"), "utf8");

assert.match(main, /show:\s*true/, "v2 must show its native-color window immediately");
assert.match(main, /transparent:\s*false/);
assert.match(main, /backgroundColor:\s*nativeTheme\.shouldUseDarkColors\s*\?\s*["']#121214["']\s*:\s*["']#f9fafb["']/,
  "the startup surface must follow the current Windows light/dark preference");
assert.doesNotMatch(main, /WIN_RADIUS|--dsh-window-radius|clip-path:\s*inset/, "the shell must not impose custom rounded corners");
assert.match(main, /dom-ready/, "chrome must be installed as soon as the web UI is available");
assert.doesNotMatch(main, /ready-to-show|revealWhenReady|window reveal fallback/);
assert.match(main, /MutationObserver/, "SPA rerenders must restore the injected window controls");
assert.match(main, /WebContentsView/, "controls must render above page-level modal blur");
assert.match(main, /contentView\.addChildView/);
assert.match(main, /requestSingleInstanceLock/, "a second launch must reuse the existing app instance");
assert.match(main, /second-instance/, "the primary instance must handle a repeated launch");
assert.match(main, /isMinimized\(\)[\s\S]*restore\(\)[\s\S]*focus\(\)/, "a repeated launch must restore and focus the existing window");
assert.match(main, /isDshBackend/, "an occupied 3080 port must be verified before reuse");
assert.match(main, /occupied by a non-Harness service/, "foreign services on 3080 must fail clearly instead of being opened");
assert.match(main, /loadFile\([^)]*loading\.html/,
  "v3.2 must show its local startup surface while the independent backend initializes");
assert.match(main, /const backendPromise = ensureDshBackend\(\);[\s\S]*createWindow\(\);[\s\S]*await backendPromise/, "backend startup and immediate window creation should overlap");
assert.match(main, /CONTROL_COLLAPSED_X\s*=\s*4/, "collapsed controls must stay inside the 56px rail");
assert.match(main, /CONTROL_Y\s*=\s*3/, "controls must sit slightly lower");
assert.match(main, /width:\s*48,\s*height:\s*18/, "controls surface must expose three 16px hit targets");
assert.equal(fs.existsSync(controlsPath), true, "native controls overlay must be packaged");
const controls = fs.readFileSync(controlsPath, "utf8");
assert.match(controls, /width:\s*10px/);
assert.match(controls, /height:\s*10px/);
assert.match(controls, /border:\s*0/, "traffic lights must not use a soft fractional-looking rim");
assert.doesNotMatch(controls, /0\s+0\s+0\s+\.5px/, "half-pixel inset shadows become blurry at Windows DPI scaling");
assert.match(controls, /#ff5f57/i);
assert.match(controls, /#febc2e/i);
assert.match(controls, /#28c840/i);
assert.match(controls, /scale\(\.84\)/, "press feedback should stay subtle and native-feeling");
assert.doesNotMatch(controls, /ACTIVATION_MS|control-release|halo-release/, "controls must not bounce or delay the native action");
assert.match(controls, /addEventListener\(["']pointerdown["']/);
assert.match(controls, /classList\.add\(["']pressed["']\)/);
assert.doesNotMatch(controls, /classList\.add\(["']releasing["']\)/);
assert.match(controls, /window\.dshWin\[button\.dataset\.action\]\(\{ reducedMotion \}\)/);
assert.match(controls, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(main, /dsh-win-controls/, "page DOM controls would be blurred by settings");
assert.doesNotMatch(main, /right:\s*108px;height:48px/, "drag surface must not cover page actions");
assert.match(main, /dblclick/, "the safe title strip should support maximize and restore");
assert.match(main, /mainWindow\.isMaximized\(\)/, "maximize state must come from the native window");
assert.match(main, /mainWindow\[command\]\(\)/, "maximize and restore must delegate to Electron's native commands");
assert.doesNotMatch(main, /animateWindowBounds|setBounds\(frame\)/, "manual frame stepping must not fight the Windows DWM");

assert.match(preload, /taskComplete/, "the page completion signal must cross the preload bridge");
assert.match(main, /injectTaskCompletionBridge/, "the desktop shell must observe real running-to-idle session edges");
assert.match(main, /task:complete/);
assert.match(main, /Notification\.isSupported\(\)/);
assert.match(main, /new Notification\(/);
assert.match(main, /任务已完成/);
assert.match(main, /setAppUserModelId\(APP_ID\)/);
assert.match(main, /shouldNotifyTaskCompletion/);
assert.match(main, /notification attempted/);
assert.match(main, /notification shown/);
assert.match(main, /backgroundThrottling:\s*false/, "completion detection must continue while minimized");

assert.equal(pkg.dependencies?.["electron-updater"] != null, true);
assert.match(main, /checkForUpdates/);
assert.match(main, /autoInstallOnAppQuit\s*=\s*false/, "installation must wait for the explicit restart-update action");
assert.match(builder, /provider:\s*github/);
assert.match(builder, /owner:\s*Links2008/);
assert.match(builder, /repo:\s*DeepSeek-Harness-Desktop/);
assert.match(builder, /desktop-behavior\.js/);
assert.match(builder, /window-controls\.html/);
assert.match(builder, /loading\.html/);
assert.match(builder, /deepseek_whale_hermes_rounded\.png/, "loading artwork must be included in app.asar");
assert.equal(fs.existsSync(workflowPath), true, "upstream tracking workflow must exist");

const workflow = fs.readFileSync(workflowPath, "utf8");
assert.match(workflow, /schedule:/);
assert.match(workflow, /deepseek-ai\/deepseek-harness/);
assert.match(workflow, /npm test/);
assert.match(workflow, /verify-installed-runtime\.ps1/);
assert.match(verifier, /StatusCode\s+-eq\s+200/, "installed acceptance must require HTTP 200");
assert.doesNotMatch(workflow, /github-actions\[bot\]|git push|gh release (?:create|upload|edit)/i,
  "upstream tracking must validate without submitting as a bot");

console.log("window chrome and update configuration verified");
