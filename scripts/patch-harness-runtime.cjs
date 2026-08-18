const fs = require("node:fs");
const path = require("node:path");

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`${label}: upstream anchor changed`);
  return source.replace(before, after);
}

function patchTheme(source) {
  source = replaceOnce(source, "\t\t\trevision = 0;\n\t\t\tsnapshot;", "\t\t\trevision = 0;\n\t\t\tpendingPreference;\n\t\t\twriteSequence = 0;\n\t\t\tsnapshot;", "theme state");
  source = replaceOnce(source, `\t\t\tsetTheme(id) {
\t\t\t\tif (id !== "system" && !this.themes.some((t) => t.id === id)) throw new Error(\`theme "\${id}" is not registered\`);
\t\t\t\tif (this.preference === id) return;
\t\t\t\tthis.preference = id;
\t\t\t\tif (isThemePreference(id)) this.host.set(THEME_PREFERENCE_FIELD, id);
\t\t\t\tthis.publish();
\t\t\t}`, `\t\t\tsetTheme(id) {
\t\t\t\tif (id !== "system" && !this.themes.some((t) => t.id === id)) throw new Error(\`theme "\${id}" is not registered\`);
\t\t\t\tif (this.preference === id && this.pendingPreference === void 0) return;
\t\t\t\tconst sequence = ++this.writeSequence;
\t\t\t\tthis.preference = id;
\t\t\t\tthis.pendingPreference = id;
\t\t\t\tthis.publish();
\t\t\t\tif (!isThemePreference(id)) return;
\t\t\t\tPromise.resolve(this.host.set(THEME_PREFERENCE_FIELD, id)).then(() => {
\t\t\t\t\tif (sequence !== this.writeSequence) return;
\t\t\t\t\tthis.pendingPreference = void 0;
\t\t\t\t\tthis.adopt();
\t\t\t\t}, () => {
\t\t\t\t\tif (sequence !== this.writeSequence) return;
\t\t\t\t\tthis.pendingPreference = void 0;
\t\t\t\t\tthis.adopt();
\t\t\t\t});
\t\t\t}`, "theme write ordering");
  return replaceOnce(source, "\t\t\t\tif (section === void 0 || this.preference === section.preference) return;", "\t\t\t\tif (section === void 0 || this.preference === section.preference) return;\n\t\t\t\tif (this.pendingPreference !== void 0 && section.preference !== this.pendingPreference) return;", "theme stale adoption");
}

function patchCompaction(source) {
  source = replaceOnce(source, "const DEFAULT_THRESHOLD_RATIO = .8;", "const DEFAULT_THRESHOLD_RATIO = .65;", "compaction threshold ratio");
  source = replaceOnce(source, "const DEFAULT_RETAIN_RATIO = .16;", "const DEFAULT_RETAIN_RATIO = .16;\n/** Fixed reserve for provider framing and token-estimation drift. */\nconst OUTPUT_TOKEN_SAFETY_MARGIN = 16384;", "compaction safety margin");
  source = replaceOnce(source, "function resolveCompactSpec(policy, contextWindow) {", "function resolveCompactSpec(policy, contextWindow, requestedMaxTokens = 0) {", "compaction spec signature");
  source = replaceOnce(source, "\tconst thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);", "\tconst ratioThresholdTokens = Math.floor(contextWindow * policy.thresholdRatio);\n\tconst outputSafeThresholdTokens = Math.max(1, contextWindow - requestedMaxTokens - OUTPUT_TOKEN_SAFETY_MARGIN);\n\tconst thresholdTokens = Math.min(ratioThresholdTokens, outputSafeThresholdTokens);", "compaction output reserve");
  return replaceOnce(source, "resolveCompactSpec(policy, context.contextWindow);", "resolveCompactSpec(policy, context.contextWindow, context.maxTokens ?? 0);", "compaction model capacity");
}

