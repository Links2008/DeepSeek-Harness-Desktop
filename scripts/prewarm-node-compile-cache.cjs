const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { patchHarnessRuntime } = require("./patch-harness-runtime.cjs");
const { prebundleRuntime } = require("./prebundle-runtime-startup.cjs");
const electron = require("electron");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "bundle", "dsh-runtime");
const cli = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const seed = path.join(root, "bundle", "node-compile-cache");
const stage = `${seed}.staging-${process.pid}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function countFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
}

async function main() {
  if (!fs.existsSync(electron) || !fs.existsSync(cli)) {
    throw new Error("build Electron or bundled DSH runtime is missing");
  }
  const prebundles = await prebundleRuntime();
  process.stdout.write(`startup prebundles ready: ${prebundles.length}\n`);
  const failures = [];
  patchHarnessRuntime(runtimeRoot, null, { onFailure: (message) => failures.push(message) });
  const cacheFailure = failures.find((message) => message.startsWith("compile-cache-flush:"));
  if (cacheFailure) throw new Error(cacheFailure);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cache-seed-home-"));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const port = await freePort();
  let output = "";
  try {
    const child = spawn(electron, ["--expose-internals", cli, "web", "--no-open", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: runtimeRoot,
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: "1",
        NODE_COMPILE_CACHE: stage,
        NODE_COMPILE_CACHE_PORTABLE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const flushed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cache prewarm timed out\n${output.slice(-4000)}`)), 150000);
      const collect = (chunk) => {
        output = (output + chunk.toString()).slice(-16000);
        if (output.includes("[dsh-startup] compile cache flushed")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => {
        if (!output.includes("[dsh-startup] compile cache flushed")) {
          clearTimeout(timer);
          reject(new Error(`cache prewarm exited ${code}\n${output.slice(-4000)}`));
        }
      });
    });
    await flushed;
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));

    const files = countFiles(stage);
    if (files < 100) throw new Error(`cache prewarm produced only ${files} files`);
    if (files > 500) {
      throw new Error(`cache prewarm regressed to ${files} files; startup bundles likely crossed a lazy boundary`);
    }
    fs.rmSync(seed, { recursive: true, force: true });
    fs.renameSync(stage, seed);
    process.stdout.write(`portable compile-cache seed: ${files} files\n`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
