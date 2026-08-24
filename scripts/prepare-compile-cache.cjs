const fs = require("node:fs");
const path = require("node:path");

function prepareCompileCache(userDataDir, resourcesPath) {
  const packagedDir = path.join(resourcesPath, "node-compile-cache");
  try {
    fs.mkdirSync(packagedDir, { recursive: true });
    fs.accessSync(packagedDir, fs.constants.W_OK);
    return { dir: packagedDir, packaged: true, error: null };
  } catch (error) {
    const fallbackDir = path.join(userDataDir, "node-compile-cache");
    fs.mkdirSync(fallbackDir, { recursive: true });
    return { dir: fallbackDir, packaged: false, error };
  }
}

module.exports = { prepareCompileCache };
