const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function daemonPaths(userData) {
  return {
    state: path.join(userData, "daemon-state.json"),
    launch: path.join(userData, "daemon-launch.json"),
    lock: path.join(userData, "daemon-launch.lock"),
  };
}

function pipeNameFor(userData) {
  const id = crypto.createHash("sha256").update(path.resolve(userData).toLowerCase()).digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\dsh-desktop-${id}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_error) { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, file);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (_error) { return false; }
}

function acquireLaunchLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + "\n");
      fs.closeSync(descriptor);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = readJson(file);
      if (owner && processAlive(owner.pid)) return false;
      try { fs.unlinkSync(file); } catch (_unlinkError) { return false; }
    }
  }
  return false;
}

function releaseLaunchLock(file) {
  const owner = readJson(file);
  if (owner?.pid !== process.pid) return;
  try { fs.unlinkSync(file); } catch (_error) {}
}

function isReusableState(state, expected) {
  return Boolean(state && state.version === expected.version && state.port === expected.port);
}

function portOpen(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(timeout, () => { socket.destroy(); resolve(false); });
  });
}

function isDshBackend(port = 3080, timeout = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const request = http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 65536) body += chunk; });
      response.on("end", () => finish(
        response.statusCode === 200 && /<title>\s*DeepSeek Harness\s*<\/title>/i.test(body),
      ));
    });
    request.once("error", () => finish(false));
    request.setTimeout(timeout, () => { request.destroy(); finish(false); });
  });
}

class DaemonController {
  constructor(options) {
    this.execPath = options.execPath;
    this.appRoot = options.appRoot;
    this.userData = options.userData;
    this.profileDir = options.profileDir;
    this.version = options.version;
    this.port = options.port || 3080;
    this.log = options.log || (() => {});
    this.onPortOpen = options.onPortOpen || (() => {});
    this.paths = daemonPaths(this.userData);
  }

  state() {
    return readJson(this.paths.state);
  }

  stopSync(reason = "desktop-update") {
    const state = this.state();
    if (!state || !processAlive(state.pid)) return false;
    this.log(`stopping daemon pid=${state.pid} reason=${reason}`);
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(state.pid)], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 20000,
      });
    } else {
      try { process.kill(state.pid, "SIGTERM"); } catch (_error) {}
    }
    return true;
  }

  async waitForPeer(timeoutMs) {
    const startedAt = Date.now();
    const expected = { version: this.version, port: this.port };
    while (Date.now() - startedAt < timeoutMs) {
      const state = this.state();
      if (isReusableState(state, expected) && state.status === "ready" &&
          processAlive(state.pid) && await isDshBackend(this.port, 500)) {
        this.log(`daemon ready after peer launch pid=${state.pid}`);
        this.onPortOpen();
        return { ok: true, reused: true, state, elapsedMs: Date.now() - startedAt };
      }
      const owner = readJson(this.paths.lock);
      if (!owner || !processAlive(owner.pid)) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, reason: "peer-launch-timeout", state: this.state() };
  }

  async ensure(spec, options = {}) {
    const timeoutMs = options.timeoutMs || 150000;
    const expected = { version: this.version, port: this.port };
    let previous = this.state();
    if (isReusableState(previous, expected) && previous.status === "ready" &&
        processAlive(previous.pid) && await isDshBackend(this.port)) {
      this.log(`daemon ready reused pid=${previous.pid}`);
      this.onPortOpen();
      return { ok: true, reused: true, state: previous, elapsedMs: 0 };
    }
    if (await portOpen(this.port)) {
      const matchingDaemonStarting = isReusableState(previous, expected) && processAlive(previous.pid);
      if (!matchingDaemonStarting && await isDshBackend(this.port)) {
        this.log("compatible external Harness backend reused");
        this.onPortOpen();
        return { ok: true, reused: true, external: true, elapsedMs: 0 };
      }
      if (!matchingDaemonStarting) return { ok: false, reason: "port-occupied" };
    }
    if (!acquireLaunchLock(this.paths.lock)) {
      const peer = await this.waitForPeer(timeoutMs);
      if (peer) return peer;
      return this.ensure(spec, { ...options, timeoutMs: Math.max(1000, timeoutMs / 2) });
    }
    try {
      previous = this.state();
      if (isReusableState(previous, expected) && previous.status === "ready" &&
          processAlive(previous.pid) && await isDshBackend(this.port)) {
        this.log(`daemon ready reused after launch lock pid=${previous.pid}`);
        this.onPortOpen();
        return { ok: true, reused: true, state: previous, elapsedMs: 0 };
      }
    if (previous && processAlive(previous.pid)) {
      this.stopSync("version-or-health-mismatch");
      for (let attempt = 0; attempt < 40 && await portOpen(this.port); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (options.beforeLaunch) await options.beforeLaunch();
    const token = crypto.randomBytes(32).toString("hex");
    const launch = {
      schema: 1,
      version: this.version,
      port: this.port,
      token,
      pipe: pipeNameFor(this.userData),
      statePath: this.paths.state,
      profileDir: this.profileDir,
      backend: spec,
    };
    writeJsonAtomic(this.paths.launch, launch);
    const host = path.join(this.appRoot, "runtime", "daemon-host.cjs");
    const child = spawn(this.execPath, [host, "--config", this.paths.launch], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
    this.log(`daemon launched pid=${child.pid}`);
    const startedAt = Date.now();
    let portReported = false;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!portReported && await portOpen(this.port, 100)) {
        portReported = true;
        this.log(`backend port-open after ${Date.now() - startedAt}ms`);
        this.onPortOpen();
      }
      const state = this.state();
      if (state?.status === "ready" && await isDshBackend(this.port, 500)) {
        this.log(`daemon HTTP ready after ${Date.now() - startedAt}ms`);
        return { ok: true, reused: false, state, elapsedMs: Date.now() - startedAt };
      }
      if (state && state.status === "failed" && !processAlive(state.pid)) {
        return { ok: false, reason: state.error || "daemon-failed", state };
      }
    }
    return { ok: false, reason: "timeout", state: this.state() };
    } finally {
      releaseLaunchLock(this.paths.lock);
    }
  }
}

module.exports = {
  DaemonController,
  daemonPaths,
  isDshBackend,
  isReusableState,
  pipeNameFor,
  portOpen,
};
