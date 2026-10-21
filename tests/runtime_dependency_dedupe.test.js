const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/upstream-sync.yml"), "utf8"));
const assembly = workflow.jobs["build-test"].steps.find((step) => step.name === "Assemble the independent Windows runtime");
const command = (name) => {
  const line = assembly.run.split(/\r?\n/).find((line) => line.trim().startsWith(`npm ${name} `));
  assert.ok(line, `运行时装配必须保留 npm ${name} 步骤`);
  return line.trim().split(/\s+/).slice(1);
};
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const tempRoot = path.resolve(os.tmpdir());
const fixture = fs.mkdtempSync(path.join(tempRoot, "dsh-runtime-dedupe-"));
const runtime = path.join(fixture, "runtime");
const archives = new Map();
const packages = new Map();

function archive(name, version, dependencies = {}) {
  const dir = path.join(fixture, `${name}-${version}`);
  fs.mkdirSync(path.join(dir, "package"), { recursive: true });
  const manifest = { name, version, main: "index.cjs", dependencies };
  fs.writeFileSync(path.join(dir, "package/package.json"), JSON.stringify(manifest));
  const source = name === "dsh-dedupe-schema"
    ? `module.exports = { version: ${JSON.stringify(version)}, parse(value) { if (!Number.isInteger(value)) throw new TypeError('expected integer'); return value; } };`
    : "module.exports = require('dsh-dedupe-schema');";
  fs.writeFileSync(path.join(dir, "package/index.cjs"), source);
  const filename = `${name}-${version}.tgz`;
  const tarball = path.join(fixture, filename);
  execFileSync(process.platform === "win32" ? "tar.exe" : "tar", ["-czf", tarball, "-C", dir, "package"], { windowsHide: true });
  const bytes = fs.readFileSync(tarball);
  archives.set(`/tarballs/${filename}`, bytes);
  if (!packages.has(name)) packages.set(name, {});
  packages.get(name)[version] = { ...manifest, dist: { filename, integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` } };
}

(async () => {
  let registry;
  let server;
  try {
    archive("dsh-dedupe-schema", "1.0.0");
    archive("dsh-dedupe-schema", "1.1.0");
    archive("dsh-dedupe-pinned", "1.0.0", { "dsh-dedupe-schema": "1.0.0" });
    archive("dsh-dedupe-floating", "1.0.0", { "dsh-dedupe-schema": "^1.0.0" });
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (archives.has(pathname)) return response.end(archives.get(pathname));
      const name = pathname.slice(1);
      if (!packages.has(name)) { response.writeHead(404); response.end(); return; }
      const versions = Object.fromEntries(Object.entries(packages.get(name)).map(([version, manifest]) => [version, {
        ...manifest, dist: { ...manifest.dist, tarball: `${registry}/tarballs/${manifest.dist.filename}` },
      }]));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name, versions, "dist-tags": { latest: Object.keys(versions).at(-1) } }));
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    registry = `http://127.0.0.1:${server.address().port}`;
    fs.mkdirSync(runtime);
    fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ private: true, dependencies: {
      "dsh-dedupe-floating": "1.0.0", "dsh-dedupe-pinned": "1.0.0",
    } }));
    for (const name of ["user.npmrc", "global.npmrc"]) fs.writeFileSync(path.join(fixture, name), "");
    const run = (args) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli, ...args, `--registry=${registry}`, `--cache=${path.join(fixture, "cache")}`,
        `--userconfig=${path.join(fixture, "user.npmrc")}`, `--globalconfig=${path.join(fixture, "global.npmrc")}`, "--fetch-retries=0"], {
        cwd: runtime, windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, npm_config_update_notifier: "false", npm_config_prefer_dedupe: "false" },
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`npm ${args[0]} failed (${code}): ${output}`)));
    });
    const snapshot = () => JSON.parse(execFileSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const pinned = require('dsh-dedupe-pinned');
      const floating = require('dsh-dedupe-floating');
      for (const schema of [pinned, floating]) { assert.equal(schema.parse(7), 7); assert.throws(() => schema.parse('invalid'), TypeError); }
      console.log(JSON.stringify({ same: pinned === floating, versions: [pinned.version, floating.version] }));
    `], { cwd: runtime, encoding: "utf8", windowsHide: true }));
    await run(command("install"));
    assert.deepEqual(snapshot(), { same: false, versions: ["1.0.0", "1.1.0"] }, "夹具必须先复现偏向新版本造成的重复副本");
    await run(command("dedupe"));
    assert.deepEqual(snapshot(), { same: true, versions: ["1.0.0", "1.0.0"] }, "兼容消费者必须共用满足所有声明的副本，且保留校验行为");
    console.log("runtime dependency dedupe shares compatible schema copies without changing validation");
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(path.dirname(fixture), tempRoot);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
