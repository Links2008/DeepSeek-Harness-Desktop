const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");

assert.match(main, /process\.resourcesPath/);
assert.match(main, /dsh-runtime/);
assert.match(main, /process\.execPath/);
assert.match(main, /ELECTRON_RUN_AS_NODE/);
assert.match(main, /"@deepseek-ai", "dsh", "lib", "bin\.js"/);
assert.match(builder, /target:\s*nsis/);
assert.match(builder, /oneClick:\s*false/);
assert.match(builder, /allowToChangeInstallationDirectory:\s*true/);
const forcesZipExtraction = /useZip:\s*true/.test(builder);
const disablesDifferentialPackage = /differentialPackage:\s*false/.test(builder);
assert.equal(
  forcesZipExtraction && !disablesDifferentialPackage,
  false,
  "useZip:true with differential packaging embeds a 7z payload but selects the ZIP extractor",
);
assert.match(builder, /useZip:\s*true/);
assert.match(builder, /differentialPackage:\s*false/);
assert.match(builder, /!\*\*\/\*\.map/);
assert.match(builder, /!\*\*\/\*\.d\.ts/);
assert.match(builder, /electronLanguages:[\s\S]*en-US[\s\S]*zh-CN[\s\S]*zh-TW/);
assert.doesNotMatch(builder, /bundle\/node\/node\.exe/);
assert.match(builder, /createDesktopShortcut:\s*always/);
assert.match(builder, /deepseek_whale_hermes_rounded\.ico/);
assert.match(builder, /DeepSeekHarness-Setup-\$\{version\}\.\$\{ext\}/);

const installerNsh = fs.readFileSync(path.join(root, "build", "installer.nsh"), "utf8");
assert.match(installerNsh, /!macro customInit/);
assert.match(installerNsh, /!macro customUnInit/);
assert.match(installerNsh, /!macro customCheckAppRunning/);
assert.match(installerNsh, /!macro customInstall/);
assert.match(installerNsh, /CreateShortCut "\$newDesktopLink" "\$appExe"/);
assert.match(installerNsh, /WinShell::SetLnkAUMI "\$newDesktopLink" "\$\{APP_ID\}"/);
assert.match(installerNsh, /CreateShortCut "\$newStartMenuLink" "\$appExe"/);
assert.match(installerNsh, /taskkill \/F \/IM "\$\{APP_EXECUTABLE_FILENAME\}" \/T/);
assert.match(installerNsh, /Get-Process -Name node/, "v4 upgrades must still close a legacy v3 node backend");

console.log("installer runtime configuration verified");
