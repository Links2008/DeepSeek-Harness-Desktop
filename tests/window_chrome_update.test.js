const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const controlsPath = path.join(root, "window-controls.html");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const workflowPath = path.join(root, ".github", "workflows", "upstream-sync.yml");

assert.match(main, /show:\s*false/, "window must stay hidden until rounded chrome is installed");
assert.match(main, /dom-ready/, "chrome must be installed before the first visible paint");
assert.match(main, /ready-to-show/, "window should only become visible after rendering is ready");
assert.match(main, /MutationObserver/, "SPA rerenders must restore the injected window controls");
assert.match(main, /WebContentsView/, "controls must render above page-level modal blur");
assert.match(main, /contentView\.addChildView/);
assert.match(main, /x:\s*26/, "traffic-light controls must move right by one former dot width");
assert.match(main, /width:\s*48,\s*height:\s*12/, "controls surface must not vertically resample 12px dots");
assert.equal(fs.existsSync(controlsPath), true, "native controls overlay must be packaged");
const controls = fs.readFileSync(controlsPath, "utf8");
assert.match(controls, /width:\s*12px/);
assert.match(controls, /height:\s*12px/);
assert.match(controls, /border:\s*0/, "traffic lights must not use a soft fractional-looking rim");
assert.doesNotMatch(controls, /0\s+0\s+0\s+\.5px/, "half-pixel inset shadows become blurry at Windows DPI scaling");
assert.match(controls, /#ff5f57/i);
assert.match(controls, /#febc2e/i);
assert.match(controls, /#28c840/i);
assert.match(controls, /transform:\s*scale\(\.84\)/, "press feedback must be visible");
assert.match(controls, /prefers-reduced-motion:\s*reduce/);
assert.doesNotMatch(main, /dsh-win-controls/, "page DOM controls would be blurred by settings");
assert.doesNotMatch(main, /right:\s*108px;height:48px/, "drag surface must not cover page actions");
assert.match(main, /dblclick/, "the safe title strip should support maximize and restore");

assert.equal(pkg.dependencies?.["electron-updater"] != null, true);
assert.match(main, /checkForUpdates/);
assert.match(main, /autoInstallOnAppQuit\s*=\s*true/);
assert.match(builder, /provider:\s*github/);
assert.match(builder, /owner:\s*Links2008/);
assert.match(builder, /repo:\s*Deepseek-Harness-/);
assert.match(builder, /window-controls\.html/);
assert.equal(fs.existsSync(workflowPath), true, "upstream tracking workflow must exist");

const workflow = fs.readFileSync(workflowPath, "utf8");
assert.match(workflow, /schedule:/);
assert.match(workflow, /deepseek-ai\/deepseek-harness/);
assert.match(workflow, /npm test/);
assert.match(workflow, /HTTP 200|StatusCode/);
assert.match(workflow, /gh release create/);

console.log("window chrome and update configuration verified");
