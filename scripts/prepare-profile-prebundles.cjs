const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { externalizeExcept } = require("./prebundle-runtime-startup.cjs");

const PREBUNDLE_VERSION = 2;

function profileFingerprint(profileDir) {
  const hash = crypto.createHash("sha256");
  for (const name of ["package.json", "pnpm-lock.yaml"]) {
    hash.update(name);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(profileDir, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function packageRoot(profileDir, name) {
  return path.join(profileDir, "node_modules", ...name.split("/"));
}

function specsFor(profileDir) {
  const spec = (name, entry, outfile, format, patchManifest, buildOptions = {}) => ({
    name,
    root: packageRoot(profileDir, name),
    entry,
    outfile,
    format,
    patchManifest,
    buildOptions,
  });
  return [
    spec("undici", "index.js", "index.dsh-prebundle.cjs", "cjs",
      (manifest, target) => { manifest.main = target; }),
    spec("zod", "index.js", "index.dsh-prebundle.js", "esm",
      (manifest, target) => {
        manifest.module = target;
        manifest.exports["."].import = target;
      }),
    spec("zod", "index.cjs", "index.dsh-prebundle.cjs", "cjs",
      (manifest, target) => {
        manifest.main = target;
        manifest.exports["."].require = target;
      }),
    spec("yaml", "dist/index.js", "dist/index.dsh-prebundle.cjs", "cjs",
      (manifest, target) => {
        manifest.main = target;
        manifest.exports["."].node = target;
      }),
    spec("dshmarket", "lib/index.js", "lib/index.dsh-prebundle.js", "esm",
      (manifest, target) => {
        manifest.main = target;
        manifest.exports["."].default = target;
      }),
    spec("ws", "wrapper.mjs", "wrapper.dsh-prebundle.mjs", "esm",
      (manifest, target) => { manifest.exports["."].import = target; }, {
        banner: {
          js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
        },
      }),
    spec("ws", "index.js", "index.dsh-prebundle.cjs", "cjs",
      (manifest, target) => {
        manifest.main = target;
        manifest.exports["."].require = target;
      }),
  ];
}

function readMarker(markerPath) {
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function manifestTargets(specs) {
  const manifests = new Map();
  for (const spec of specs) {
    if (!manifests.has(spec.name)) {
      const manifestPath = path.join(spec.root, "package.json");
      manifests.set(spec.name, {
        path: manifestPath,
        source: fs.readFileSync(manifestPath, "utf8"),
        value: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      });
    }
    const target = `./${spec.outfile.replace(/\\/g, "/")}`;
    spec.patchManifest(manifests.get(spec.name).value, target);
  }
  return manifests;
}

function readyForReuse(specs, fingerprint, markerPath) {
  const marker = readMarker(markerPath);
  if (marker?.version !== PREBUNDLE_VERSION || marker.fingerprint !== fingerprint) return false;
  try {
    for (const spec of specs) {
      if (!fs.statSync(path.join(spec.root, spec.outfile)).isFile()) return false;
    }
    for (const name of new Set(specs.map((spec) => spec.name))) {
      const root = specs.find((spec) => spec.name === name).root;
      const current = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      if (current.dshDesktopProfilePrebundle?.fingerprint !== fingerprint) return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function prepareProfilePrebundles({ profileDir, runtimeRoot, stateDir, onLog = () => {} }) {
  const profileManifest = path.join(profileDir, "package.json");
  const profileLock = path.join(profileDir, "pnpm-lock.yaml");
  if (!fs.existsSync(profileManifest) || !fs.existsSync(profileLock)) {
    return { skipped: true, reason: "profile manifest or lock is missing" };
  }
  const started = performance.now();
  const fingerprint = profileFingerprint(profileDir);
  const markerPath = path.join(stateDir, "profile-prebundle.json");
  const specs = specsFor(profileDir);
  if (readyForReuse(specs, fingerprint, markerPath)) {
    return { skipped: false, reused: true, fingerprint, elapsedMs: Math.round(performance.now() - started) };
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const esbuild = require(path.join(runtimeRoot, "node_modules", "esbuild"));
  const manifests = manifestTargets(specs);
  const staging = [];
  try {
    for (const spec of specs) {
      const entry = path.join(spec.root, spec.entry);
      const outfile = path.join(spec.root, spec.outfile);
      const stage = `${outfile}.staging-${process.pid}`;
      fs.rmSync(stage, { force: true });
      await esbuild.build({
        entryPoints: [entry],
        outfile: stage,
        bundle: true,
        platform: "node",
        format: spec.format,
        target: "node24",
        sourcemap: false,
        legalComments: "none",
        logLevel: "warning",
        plugins: [externalizeExcept([])],
        ...spec.buildOptions,
      });
      staging.push({ stage, outfile });
    }
    for (const item of staging) {
      fs.rmSync(item.outfile, { force: true });
      fs.renameSync(item.stage, item.outfile);
    }
    for (const [name, item] of manifests) {
      item.value.dshDesktopProfilePrebundle = { version: PREBUNDLE_VERSION, fingerprint };
      writeJson(item.path, item.value);
      onLog(`profile prebundle manifest patched: ${name}`);
    }
    writeJson(markerPath, {
      version: PREBUNDLE_VERSION,
      fingerprint,
      outputs: specs.map((spec) => `${spec.name}/${spec.outfile.replace(/\\/g, "/")}`),
    });
  } catch (error) {
    for (const item of staging) fs.rmSync(item.stage, { force: true });
    for (const item of manifests.values()) {
      try { fs.writeFileSync(item.path, item.source, "utf8"); } catch (_restoreError) {}
    }
    throw error;
  }
  return {
    skipped: false,
    reused: false,
    fingerprint,
    outputs: specs.length,
    elapsedMs: Math.round(performance.now() - started),
  };
}

if (require.main === module) {
  const [profileDir, runtimeRoot, stateDir] = process.argv.slice(2);
  if (!profileDir || !runtimeRoot || !stateDir) {
    throw new Error("usage: node prepare-profile-prebundles.cjs <profile-dir> <runtime-root> <state-dir>");
  }
  prepareProfilePrebundles({
    profileDir: path.resolve(profileDir),
    runtimeRoot: path.resolve(runtimeRoot),
    stateDir: path.resolve(stateDir),
    onLog: (message) => process.stdout.write(`${message}\n`),
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { PREBUNDLE_VERSION, prepareProfilePrebundles, profileFingerprint };
