const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "bundle", "dsh-runtime");
const modules = path.join(runtimeRoot, "node_modules");

const otelLeaves = new Set([
  "@opentelemetry/api-logs",
  "@opentelemetry/core",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/otlp-transformer",
  "@opentelemetry/sdk-logs",
]);
// Keep api and otlp-exporter-base untouched: their public subpaths import
// shared private modules and must retain the same instances as their roots.

function packageRoot(name) {
  return path.join(modules, ...name.split("/"));
}

function externalizeExcept(allowed) {
  return {
    name: "externalize-except",
    setup(build) {
      build.onResolve({ filter: /^[^.\/]|^@/ }, (args) => {
        if (args.kind === "entry-point" || path.isAbsolute(args.path)) return null;
        const bundled = allowed.some((name) => args.path === name || args.path.startsWith(`${name}/`));
        return bundled ? null : { path: args.path, external: true };
      });
    },
  };
}

function preserveRelativeDynamicImports() {
  return {
    name: "preserve-relative-dynamic-imports",
    setup(build) {
      build.onResolve({ filter: /^\./ }, (args) => {
        if (args.kind === "dynamic-import") return { path: args.path, external: true };
        return null;
      });
    },
  };
}

async function buildEntry(esbuild, spec) {
  const dir = spec.packageDir ?? packageRoot(spec.name);
  const manifestPath = path.join(dir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entry = path.join(dir, spec.entry);
  const outfile = path.join(dir, spec.outfile);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: spec.format,
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    plugins: [
      externalizeExcept(spec.bundle ?? []),
      ...(spec.preserveDynamicImports ? [preserveRelativeDynamicImports()] : []),
    ],
  });
  spec.patch(manifest, `./${spec.outfile.replace(/\\/g, "/")}`);
  manifest.dshDesktopPrebundle = { version: 1, source: `./${spec.entry.replace(/\\/g, "/")}` };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { name: spec.name, bytes: fs.statSync(outfile).size };
}

function otelPrebundleSpecs(modulesRoot = modules) {
  const specs = [];
  function visitModules(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const candidate = path.join(dir, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of fs.readdirSync(candidate, { withFileTypes: true })) {
          if (scoped.isDirectory()) visitPackage(path.join(candidate, scoped.name));
        }
      } else {
        visitPackage(candidate);
      }
    }
  }
  function visitPackage(dir) {
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (otelLeaves.has(manifest.name)) {
      specs.push({
        name: manifest.name, packageDir: dir,
        entry: "build/src/index.js", outfile: "build/src/index.dsh-prebundle.cjs", format: "cjs",
        patch(manifest, target) {
          const main = manifest.main?.replace(/^\.\//, "");
          const rootExport = manifest.exports?.["."];
          if (!["build/src/index.js", "build/src/index.dsh-prebundle.cjs"].includes(main) ||
              (manifest.exports && (!rootExport || typeof rootExport.default !== "string" ||
                Object.keys(manifest.exports).some((key) => key !== "." && key !== "./package.json") ||
                Object.keys(rootExport).some((key) => key !== "types" && key !== "default")))) {
            throw new Error(`unsupported startup leaf exports: ${manifest.name}`);
          }
          manifest.main = target;
          if (rootExport) rootExport.default = target;
        },
      });
    } else if (manifest.name === "got") {
      specs.push({
        name: manifest.name, packageDir: dir,
        entry: "dist/source/index.js", outfile: "dist/source/index.dsh-prebundle.js", format: "esm",
        patch(manifest, target) {
          if (manifest.type !== "module" || typeof manifest.exports?.default !== "string" ||
              Object.keys(manifest.exports).some((key) => key !== "types" && key !== "default")) {
            throw new Error(`unsupported startup leaf exports: ${manifest.name}`);
          }
          manifest.exports.default = target;
        },
      });
    }
    visitModules(path.join(dir, "node_modules"));
  }
  visitModules(modulesRoot);
  return specs;
}

