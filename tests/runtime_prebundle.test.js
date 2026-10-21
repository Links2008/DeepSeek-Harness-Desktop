const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const { otelPrebundleSpecs, buildEntry } = require("../scripts/prebundle-runtime-startup.cjs");
const { summarizeModules } = require("../scripts/compile-cache-diagnostics.cjs");

function writePackage(modules, name, manifest = {}, source = "exports.value = 1;\n") {
  const dir = path.join(modules, ...name.split("/"));
  fs.mkdirSync(path.join(dir, "build", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name, version: "1.0.0", main: "build/src/index.js", ...manifest,
  }));
  fs.writeFileSync(path.join(dir, "build", "src", "index.js"), source);
  return dir;
}

(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-otel-prebundle-"));
  try {
    const modules = path.join(fixture, "node_modules");
    assert.deepEqual(otelPrebundleSpecs(modules), [], "older runtimes need no new OTel packages");
    const shared = writePackage(modules, "host-service", {}, "exports.service = {};\n");
    const root = writePackage(modules, "@opentelemetry/resources", {
      exports: {
        ".": { types: "./build/src/index.d.ts", default: "./build/src/index.js" },
        "./package.json": "./package.json",
      },
    }, "const { service } = require('host-service'); exports.service = service; exports.value = require('./leaf.js');\n");
    fs.writeFileSync(path.join(root, "build", "src", "leaf.js"), "module.exports = 42;\n");
    const parent = writePackage(modules, "some-parent");
    const nested = writePackage(path.join(parent, "node_modules"), "@opentelemetry/resources");
    const scopedParent = writePackage(modules, "@vendor/parent");
    const nestedCore = writePackage(path.join(scopedParent, "node_modules"), "@opentelemetry/core");
    const untouched = writePackage(modules, "@opentelemetry/unreviewed-package");
    const untouchedManifest = fs.readFileSync(path.join(untouched, "package.json"), "utf8");
    const api = writePackage(modules, "@opentelemetry/api", {
      exports: { ".": "./build/src/index.js", "./experimental": "./experimental.js" },
    }, "exports.api = {};\n");
    fs.writeFileSync(path.join(api, "experimental.js"), "module.exports = require('./build/src/index.js');\n");
    const apiManifest = fs.readFileSync(path.join(api, "package.json"), "utf8");
    const exporter = writePackage(modules, "@opentelemetry/otlp-exporter-base");
    const exporterManifest = fs.readFileSync(path.join(exporter, "package.json"), "utf8");
    const got = path.join(modules, "got");
    fs.mkdirSync(path.join(got, "dist", "source"), { recursive: true });
    fs.writeFileSync(path.join(got, "package.json"), JSON.stringify({
      name: "got", type: "module",
      exports: { types: "./dist/source/index.d.ts", default: "./dist/source/index.js" },
    }));
    fs.writeFileSync(path.join(got, "dist", "source", "index.js"),
      "export { value } from './leaf.js'; export { service } from 'host-service'; export default function got() {}\n");
    fs.writeFileSync(path.join(got, "dist", "source", "leaf.js"), "export const value = 7;\n");
    const specs = otelPrebundleSpecs(modules);
    assert.deepEqual(specs.map((spec) => spec.packageDir).sort(), [root, nested, nestedCore, got].sort(),
      "each physical leaf copy, including nested scoped packages, must be bundled independently");
    for (const spec of specs) {
      assert.equal(spec.format, spec.name === "got" ? "esm" : "cjs");
      assert.deepEqual(spec.bundle ?? [], [], "host and OTel package boundaries must stay external");
      await buildEntry(esbuild, spec);
    }
    const firstBuild = fs.readFileSync(path.join(root, specs.find((spec) => spec.packageDir === root).outfile), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(manifest.exports["."].default, manifest.main);
    assert.equal(manifest.exports["."].types, "./build/src/index.d.ts");
    assert.equal(manifest.exports["./package.json"], "./package.json");
    assert.equal(manifest.dshDesktopPrebundle.source, "./build/src/index.js");
    assert.equal(fs.readFileSync(path.join(untouched, "package.json"), "utf8"), untouchedManifest,
      "unreviewed packages must remain untouched");
    // Rebuilding must read the original source, not recursively bundle the generated file.
    for (const spec of otelPrebundleSpecs(modules)) await buildEntry(esbuild, spec);
    assert.equal(fs.readFileSync(path.join(root, manifest.main), "utf8"), firstBuild);
    const requireFixture = createRequire(path.join(fixture, "package.json"));
    const bundled = requireFixture("@opentelemetry/resources");
    assert.equal(bundled.value, 42);
    assert.equal(bundled.service, requireFixture("host-service").service,
      "external service identity must survive bundling");
    const esm = await import(pathToFileURL(path.join(root, manifest.main)).href);
    assert.equal(esm.value, 42, "ESM consumers must retain CJS named exports");
    assert.equal(esm.service, bundled.service);
    assert.notEqual(createRequire(path.join(parent, "package.json"))("@opentelemetry/resources"), bundled,
      "different installed versions/copies must not be deduplicated across parent packages");
    assert.equal(fs.readFileSync(path.join(api, "package.json"), "utf8"), apiManifest,
      "the public API package must remain untouched");
    assert.equal(requireFixture("@opentelemetry/api/experimental"), requireFixture("@opentelemetry/api"),
      "public experimental imports must retain the original API module identity");
    assert.equal(fs.readFileSync(path.join(exporter, "package.json"), "utf8"), exporterManifest,
      "exporter-base must retain its shared public-subpath modules");
    const gotManifest = JSON.parse(fs.readFileSync(path.join(got, "package.json"), "utf8"));
    assert.equal(gotManifest.exports.types, "./dist/source/index.d.ts");
    const gotModule = await import(pathToFileURL(path.join(got, gotManifest.exports.default)).href);
    assert.equal(typeof gotModule.default, "function");
    assert.equal(gotModule.value, 7);
    assert.equal(gotModule.service, bundled.service);
    const cjsSpec = specs.find((spec) => spec.packageDir === root);
    assert.throws(() => cjsSpec.patch({ name: cjsSpec.name, main: "other-entry.js" }, "./out.cjs"),
      /unsupported startup leaf exports/, "unexpected package layouts must not be silently rewritten");
    assert.throws(() => cjsSpec.patch({
      name: cjsSpec.name, main: "build/src/index.js",
      exports: { ".": { default: "./build/src/index.js" }, "./experimental": "./experimental.js" },
    }, "./out.cjs"), /unsupported startup leaf exports/,
    "a new public subpath needs review before sharing its private modules with a root bundle");
    assert.throws(() => specs.find((spec) => spec.name === "got").patch({
      name: "got", type: "module", exports: { ".": { default: "./dist/source/index.js" } },
    }, "./out.js"), /unsupported startup leaf exports/);
    assert.ok(fs.existsSync(path.join(shared, "build", "src", "index.js")));
    const diagnosticDir = path.join(modules, "diagnostic-fixture");
    fs.mkdirSync(diagnosticDir);
    const cjsFile = path.join(diagnosticDir, "dependency.cjs");
    const esmFile = path.join(diagnosticDir, "entry.mjs");
    fs.writeFileSync(cjsFile, "module.exports.value = 1;\n");
    fs.writeFileSync(esmFile, "import dependency from './dependency.cjs'; export const value = dependency.value;\n");
    assert.deepEqual(summarizeModules([cjsFile, pathToFileURL(cjsFile).href, esmFile, "node:fs"]), {
      modules: 2, packages: [{ name: "diagnostic-fixture", files: 2 }],
    }, "诊断必须去重 CJS/ESM 引用，且只保留包名和计数");
    const preloadDir = path.join(fixture, "diagnostic preload");
    fs.mkdirSync(preloadDir);
    const preloadFile = path.join(preloadDir, "compile-cache-diagnostics.cjs");
    fs.copyFileSync(path.resolve(__dirname, "../scripts/compile-cache-diagnostics.cjs"), preloadFile);
    const nodeOptions = require(preloadFile).diagnosticNodeOptions("--no-warnings");
    assert.ok(nodeOptions.startsWith("--no-warnings "), "诊断预加载必须保留已有 Node 启动选项");
    const cacheDir = path.join(fixture, "diagnostic-cache");
    const child = spawnSync(process.execPath, [
      "--expose-internals",
      "--input-type=module", "--eval",
      `await import(${JSON.stringify(pathToFileURL(esmFile).href)}); process.stderr.write('[dsh-startup] compile cache flushed\\n');`,
    ], {
      encoding: "utf8",
      env: { ...process.env, DSH_PREWARM_DIAGNOSTICS: "1", NODE_OPTIONS: nodeOptions, NODE_COMPILE_CACHE: cacheDir, NODE_COMPILE_CACHE_PORTABLE: "1" },
    });
    assert.equal(child.status, 0, child.stderr);
    const inventory = JSON.parse(child.stderr.match(/\[dsh-prewarm\] module inventory (.+)/)[1]);
    assert.equal(inventory.esmAvailable, true, "诊断必须覆盖实际 ESM 加载缓存");
    assert.deepEqual(inventory.packages.find((entry) => entry.name === "diagnostic-fixture"), {
      name: "diagnostic-fixture", files: 2,
    });
    assert.ok(child.stderr.indexOf("module inventory") < child.stderr.indexOf("[dsh-startup] compile cache flushed"),
      "预热父进程观察到刷新标记前必须已收到模块清单");
    assert.equal(child.stderr.includes(fixture), false, "诊断日志不得暴露绝对路径");
    assert.ok(fs.readdirSync(cacheDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length >= 2,
      "读取加载清单不得使 Node 编译缓存失效");
    console.log("runtime OTel leaf prebundles preserve exports and package identity");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
