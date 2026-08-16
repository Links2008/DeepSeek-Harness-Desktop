const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const controls = fs.readFileSync(path.join(root, "window-controls.html"), "utf8");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "upstream-sync.yml"),
  "utf8",
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "2.0.1", "the repaired build must sort after the broken v2.0 release");

assert.doesNotMatch(main, /scheduleAutoUpdates/, "updates must only start from the existing check-update button");
assert.doesNotMatch(main, /setInterval\s*\(\s*checkForUpdates/);
assert.doesNotMatch(main, /setTimeout\s*\(\s*checkForUpdates/);
assert.match(main, /initializeUpdater/);
assert.match(main, /autoUpdater\.checkForUpdates\(\)/);
assert.match(main, /update-downloaded/);
assert.match(main, /autoUpdater\.quitAndInstall\(false,\s*true\)/);
assert.match(main, /button\[aria-label=["']检查更新["']\]/, "reuse the Harness sidebar update button");
assert.match(main, /data-dsh-update-state/, "the existing button must expose checking, downloading and ready states");
assert.match(preload, /checkUpdate/);
assert.match(preload, /installUpdate/);
assert.match(preload, /onUpdateState/);

assert.match(main, /width:\s*48,\s*height:\s*18/, "the overlay must contain only the three 16px controls");
assert.match(main, /\(w - 56\) \/ 224/);
assert.match(main, /4 \+ 19 \* t/, "controls should move inside the sidebar from x=4 to x=23");
assert.match(main, /ResizeObserver/, "sidebar animation should be observed from real layout changes");
assert.doesNotMatch(main, /requestAnimationFrame\(dshTrackSidebar\)/, "an idle infinite animation loop wastes renderer time");
assert.doesNotMatch(main, /controlsView\.isDestroyed\(\)/, "WebContentsView has no isDestroyed method");
assert.match(main, /controlsView\.webContents\.isDestroyed\(\)/);
assert.doesNotMatch(controls, /checkUpdate|检查更新/, "the top overlay must not contain the updater entry");

assert.match(main, /moveTop\(\)/, "notification activation must raise the app on Windows");
assert.match(main, /taskUrl/, "completion events must keep their destination URL");
assert.match(main, /loadURL\(taskUrl\)/, "notification clicks must navigate to the completed task");
assert.match(main, /previous\.(?:state|status) === ['"]running['"]/);
assert.match(main, /!seen\.has\(key\)/, "a running task removed from the DOM must still complete");

assert.doesNotMatch(workflow, /installer-dist[\\/]\*\.zip|gh release upload[^\n]*\.zip/i);
assert.match(workflow, /DeepSeekHarness-Setup-\$version\.exe/);
assert.match(workflow, /installer-dist[\\/]latest\.yml/);

console.log("manual v2 runtime behavior verified");
