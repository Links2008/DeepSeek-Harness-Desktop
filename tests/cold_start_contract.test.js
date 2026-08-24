const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const loading = fs.readFileSync(path.join(root, "loading.html"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const packageJson = require(path.join(root, "package.json"));
const patcher = require(path.join(root, "scripts", "patch-harness-runtime.cjs"));
const compileCache = require(path.join(root, "scripts", "prepare-compile-cache.cjs"));
const prebundle = require(path.join(root, "scripts", "prebundle-runtime-startup.cjs"));
const profilePrebundle = require(path.join(root, "scripts", "prepare-profile-prebundles.cjs"));
const prebundleSource = fs.readFileSync(
  path.join(root, "scripts", "prebundle-runtime-startup.cjs"), "utf8");
const prewarmSource = fs.readFileSync(
  path.join(root, "scripts", "prewarm-node-compile-cache.cjs"), "utf8");
const profilePrebundleSource = fs.readFileSync(
  path.join(root, "scripts", "prepare-profile-prebundles.cjs"), "utf8");

assert.match(main, /NODE_COMPILE_CACHE/, "backend must enable Node's persistent module compile cache");
assert.match(main, /NODE_COMPILE_CACHE_PORTABLE/, "cache must remain usable across packaged runtime path changes");
assert.match(main, /DSH_TELEMETRY_DISABLED:\s*"1"/,
  "the desktop must not import the disabled telemetry stack during startup");
assert.match(main, /env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.backend\.env\s*\}/s,
  "backend spawn must inherit the cache environment without dropping the user environment");
assert.match(main, /app\.getPath\("userData"\)/,
  "the compile cache must live under durable user data rather than the disposable temp directory");
assert.match(main, /dsh web:\\s\*http/,
  "renderer reveal must observe the backend's explicit service-ready announcement");
assert.match(main, /compile cache flushed/,
  "renderer reveal must observe the post-plugin-tree startup settlement signal");
assert.match(main, /backendAnnouncedReady\s*&&\s*backendStartupSettled\s*&&\s*await portOpen\(3080\)/,
  "a listening socket or HTTP announcement alone must not reveal a half-initialized plugin UI");
assert.match(main, /async function transitionToBackend\(\)/,
  "the startup surface must own a bounded handoff instead of hard-cutting to the backend");
assert.match(main, /startupView\s*=\s*new WebContentsView/,
  "the startup surface must remain in an independent overlay while the backend document renders");
assert.match(main, /startupView\.setBackgroundColor\(["']#00000000["']\)/,
  "the startup overlay must reveal the rendered backend while its body fades");
assert.match(main, /contentView\.addChildView\(startupView\)/,
  "the startup overlay must be attached above the backend document");
assert.match(main, /function createWindow\(\)[\s\S]*backgroundThrottling:\s*false/,
  "the backend renderer must keep painting while it is covered by the startup view");
assert.match(main, /async function transitionToBackend\(\)[\s\S]*mainWindow\.loadURL\(URL\)[\s\S]*waitForBackendPaint[\s\S]*dshBeginStartupExit/,
  "the backend must finish loading behind the startup overlay before the overlay exits");
assert.match(main, /revealBackendEntry\(\);\s*let paintFallbackTimer/,
  "the renderer entry effect must not synchronously block the main-process handoff");
assert.match(main,
  /Promise\.race\(\[\s*waitForBackendPaint\(\),[\s\S]*paintFallbackTimer\s*=\s*setTimeout\([\s\S]*1600\)/,
  "a renderer that cannot run the paint probe must still release the overlay from the main process");
assert.doesNotMatch(main, /await mainWindow\.loadURL\(URL\)/,
  "a long-lived web document must not keep the startup overlay waiting on loadURL completion");
assert.match(main, /backendPagePreparedResolve/,
  "the startup handoff must wait for the shell's own DOM and injection readiness signal");
assert.match(main,
  /webContents\.on\("dom-ready"[\s\S]*if \(backendDocument\)[\s\S]*backendPagePreparedResolve\(\)[\s\S]*injectWindowChrome\(\)/,
  "DOM readiness must release the startup handoff before non-critical UI injections can block it");
assert.match(main, /const hasEditor\s*=\s*Boolean\(/,
  "paint readiness must observe the interactive composer instead of an arbitrary text-length threshold");
assert.match(main, /performance\.now\(\)\s*\+\s*1500/,
  "paint readiness must keep a short bounded fallback instead of adding three seconds to every handoff");
assert.match(main, /backend paint-ready/,
  "installed-runtime logs must distinguish a real paint-ready hit from the fallback deadline");
assert.match(main, /contentView\.removeChildView\(completedView\)/,
  "the startup overlay must be removed after a successful handoff");
assert.match(main, /Promise\.race\([\s\S]*setTimeout/,
  "a renderer transition failure must not block the backend UI indefinitely");
assert.match(loading, /window\.dshBeginStartupExit\s*=\s*\(\)\s*=>/,
  "the local startup page must expose its completion transition to the desktop shell");
assert.match(loading, /classList\.add\(["']is-exiting["']\)/,
  "the startup page must enter a dedicated exit state");
assert.match(loading, /classList\.add\(["']is-complete["']\)/,
  "the startup page must expose a visible completion beat before exiting");
assert.match(loading, /completionHoldMs\s*=\s*reducedMotion\s*\?\s*0\s*:\s*180/,
  "the normal-motion handoff must keep the completed state visible long enough to perceive");
assert.match(loading, /body\.is-complete\s+\.spinner::after/,
  "the completed state must replace the busy spinner with a success mark");
assert.match(loading, /transition:\s*opacity\s+\d+ms[^;]*,\s*transform\s+\d+ms/i,
  "the startup handoff must animate only composited opacity and transform properties");
assert.match(loading, /prefers-reduced-motion:\s*reduce/,
  "the startup exit must honor reduced-motion preferences");
assert.match(preload, /webFrame\.insertCSS/,
  "the backend entry state must be installed before its first rendered frame");
assert.match(preload, /dsh-startup-entered/,
  "the backend page must receive a bounded entry state");
assert.match(preload, /prefers-reduced-motion:\s*reduce/,
  "the backend entry must honor reduced-motion preferences");
assert.match(builder, /from:\s*bundle\/node-compile-cache[\s\S]*to:\s*node-compile-cache(?:\s|$)/,
  "the installer must preserve the cache/runtime sibling topology used during prewarm");
assert.match(builder, /scripts\/prepare-profile-prebundles\.cjs/,
  "the packaged main process must include its profile prebundle dependency");
assert.match(builder, /scripts\/prebundle-runtime-startup\.cjs/,
  "the packaged profile prebundler must include its externalization helper");
assert.match(packageJson.scripts["prebuild:installer"], /prewarm-node-compile-cache\.cjs/,
  "installer builds must regenerate the portable cache seed automatically");
assert.equal(typeof compileCache.prepareCompileCache, "function",
  "the cache seeding helper must be independently regression-testable");
assert.equal(typeof prebundle.prebundleRuntime, "function",
  "the runtime leaf prebundler must be independently callable by the build prewarm step");
assert.equal(typeof profilePrebundle.prepareProfilePrebundles, "function",
  "profile dependencies must have a fingerprinted one-time prebundle path");
assert.match(main, /prepareProfilePrebundles/,
  "desktop startup must prepare profile prebundles before spawning the backend");
assert.match(profilePrebundleSource, /createRequire[\s\S]*import\.meta\.url/,
  "the ESM ws bundle must retain a working CommonJS require for Node built-ins");
assert.ok(prebundleSource.includes('entry: "dist/providers/all.js"'),
  "pi-ai's static provider catalog must be collapsed into one startup file");
assert.match(prebundleSource, /args\.kind\s*===\s*"dynamic-import"[\s\S]*external:\s*true/,
  "provider API dynamic imports must remain external and lazy during catalog bundling");
assert.match(prewarmSource, /files\s*>\s*500/,
  "installer builds must fail when the core startup graph regresses above its bounded ceiling");
for (const entry of [
  "dist/api/anthropic-messages.lazy.js",
  "dist/api/openai-completions.lazy.js",
  "dist/api/openai-responses.lazy.js",
]) {
  assert.ok(!prebundleSource.includes(`entry: "${entry}"`),
    `${entry} must preserve its import boundary instead of eagerly loading provider SDKs`);
}

const cacheFixture = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cache-contract-"));
try {
  const userData = path.join(cacheFixture, "user-data");
  const resources = path.join(cacheFixture, "resources");
  const first = compileCache.prepareCompileCache(userData, resources);
  assert.equal(first.error, null);
  assert.equal(first.packaged, true);
  assert.equal(first.dir, path.join(resources, "node-compile-cache"));

  const blockedResources = path.join(cacheFixture, "resources-file");
  fs.writeFileSync(blockedResources, "not a directory");
  const fallback = compileCache.prepareCompileCache(userData, blockedResources);
  assert.equal(fallback.packaged, false);
  assert.ok(fallback.error instanceof Error);
  assert.equal(fallback.dir, path.join(userData, "node-compile-cache"));
} finally {
  fs.rmSync(cacheFixture, { recursive: true, force: true });
}

const profileFixture = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-profile-fingerprint-"));
try {
  fs.writeFileSync(path.join(profileFixture, "package.json"), "{}\n");
  fs.writeFileSync(path.join(profileFixture, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const first = profilePrebundle.profileFingerprint(profileFixture);
  fs.appendFileSync(path.join(profileFixture, "pnpm-lock.yaml"), "packages: {}\n");
  assert.notEqual(profilePrebundle.profileFingerprint(profileFixture), first,
    "a profile dependency update must invalidate its prebundle marker");
} finally {
  fs.rmSync(profileFixture, { recursive: true, force: true });
}

assert.equal(typeof patcher.patchCompileCacheFlush, "function",
  "runtime patcher must expose the compile-cache flush transform for regression testing");
const profileBoot = [
  "\tconst ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), prepare);",
  "\tapp.current = ctx;",
  "\tif (!signalShutdown.signal.aborted) watch();",
].join("\n");
const patched = patcher.patchCompileCacheFlush(profileBoot);
assert.match(patched, /flushCompileCache/,
  "profile boot must flush accumulated bytecode after the plugin tree settles");
assert.equal(patcher.patchCompileCacheFlush(patched), patched,
  "compile-cache flush patch must be idempotent");

const installedProfileBoot = [
  "\tapp.current = ctx;",
  "\tif (process.env.NODE_COMPILE_CACHE) {",
  "\t\ttry {",
  "\t\t\tconst { flushCompileCache } = await import(\"node:module\");",
  "\t\t\tflushCompileCache();",
  "\t\t\tprocess.stderr.write(\"[dsh-startup] compile cache flushed\\n\");",
  "\t\t} catch {}",
  "\t}",
  "\tif (!signalShutdown.signal.aborted && ctx.fiber.state === 2) watch();",
].join("\n");
assert.equal(patcher.patchCompileCacheFlush(installedProfileBoot), installedProfileBoot,
  "the installed profile-boot form must remain unchanged on a second compatibility pass");

const runtimeFixture = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-runtime-contract-"));
try {
  const dshLib = path.join(runtimeFixture, "node_modules", "@deepseek-ai", "dsh", "lib");
  fs.mkdirSync(dshLib, { recursive: true });
  fs.writeFileSync(path.join(dshLib, "profile-boot-wrapper.js"),
    "export { runProfile } from './profile-boot-implementation.js';\n");
  const implementation = path.join(dshLib, "profile-boot-implementation.js");
  fs.writeFileSync(implementation, profileBoot);
  const failures = [];
  patcher.patchHarnessRuntime(runtimeFixture, null, { onFailure: (message) => failures.push(message) });
  assert.deepEqual(failures, [], "forwarding profile-boot chunks must not be reported as anchor drift");
  assert.match(fs.readFileSync(implementation, "utf8"), /compile cache flushed/);
} finally {
  fs.rmSync(runtimeFixture, { recursive: true, force: true });
}

console.log("cold start contract verified");
