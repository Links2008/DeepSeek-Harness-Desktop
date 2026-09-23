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
  const staleAdoptionGuard = "\t\t\t\tif (this.pendingPreference !== void 0 && section.preference !== this.pendingPreference) return;";
  if (source.includes(staleAdoptionGuard)) return source;
  // 0.1.6 restructured adopt(): the preference comparison now also covers
  // fontSize, so the single-line guard shipped for 0.1.3 no longer exists.
  const currentStaleAnchor = "\t\t\t\tif (section === void 0) return;\n\t\t\t\tif (this.preference === section.preference && this.fontSize === section.fontSize) return;";
  if (source.includes(currentStaleAnchor)) return source.replace(currentStaleAnchor, `${currentStaleAnchor}\n${staleAdoptionGuard}`);
  const legacyStaleAnchor = "\t\t\t\tif (section === void 0 || this.preference === section.preference) return;";
  return replaceOnce(source, legacyStaleAnchor, `${legacyStaleAnchor}\n${staleAdoptionGuard}`, "theme stale adoption");
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
// The official 0.1.7 web-app declares the standard preset in this patch file.
// Keep desktop Computer Use inside its isolated group, not as a global service.
function patchStandardPreset(source) {
  if (source.includes("          - id: computer-use\n")) return source;
  const anchor = "          - id: tool-plugin-manager\n            name: '@deepseek-ai/dsh-plugin-manager/tools'\n            disabled: true";
  const addition = "          - id: computer-use\n            name: cordis:group\n            group: true\n            isolate:\n              computerUse: true\n            config:\n              - id: computer-use-service\n                name: '@deepseek-ai/dsh-computer-use'\n              - id: computer-use-cua-driver-native\n                name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'\n";
  return replaceOnce(source, anchor, addition + anchor, "standard preset Computer Use");
}

function patchStartupDiagnostics(source) {
  if (source.includes("structuredClone(allPatches(composed)), prepare);")) return source;
  const clock = "\tconst startupDiagnosticsStartedAt = process.env.DSH_STARTUP_DIAGNOSTICS ? Date.now() : 0;\n";
  source = source.replace(clock + "\tconst ctx = await boot(", "\tconst ctx = await boot(");
  if (!source.includes("[dsh-startup] profile begin")) {
    const syncCompose = "\tconst composed = composeProfile(options.profile, options.patchFiles);";
    const asyncCompose = "\tconst composed = await composeProfile(options.profile, options.patchFiles);";
    const legacyCompose = source.includes(asyncCompose) ? asyncCompose : source.includes(syncCompose) ? syncCompose : null;
    // The current compose call lives inside try; keep diagnostics in that scope.
    const compose17 = "\t\tconst composed = await composeProfile(options.profile, options.patchFiles, options.fromDefaultProfile, options.resolvedProfile);";
    const compose16 = "\t\tconst composed = await composeProfile(options.profile, options.patchFiles, resolutionMode, options.fromDefaultProfile, options.resolvedProfile);";
    const currentCompose = source.includes(compose17) ? compose17 : compose16;
    if (legacyCompose !== null) {
      const before = `async function runProfile(options) {\n${legacyCompose}`;
      const after = `async function runProfile(options) {
\tconst startupDiagnosticsStartedAt = process.env.DSH_STARTUP_DIAGNOSTICS ? Date.now() : 0;
\tif (startupDiagnosticsStartedAt) process.stderr.write("[dsh-startup] profile begin after 0ms\\n");
${legacyCompose}
\tif (startupDiagnosticsStartedAt) process.stderr.write(\`[dsh-startup] profile composed after \${Date.now() - startupDiagnosticsStartedAt}ms\\n\`);`;
      source = replaceOnce(source, before, after, "startup diagnostics phases");
    } else if (source.includes(currentCompose)) {
      const after = `\t\tconst startupDiagnosticsStartedAt = process.env.DSH_STARTUP_DIAGNOSTICS ? Date.now() : 0;
\t\tif (startupDiagnosticsStartedAt) process.stderr.write("[dsh-startup] profile begin after 0ms\\n");
${currentCompose}
\t\tif (startupDiagnosticsStartedAt) process.stderr.write(\`[dsh-startup] profile composed after \${Date.now() - startupDiagnosticsStartedAt}ms\\n\`);`;
      source = replaceOnce(source, currentCompose, after, "startup diagnostics phases");
    } else {
      throw new Error("startup diagnostics phases: upstream anchor changed");
    }
    source = replaceOnce(source, "\tapp.current = ctx;",
      "\tif (startupDiagnosticsStartedAt) process.stderr.write(`[dsh-startup] profile boot-resolved after ${Date.now() - startupDiagnosticsStartedAt}ms\\n`);\n\tapp.current = ctx;",
      "startup diagnostics boot resolution");
  }
  if (source.includes("[dsh-startup] fiber ")) return source;
  // 0.1.6 在 app.current = hostCtx 与 launch-environment 注入之间插入了
  // profileContext 注入，两行不再相邻，故直接锚到 provide 调用本身。
  const before = "\t\thostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);";
  const after = `\t\tif (startupDiagnosticsStartedAt) hostCtx.on("internal/status", (fiber) => {
\t\t\tif (fiber.state !== 2 && fiber.state !== 3) return;
\t\t\ttry {
\t\t\t\tconst state = fiber.state === 2 ? "active" : "failed";
\t\t\t\tconst rawName = fiber.entry?.options?.name ?? fiber.runtime?.callback?.name ?? "root";
\t\t\t\tconst name = String(rawName).replace(/[\\r\\n]+/g, " ");
\t\t\t\tprocess.stderr.write(\`[dsh-startup] fiber \${state} after \${Date.now() - startupDiagnosticsStartedAt}ms \${name}\\n\`);
\t\t\t} catch {}
\t\t}, { global: true });
\t\thostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);`;
  return replaceOnce(source, before, after, "startup diagnostics listener");
}

function patchCompileCacheFlush(source) {
  if (source.includes("[dsh-startup] compile cache flushed")) return source;
  const before = "\tapp.current = ctx;";
  const after = `\tapp.current = ctx;
\tif (process.env.NODE_COMPILE_CACHE) {
\t\ttry {
\t\t\tconst { flushCompileCache } = await import("node:module");
\t\t\tflushCompileCache();
\t\t\tprocess.stderr.write("[dsh-startup] compile cache flushed\\n");
\t\t} catch {}
\t}`;
  return replaceOnce(source, before, after, "compile cache flush");
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
  apply("standard-computer-use", path.join(modules, "@deepseek-ai", "dsh-web-app", "presets", "standard.patch.yml"), patchStandardPreset);
  const dshLib = path.join(modules, "@deepseek-ai", "dsh", "lib");
  if (fs.existsSync(dshLib)) {
    for (const name of fs.readdirSync(dshLib).filter((entry) => /^profile-boot-.+\.js$/.test(entry))) {
      const file = path.join(dshLib, name);
      const source = fs.readFileSync(file, "utf8");
      if (source.includes("\tapp.current = ctx;") || source.includes("[dsh-startup] compile cache flushed")) {
        apply("startup-diagnostics", file, patchStartupDiagnostics);
        apply("compile-cache-flush", file, patchCompileCacheFlush);
      }
    }
  }
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

module.exports = { patchHarnessRuntime, patchTheme, patchAquaSlotKey, patchStandardPreset, patchStartupDiagnostics, patchCompileCacheFlush, reconcileClientOnlyPlugins, dedupeAggregatedPluginEntries };
