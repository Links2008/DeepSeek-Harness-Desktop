const path = require("node:path");
const fs = require("node:fs");

const modulesRoot = process.argv[2];
if (!modulesRoot) throw new Error("usage: electron-node-runtime-probe.cjs <node_modules>");
if (!process.execArgv.includes("--expose-internals")) {
  throw new Error("Electron Node must expose internals for profile-aware ESM resolution");
}
const internalLoader = require("internal/modules/esm/loader");
if (typeof internalLoader.getOrInitializeCascadedLoader !== "function") {
  throw new Error("Electron Node internal ESM loader is unavailable");
}

const packages = {};
for (const name of ["node-pty", "sharp", "koffi"]) {
  const loaded = require(path.join(modulesRoot, name));
  packages[name] = Object.keys(loaded).slice(0, 8);
}
if (fs.existsSync(path.join(modulesRoot, 'fs-ext'))) {
  const nativeFs = require(path.join(modulesRoot, 'fs-ext'));
  if (typeof nativeFs.flockSync !== 'function') throw new Error('fs-ext flockSync is unavailable');
  packages['fs-ext'] = ['flockSync'];
}

process.stdout.write(`${JSON.stringify({
  node: process.versions.node,
  electron: process.versions.electron,
  modules: process.versions.modules,
  napi: process.versions.napi,
  internalLoader: true,
  packages,
})}\n`);
