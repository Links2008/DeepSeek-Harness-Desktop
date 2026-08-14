const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");

assert.match(main, /process\.resourcesPath/);
assert.match(main, /dsh-runtime/);
assert.match(main, /node\.exe/);
assert.match(main, /"@deepseek-ai", "dsh", "lib", "bin\.js"/);
assert.match(builder, /target:\s*nsis/);
assert.match(builder, /oneClick:\s*false/);
assert.match(builder, /allowToChangeInstallationDirectory:\s*true/);
assert.match(builder, /useZip:\s*true/);
assert.match(builder, /createDesktopShortcut:\s*always/);
assert.match(builder, /deepseek_whale_hermes_rounded\.ico/);
assert.match(builder, /DeepSeekHarness-Setup-\$\{version\}\.\$\{ext\}/);

console.log("installer runtime configuration verified");
