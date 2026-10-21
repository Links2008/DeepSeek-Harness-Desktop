const { fileURLToPath } = require("node:url");

function diagnosticNodeOptions(existing) {
  return [existing, `--require ${JSON.stringify(__filename)}`].filter(Boolean).join(" ");
}

function summarizeModules(entries) {
  const files = new Set();
  for (const entry of entries) {
    if (entry.startsWith("node:")) continue;
    const file = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
    files.add(file.replace(/\\/g, "/"));
  }
  const counts = new Map();
  for (const file of files) {
    const marker = "/node_modules/";
    const index = file.lastIndexOf(marker);
    const parts = file.slice(index + marker.length).split("/");
    const name = index < 0 ? "(runtime)" : parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    modules: files.size,
    packages: [...counts].map(([name, files]) => ({ name, files }))
      .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name)).slice(0, 20),
  };
}

// 只在构建预热时读取已加载模块，不安装加载钩子，以免改变编译缓存行为。
if (process.env.DSH_PREWARM_DIAGNOSTICS === "1") {
  const originalWrite = process.stderr.write;
  process.stderr.write = function (chunk, ...args) {
    if (String(chunk).includes("[dsh-startup] compile cache flushed")) {
      process.stderr.write = originalWrite;
      let esm = [];
      let esmAvailable = false;
      try {
        esm = [...require("internal/modules/esm/loader").getOrInitializeCascadedLoader().loadCache.keys()];
        esmAvailable = true;
      } catch {}
      const inventory = { ...summarizeModules([...Object.keys(require.cache), ...esm]), esmAvailable };
      // 只输出包名和计数，不输出路径、配置或凭据。
      originalWrite.call(this, `[dsh-prewarm] module inventory ${JSON.stringify(inventory)}\n`);
    }
    return originalWrite.call(this, chunk, ...args);
  };
}

module.exports = { summarizeModules, diagnosticNodeOptions };
