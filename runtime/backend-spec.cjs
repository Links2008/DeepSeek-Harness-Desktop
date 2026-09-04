const fs = require("node:fs");
const path = require("node:path");

function createBackendSpec(options) {
  const {
    packaged,
    execPath,
    resourcesPath,
    userData,
    port = 3080,
    devDshDir = "D:\\deepseek-harness",
    exists = fs.existsSync,
    prepareCompileCache,
  } = options;
  if (packaged) {
    const runtimeRoot = path.join(resourcesPath, "dsh-runtime");
    const cli = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    if (!exists(cli)) return null;
    const cache = prepareCompileCache(userData, resourcesPath);
    return {
      mode: "packaged-electron-node",
      command: execPath,
      args: [
        "--use-system-ca",
        "--expose-internals",
        cli,
        "web",
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      cwd: runtimeRoot,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        NODE_COMPILE_CACHE: cache.dir,
        NODE_COMPILE_CACHE_PORTABLE: "1",
        DSH_TELEMETRY_DISABLED: "1",
        DSH_STARTUP_DIAGNOSTICS: "1",
      },
      compileCache: cache,
      port,
    };
  }
  if (!exists(devDshDir)) return null;
  return {
    mode: "development-pnpm",
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/c", "pnpm", "dsh", "web"],
    cwd: devDshDir,
    env: {},
    port,
  };
}

module.exports = { createBackendSpec };
