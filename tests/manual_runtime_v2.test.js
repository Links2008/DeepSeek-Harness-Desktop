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

assert.match(pkg.version, /^3\.\d+\.\d+$/, "the release must remain on the stable v3 desktop line");

assert.doesNotMatch(main, /scheduleAutoUpdates/, "updates must only start from the existing check-update button");
assert.doesNotMatch(main, /setInterval\s*\(\s*checkForUpdates/);
assert.doesNotMatch(main, /setTimeout\s*\(\s*checkForUpdates/);
assert.match(main, /initializeUpdater/);
assert.match(main, /autoUpdater\.checkForUpdates\(\)/);
assert.match(main, /update-downloaded/);
assert.match(main, /autoUpdater\.quitAndInstall\(true,\s*true\)/);
assert.match(main, /button\[aria-label=["']检查更新["']\]/, "reuse the Harness sidebar update button");
assert.match(main, /data-dsh-update-state/, "the existing button must expose checking, downloading and ready states");
assert.match(preload, /checkUpdate/);
assert.match(preload, /installUpdate/);
assert.match(preload, /onUpdateState/);

assert.match(main, /CONTROL_Y\s*=\s*3/, "the three controls should sit 3px lower");
assert.match(main, /y:\s*CONTROL_Y,\s*width:\s*48,\s*height:\s*18/);
assert.match(main, /animateControlsTo/);
assert.match(main, /CONTROL_MOTION_MS\s*=\s*160/);
assert.match(main, /setInterval\([\s\S]*?,\s*16\)/, "native view motion should be driven in main at frame cadence");
assert.match(main, /typeof details\.expanded !== ["']boolean["']/);
assert.match(preload, /sidebarState/);
assert.doesNotMatch(preload, /sidebarFrame/);
assert.doesNotMatch(main, /dshWin\.sidebarFrame\(width\)/, "the renderer must not send every resize frame over IPC");
assert.match(main, /expanded === lastExpanded/, "sidebar state reports must be deduplicated");
assert.match(main, /window-control-state\.json/, "cold start must reuse the last sidebar position");
assert.match(main, /loadControlState\(\)[\s\S]*createWindow\(\)/, "saved control position must load before the window appears");
assert.match(main, /saveControlState\(details\.expanded\)/);
assert.doesNotMatch(main, /requestAnimationFrame\(dshTrackSidebar\)/, "an idle infinite animation loop wastes renderer time");
assert.doesNotMatch(main, /controlsView\.isDestroyed\(\)/, "WebContentsView has no isDestroyed method");
assert.match(main, /controlsView\.webContents\.isDestroyed\(\)/);
assert.doesNotMatch(controls, /checkUpdate|检查更新/, "the top overlay must not contain the updater entry");

assert.doesNotMatch(main, /dsh-update-label/, "the update button must stay icon-only");
assert.match(main, /dataset\.dshEntryRow/, "the plugin rail row must be tagged so both buttons share one spec");
assert.match(main, /\[data-dsh-entry-row\][^{]*\{[\s\S]*?width:\s*36px\s*!important/, "rail buttons share one width");
assert.match(main, /\[data-dsh-entry-row\][^{]*\{[\s\S]*?height:\s*36px\s*!important/, "rail buttons share one height");
assert.match(main, /\[data-dsh-entry-row\][^{]*\{[\s\S]*?border-radius:\s*50%\s*!important/, "rail buttons are circular ghost buttons");
assert.match(main, /window\.__dshUpdateUnsubscribe/, "replaced SPA buttons must not leak update listeners");
assert.doesNotMatch(main, /\.dsh-drag-region\s*\{/, "the shell must not style a visible or transparent top strip");
assert.doesNotMatch(main, /className\s*=\s*['"]dsh-drag-region/, "the shell must not create a top-strip element");
assert.match(main, /\.dsh-native-drag-region\s*\{\s*-webkit-app-region:\s*drag/, "the existing header must provide native dragging");
assert.match(main, /\.dsh-native-drag-region[\s\S]*-webkit-app-region:\s*no-drag/, "header actions must remain clickable");

assert.match(main, /moveTop\(\)/, "notification activation must raise the app on Windows");
assert.match(main, /taskUrl/, "completion events must keep their destination URL");
assert.match(main, /loadURL\(taskUrl\)/, "notification clicks must navigate to the completed task");
assert.match(main, /previous\.(?:state|status) === ['"]running['"]/);
assert.match(main, /!seen\.has\(key\)/, "a running task removed from the DOM must still complete");

assert.doesNotMatch(workflow, /installer-dist[\\/]\*\.zip|gh release upload[^\n]*\.zip/i);
assert.match(workflow, /DeepSeekHarness-Setup-\$version\.exe/);
assert.match(workflow, /installer-dist[\\/]latest\.yml/);

console.log("manual v2 runtime behavior verified");