async function prebundleRuntime() {
  const esbuild = require("esbuild");
  // The upstream profile fallback walks the CLI's dependency closure, not every
  // package present in node_modules. Register the desktop-shipped store there.
  const cliManifestPath = path.join(packageRoot('@deepseek-ai/dsh'), 'package.json');
  const cliManifest = JSON.parse(fs.readFileSync(cliManifestPath, 'utf8'));
  const store = JSON.parse(fs.readFileSync(path.join(packageRoot('dshmarket'), 'package.json'), 'utf8'));
  cliManifest.dependencies = { ...cliManifest.dependencies, dshmarket: store.version };
  fs.writeFileSync(cliManifestPath, JSON.stringify(cliManifest, null, 2) + '\n', 'utf8');
  const piAiDir = packageRoot("@earendil-works/pi-ai");
  const piAiManifestPath = path.join(piAiDir, "package.json");
  const piAiManifest = JSON.parse(fs.readFileSync(piAiManifestPath, "utf8"));
  for (const [exportPath, generated] of [
    ["./providers/all", "dist/providers/all.dsh-prebundle.js"],
    ["./api/anthropic-messages.lazy", "dist/api/anthropic-messages.lazy.dsh-prebundle.js"],
    ["./api/openai-completions.lazy", "dist/api/openai-completions.lazy.dsh-prebundle.js"],
    ["./api/openai-responses.lazy", "dist/api/openai-responses.lazy.dsh-prebundle.js"],
  ]) {
    if (piAiManifest.exports[exportPath]?.import?.endsWith(".dsh-prebundle.js")) {
      delete piAiManifest.exports[exportPath];
    }
    fs.rmSync(path.join(piAiDir, generated), { force: true });
  }
  fs.writeFileSync(piAiManifestPath, JSON.stringify(piAiManifest, null, 2) + "\n", "utf8");
  const specs = [
    {
      name: 'undici', entry: 'index.js', outfile: 'index.dsh-prebundle.cjs', format: 'cjs',
      patch(manifest, target) { manifest.main = target; },
    },
    {
      name: 'dshmarket', entry: 'lib/index.js', outfile: 'lib/index.dsh-prebundle.js', format: 'esm',
      patch(manifest, target) { manifest.main = target; manifest.exports['.'].default = target; },
    },
    {
      name: "@earendil-works/pi-ai",
      entry: "dist/index.js",
      outfile: "dist/index.dsh-prebundle.js",
      format: "esm",
      bundle: ["typebox"],
      patch(manifest, target) {
        manifest.main = target;
        manifest.exports["."].import = target;
      },
    },
    {
      name: "@earendil-works/pi-ai",
      entry: "dist/providers/all.js",
      outfile: "dist/providers/all.dsh-prebundle.js",
      format: "esm",
      bundle: ["typebox"],
      preserveDynamicImports: true,
      patch(manifest, target) {
        manifest.exports["./providers/all"] = {
          types: "./dist/providers/all.d.ts",
          import: target,
        };
      },
    },
    {
      name: "zod",
      entry: "index.js",
      outfile: "index.dsh-prebundle.js",
      format: "esm",
      patch(manifest, target) {
        manifest.module = target;
        manifest.exports["."].import = target;
      },
    },
    {
      name: "yaml",
      entry: "dist/index.js",
      outfile: "dist/index.dsh-prebundle.cjs",
      format: "cjs",
      patch(manifest, target) {
        manifest.main = target;
        manifest.exports["."].node = target;
      },
    },
    {
      name: "semver",
      entry: "index.js",
      outfile: "index.dsh-prebundle.cjs",
      format: "cjs",
      patch(manifest, target) {
        manifest.main = target;
      },
    },
  ];
  // The shared OTel service added in Harness 0.2 loads these CJS leaf trees
  // even when Session telemetry is disabled. Collapse each physical copy's
  // internal files while leaving its external dependencies and service API intact.
  specs.push(...otelPrebundleSpecs());
  const results = [];
  for (const spec of specs) results.push(await buildEntry(esbuild, spec));
  return results;
}

if (require.main === module) {
  prebundleRuntime().then((results) => {
    process.stdout.write(`startup prebundles: ${results.map((item) => `${item.name}=${item.bytes}`).join(", ")}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { prebundleRuntime, externalizeExcept, preserveRelativeDynamicImports, otelPrebundleSpecs, buildEntry };