function patchConversation(source) {
  const imageBridgeCode = "\n\t\t\t\tconst onImageFiles = (event) => {\n\t\t\t\t\tconst files = event.detail?.files;\n\t\t\t\t\tif (!canAcceptDrop || !Array.isArray(files) || files.length === 0) return;\n\t\t\t\t\tintakeImages(files);\n\t\t\t\t};";
  if (!source.includes("onImageFiles")) {
    const hasFilesPattern = /(\t\t\t\tconst\s+hasFiles\s*=\s*\([^)]*\)\s*=>\s*event\.dataTransfer\?\.\s*types\.includes\(["']Files["']\)\s*\?\?\s*false;)/;
    if (hasFilesPattern.test(source)) {
      source = source.replace(hasFilesPattern, "$1" + imageBridgeCode);
    }
  }
  if (!source.includes('addEventListener("dsh:image-files"') && !source.includes("addEventListener('dsh:image-files'")) {
    const dragEnterPattern = /(\t\t\t\tdocument\.addEventListener\(["']dragenter["'],\s*onDragEnter\);)/;
    if (dragEnterPattern.test(source)) {
      source = source.replace(dragEnterPattern, "\t\t\t\tdocument.addEventListener(\"dsh:image-files\", onImageFiles);\n$1");
    }
  }
  if (!source.includes('removeEventListener("dsh:image-files"') && !source.includes("removeEventListener('dsh:image-files'")) {
    const dragEnterRemovePattern = /(\t\t\t\t\tdocument\.removeEventListener\(["']dragenter["'],\s*onDragEnter\);)/;
    if (dragEnterRemovePattern.test(source)) {
      source = source.replace(dragEnterRemovePattern, "\t\t\t\t\tdocument.removeEventListener(\"dsh:image-files\", onImageFiles);\n$1");
    }
  }
  return source;
}

function patchAquaSlotKey(source) {
	// upstream slots 0.1.0-rc.7 起 settings.plugin.item 为 keyed slot（注册需 options.key）；
	// marketplace 安装的 aqua 1.3.0 仍按旧 list API 以 id 注册，加载即抛
	// keyed slot "settings.plugin.item" requires options.key。改为 key 注册；
	// aqua 升级为官方 keyed 形态后锚点消失，本补丁自动跳过。
	const before = 'name: "settings.plugin.item",\n				id: "aqua",';
	const after = 'name: "settings.plugin.item",\n				key: "aqua",';
	if (source.includes(after) || !source.includes(before)) return source;
	return source.replace(before, after);
}
function patchMinimalPreset(source) {
  if (/^\s*- id: compaction\s*$/m.test(source)) return source;
  source = source.replace("Context compaction is absent.", "Context compaction is mounted internally without changing the two-tool model surface.");
  return `${source.trimEnd()}\n\n# Internal context maintenance; these rows do not add model-facing tools.\n- id: compaction\n  name: cordis:group\n  group: true\n  isolate:\n    compaction: true\n    toolResultPruner: true\n  config:\n    - id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'\n\n    - id: command-compact\n      name: '@deepseek-ai/dsh-command-compact'\n\n    - id: tool-result-pruner\n      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'\n      config:\n        thresholdChars: 8192\n        headChars: 4096\n        tailChars: 1024\n`;
}

function patchFile(file, transform) {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const after = transform(before);
  if (after === before) return false;
  fs.writeFileSync(file, after, "utf8");
  return true;
}

function reconcileClientOnlyPlugins(profileDir) {
  const manifestPath = path.join(profileDir, "package.json");
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(patchPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let patch = fs.readFileSync(patchPath, "utf8");
  const activated = [];
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const packagePath = path.join(profileDir, "node_modules", ...name.split("/"), "package.json");
    if (!fs.existsSync(packagePath)) continue;
    const plugin = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    if (plugin.dsh?.bundle?.patch !== void 0 || plugin.dsh?.client === void 0 || patch.includes(`name: '${name}'`) || patch.includes(`name: ${name}`)) continue;
    const id = name === "@deepseek-ai/dsh-client-ui-aqua"
      ? "ui-aqua"
      : `desktop-${name.replace(/^@/, "").replace(/[^a-zA-Z0-9-]+/g, "-")}`;
    patch += `\n# Activated by DeepSeek Harness Desktop: client plugin without dsh.bundle.\n- insert:\n    - id: ${id}\n      name: '${name}'\n`;
    activated.push(name);
  }
  if (activated.length > 0) fs.writeFileSync(patchPath, patch, "utf8");
  return activated;
}

// v3.1.1：聚合包去重防护。dsh-web-ui-all@0.2.0 起在自身 bundle patch 里
// 内置了 dsh-better-sidebar 入口（web-ui-better-sidebar），与 profile 的
// dsh.profile.bundles 显式声明形成双重加载——两个实例都注册 /sidebar/api，
// 后端启动即抛 duplicate prefix route 并以 code=1 退出（页面 ERR_FAILED，
// 用户感知为"插件更新后崩溃"）。规则：扫描 profile 依赖中声明了
// dsh.bundle.patch 的聚合包，其 insert 的 name 若已被 profile bundles
// 显式声明，则在 profile 补丁层禁用该聚合入口（保留显式加载，功能不变）。
// 幂等：目标 id 已在补丁层出现时跳过；失败向上抛由 onFailure 单点上报。
function dedupeAggregatedPluginEntries(profileDir) {
  const manifestPath = path.join(profileDir, "package.json");
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(patchPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const explicitBundles = new Set(manifest.dsh?.profile?.bundles ?? []);
  if (explicitBundles.size === 0) return [];
  const suppressed = [];
  const candidates = new Set([...explicitBundles, ...Object.keys(manifest.dependencies ?? {})]);
  for (const name of candidates) {
    if (name.startsWith("@") && name.split("/").length !== 2) continue;
    const pkgPath = path.join(profileDir, "node_modules", ...name.split("/"), "package.json");
    const patchFile = path.join(profileDir, "node_modules", ...name.split("/"), "cordis.patch.yml");
    if (!fs.existsSync(pkgPath) || !fs.existsSync(patchFile)) continue;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { continue; }
    if (pkg.dsh?.bundle?.patch === void 0) continue;
    const source = fs.readFileSync(patchFile, "utf8");
    for (const match of source.matchAll(/- id:\s*([^\s]+)\s*\n\s+name:\s*'?([^\s']+)/g)) {
      const entryId = match[1], entryName = match[2];
      // 只压制"聚合包替别人 insert"的条目：entry 已被显式声明且不是聚合包自身
      if (!explicitBundles.has(entryName) || entryName === name) continue;
      suppressed.push(`${entryId}(${name})`);
    }
  }
  if (suppressed.length === 0) return [];
  let patch = fs.readFileSync(patchPath, "utf8");
  const additions = [];
  for (const item of suppressed) {
    const entryId = item.slice(0, item.indexOf("("));
    if (new RegExp(`^\\s*- id:\\s*${entryId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(patch)) continue;
    if (!additions.some((a) => a.startsWith(`- id: ${entryId}\n`))) {
      additions.push(`- id: ${entryId}\n  disabled: true`);
    }
  }
  if (additions.length === 0) return [];
  patch += `\n# dsh-desktop dedupe: aggregated entry duplicates an explicit profile bundle;\n# suppressing the aggregated copy to avoid duplicate route registration at boot.\n${additions.join("\n")}\n`;
  fs.writeFileSync(patchPath, patch, "utf8");
  return suppressed;
}

function patchHarnessRuntime(runtimeRoot, profileDir, options = {}) {
  const onFailure = typeof options.onFailure === "function" ? options.onFailure : null;
  const modules = path.join(runtimeRoot, "node_modules");
  const changed = [];
  // v3.1：单补丁锚点漂移只跳过该补丁并上报（onFailure），不再中断整链——
  // 此前 theme 锚点一变，后面的 aqua-slot-key 等修复全部失效。
  const apply = (label, file, transform) => {
    try {
      if (patchFile(file, transform)) changed.push(label);
    } catch (error) {
      if (onFailure) onFailure(`${label}: ${error.message}`);
    }
  };
  apply("theme", path.join(modules, "@deepseek-ai", "dsh-client-ui-theme", "lib", "client.js"), patchTheme);
  apply("compaction", path.join(modules, "@deepseek-ai", "dsh-compaction-basic", "lib", "index.js"), patchCompaction);
  apply("conversation", path.join(modules, "@deepseek-ai", "dsh-client-ui-conversation", "lib", "client.js"), patchConversation);
  apply("minimal-compaction", path.join(modules, "@deepseek-ai", "dsh", "config", "agent-presets", "minimal", "agent.cordis.yml"), patchMinimalPreset);
  if (profileDir) {
    apply("aqua-slot-key", path.join(profileDir, "node_modules", "@deepseek-ai", "dsh-client-ui-aqua", "lib", "client.js"), patchAquaSlotKey);
    try {
      changed.push(...reconcileClientOnlyPlugins(profileDir).map((name) => `activate:${name}`));
    } catch (error) {
      if (onFailure) onFailure(`activate-client-plugins: ${error.message}`);
    }
    try {
      changed.push(...dedupeAggregatedPluginEntries(profileDir).map((item) => `dedupe:${item}`));
    } catch (error) {
      if (onFailure) onFailure(`dedupe-aggregated-entries: ${error.message}`);
    }
  }
  return changed;
}

if (require.main === module) {
  const [runtimeRoot, profileDir] = process.argv.slice(2);
  if (!runtimeRoot) throw new Error("usage: node patch-harness-runtime.cjs <runtime-root> [profile-dir]");
  process.stdout.write(`${patchHarnessRuntime(path.resolve(runtimeRoot), profileDir && path.resolve(profileDir)).join(",") || "already-patched"}\n`);
}

module.exports = { patchHarnessRuntime, patchTheme, patchCompaction, patchConversation, patchAquaSlotKey, patchMinimalPreset, reconcileClientOnlyPlugins, dedupeAggregatedPluginEntries };
