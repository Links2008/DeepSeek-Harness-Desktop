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
  source = replaceOnce(source, "\t\t\t\tconst hasFiles = (event) => event.dataTransfer?.types.includes(\"Files\") ?? false;", "\t\t\t\tconst hasFiles = (event) => event.dataTransfer?.types.includes(\"Files\") ?? false;\n\t\t\t\tconst onImageFiles = (event) => {\n\t\t\t\t\tconst files = event.detail?.files;\n\t\t\t\t\tif (!canAcceptDrop || !Array.isArray(files) || files.length === 0) return;\n\t\t\t\t\tintakeImages(files);\n\t\t\t\t};", "conversation image bridge");
  source = replaceOnce(source, "\t\t\t\tdocument.addEventListener(\"dragenter\", onDragEnter);", "\t\t\t\tdocument.addEventListener(\"dsh:image-files\", onImageFiles);\n\t\t\t\tdocument.addEventListener(\"dragenter\", onDragEnter);", "conversation bridge listener");
  return replaceOnce(source, "\t\t\t\t\tdocument.removeEventListener(\"dragenter\", onDragEnter);", "\t\t\t\t\tdocument.removeEventListener(\"dsh:image-files\", onImageFiles);\n\t\t\t\t\tdocument.removeEventListener(\"dragenter\", onDragEnter);", "conversation bridge cleanup");
}

function patchAion(source) {
  source = source.replace("\t\t\t\t\t\tconst actx = sessions.scope(sessionId);\n\t\t\t\t\t\tconst root = actx?.session?.cwd ?? ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;", "\t\t\t\t\t\tconst root = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;");
  source = replaceOnce(source, "\t\tconst FILE_DRAG_MIME = \"application/x-dsh-file\";", `\t\tconst FILE_DRAG_MIME = "application/x-dsh-file";
\t\tfunction dispatchImageFiles(dataUrl, path) {
\t\t\tconst comma = dataUrl.indexOf(",");
\t\t\tif (comma < 0) return false;
\t\t\tconst meta = dataUrl.slice(0, comma);
\t\t\tconst mime = /^data:([^;]+)/.exec(meta)?.[1] ?? "application/octet-stream";
\t\t\tconst binary = atob(dataUrl.slice(comma + 1));
\t\t\tconst bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
\t\t\tconst blob = new Blob([bytes], { type: mime });
\t\t\tconst file = new File([blob], path.split("/").pop() ?? "image", { type: mime });
\t\t\tdocument.dispatchEvent(new CustomEvent("dsh:image-files", { detail: { files: [file] } }));
\t\t\treturn true;
\t\t}`, "Aion image bridge helper");
  source = replaceOnce(source, "\t\t\t\t\tif (path !== \"\") props.insertPath(path);", "\t\t\t\t\tif (path !== \"\" && detectContentType(path) === \"image\" && props.insertImage !== void 0) void props.insertImage(path);\n\t\t\t\t\telse if (path !== \"\") props.insertPath(path);", "Aion image drop routing");
  return replaceOnce(source, "\t\t\t\t\tinject: (sessionId) => ({ insertPath: (path) => {", "\t\t\t\t\tinject: (sessionId) => ({ insertImage: async (path) => {\n\t\t\t\t\t\tif (sessionId === void 0) return false;\n\t\t\t\t\t\tconst root = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;\n\t\t\t\t\t\tif (typeof root !== \"string\" || root === \"\") return false;\n\t\t\t\t\t\tconst result = await new PanelApi().read(root, path, true);\n\t\t\t\t\t\treturn result.ok && typeof result.value.content === \"string\" ? dispatchImageFiles(result.value.content, path) : false;\n\t\t\t\t\t}, insertPath: (path) => {", "Aion image loader");
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

function patchHarnessRuntime(runtimeRoot, profileDir) {
  const modules = path.join(runtimeRoot, "node_modules");
  const changed = [];
  const apply = (label, file, transform) => { if (patchFile(file, transform)) changed.push(label); };
  apply("theme", path.join(modules, "@deepseek-ai", "dsh-client-ui-theme", "lib", "client.js"), patchTheme);
  apply("compaction", path.join(modules, "@deepseek-ai", "dsh-compaction-basic", "lib", "index.js"), patchCompaction);
  apply("conversation", path.join(modules, "@deepseek-ai", "dsh-client-ui-conversation", "lib", "client.js"), patchConversation);
  apply("minimal-compaction", path.join(modules, "@deepseek-ai", "dsh", "config", "agent-presets", "minimal", "agent.cordis.yml"), patchMinimalPreset);
  if (profileDir) {
    apply("aion-image-drop", path.join(profileDir, "node_modules", "@linxin666", "dsh-client-ui-aionui-panel", "lib", "client.js"), patchAion);
    changed.push(...reconcileClientOnlyPlugins(profileDir).map((name) => `activate:${name}`));
  }
  return changed;
}

if (require.main === module) {
  const [runtimeRoot, profileDir] = process.argv.slice(2);
  if (!runtimeRoot) throw new Error("usage: node patch-harness-runtime.cjs <runtime-root> [profile-dir]");
  process.stdout.write(`${patchHarnessRuntime(path.resolve(runtimeRoot), profileDir && path.resolve(profileDir)).join(",") || "already-patched"}\n`);
}

module.exports = { patchHarnessRuntime, patchTheme, patchCompaction, patchConversation, patchAion, patchMinimalPreset, reconcileClientOnlyPlugins };
