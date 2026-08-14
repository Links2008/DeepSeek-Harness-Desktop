const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const appId = builder.match(/^appId:\s*(\S+)/m)?.[1];
const {
  APP_ID,
  nextMaximizeCommand,
  sanitizeTaskTitle,
  shouldNotifyTaskCompletion,
} = require("../desktop-behavior");

assert.equal(APP_ID, appId, "runtime AUMID must match the installed shortcut AppID");
assert.equal(shouldNotifyTaskCompletion({ focused: true, minimized: false }), true);
assert.equal(shouldNotifyTaskCompletion({ focused: false, minimized: false }), true);
assert.equal(shouldNotifyTaskCompletion({ focused: false, minimized: true }), true);
assert.equal(sanitizeTaskTitle(42), "");
assert.equal(sanitizeTaskTitle("x".repeat(121)).length, 120);
assert.equal(nextMaximizeCommand(false), "maximize");
assert.equal(nextMaximizeCommand(true), "unmaximize");

console.log("desktop behavior verified");
