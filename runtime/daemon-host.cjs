const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createPluginQuarantine } = require("./plugin-recovery.cjs");

const MAX_RESPAWN = 3;
const LOG_LIMIT = 2 * 1024 * 1024;
const configIndex = process.argv.indexOf("--config");
if (configIndex < 0 || !process.argv[configIndex + 1]) throw new Error("daemon config is required");
const config = JSON.parse(fs.readFileSync(process.argv[configIndex + 1], "utf8"));
if (!config.token || !config.pipe || !config.statePath || !config.backend) {
  throw new Error("daemon config is incomplete");
}

let backend = null;
let stopping = false;
let respawnCount = 0;
let stderrTail = "";
let currentState = {};
const startedAt = Date.now();
const logPath = path.join(path.dirname(config.statePath), "dsh_backend.log");
const quarantineBrokenPlugin = createPluginQuarantine({ profileDir: config.profileDir, maxCount: 2 });
let logBytes = 0;
let logClosed = false;

function serviceUrlFromAnnouncement(text) {
  const match = text.match(/\bdsh web:\s*(http:\/\/\S+)/i);
  if (!match) return null;
  try {
    const candidate = new URL(match[1]);
    if (candidate.hostname !== "127.0.0.1" || Number(candidate.port) !== Number(config.port)) return null;
    return candidate.toString();
  } catch (_error) {
    return null;
  }
}

function writeState(next) {
  const state = {
    ...currentState,
    schema: 1,
    pid: process.pid,
    backendPid: backend?.pid || null,
    version: config.version,
    port: config.port,
    pipe: config.pipe,
    token: config.token,
    startedAt,
    updatedAt: Date.now(),
    ...next,
  };
  const temporary = `${config.statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, config.statePath);
  currentState = state;
  return state;
}

function prepareLog() {
  try {
    if (fs.existsSync(logPath)) {
      try { fs.renameSync(logPath, `${logPath}.prev`); } catch (_error) {}
    }
    fs.writeFileSync(logPath, `[${new Date().toISOString()}] dsh daemon backend log start\n`);
    logBytes = fs.statSync(logPath).size;
  } catch (_error) {
    logClosed = true;
  }
}

function appendLog(label, chunk) {
  if (logClosed) return;
  try {
    const text = `[${label}] ${chunk.toString()}`;
    const bytes = Buffer.byteLength(text);
    if (logBytes + bytes > LOG_LIMIT) {
      fs.appendFileSync(logPath, "\n[dsh-daemon] log size limit reached\n");
      logClosed = true;
      return;
    }
    fs.appendFileSync(logPath, text);
    logBytes += bytes;
  } catch (_error) {
    logClosed = true;
  }
}

function killBackendTree() {
  if (!backend) return;
  const pid = backend.pid;
  try { backend.removeAllListeners("exit"); } catch (_error) {}
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 20000,
    });
  } else {
    try { backend.kill("SIGTERM"); } catch (_error) {}
  }
  backend = null;
}

function shutdown(reason = "requested") {
  if (stopping) return;
  stopping = true;
  writeState({ status: "stopping", reason });
  killBackendTree();
  writeState({ status: "stopped", reason, backendPid: null });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

function startBackend() {
  const spec = config.backend;
  const attemptStartedAt = Date.now();
  let serviceAnnounced = false;
  let startupSettled = false;
  let announcementTail = "";
  stderrTail = "";
  backend = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    windowsHide: true,
    env: { ...process.env, ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeState({ status: "starting", backendPid: backend.pid, attempt: respawnCount + 1 });
  const observe = (label) => (chunk) => {
    const text = chunk.toString();
    appendLog(label, chunk);
    if (label === "stderr") stderrTail = (stderrTail + text).slice(-65536);
    announcementTail = (announcementTail + text).slice(-8192);
    const serviceUrl = serviceUrlFromAnnouncement(announcementTail);
    if (!serviceAnnounced && serviceUrl) {
      serviceAnnounced = true;
      writeState({
        status: startupSettled ? "ready" : "settling",
        serviceAnnouncedMs: Date.now() - attemptStartedAt,
        serviceUrl,
      });
    }
    if (!startupSettled && /\[dsh-startup\] compile cache flushed/.test(text)) {
      startupSettled = true;
      writeState({ status: serviceAnnounced ? "ready" : "settling", startupSettledMs: Date.now() - attemptStartedAt });
    }
  };
  backend.stdout?.on("data", observe("stdout"));
  backend.stderr?.on("data", observe("stderr"));
  backend.once("error", (error) => appendLog("daemon", `spawn error: ${error.message}\n`));
  backend.once("exit", (code) => {
    backend = null;
    if (stopping) return;
    if (code !== 0 && respawnCount < MAX_RESPAWN) {
      respawnCount += 1;
      const delayMs = Math.pow(4, respawnCount - 1) * 1000;
      const quarantine = quarantineBrokenPlugin(stderrTail);
      writeState({
        status: "restarting",
        exitCode: code,
        retryInMs: delayMs,
        stderrTail,
        quarantinedPlugin: quarantine?.packageName || null,
      });
      setTimeout(startBackend, delayMs);
      return;
    }
    writeState({ status: "failed", exitCode: code, error: `backend exited ${code}`, stderrTail });
    server.close(() => process.exit(code || 1));
  });
}

const server = net.createServer((socket) => {
  let input = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    input = (input + chunk).slice(-8192);
    if (!input.includes("\n")) return;
    let request;
    try { request = JSON.parse(input.split("\n", 1)[0]); }
    catch (_error) { socket.end(JSON.stringify({ ok: false, error: "invalid-json" }) + "\n"); return; }
    if (request.token !== config.token) {
      socket.end(JSON.stringify({ ok: false, error: "unauthorized" }) + "\n");
      return;
    }
    if (request.command === "stop") {
      socket.end(JSON.stringify({ ok: true, status: "stopping" }) + "\n");
      shutdown(request.reason || "control-channel");
      return;
    }
    socket.end(JSON.stringify({ ok: true, state: writeState({}) }) + "\n");
  });
});

prepareLog();
server.on("error", (error) => {
  try { writeState({ status: "failed", error: `control pipe: ${error.message}` }); } catch (_ignored) {}
  killBackendTree();
  process.exit(1);
});
server.listen(config.pipe, () => {
  writeState({ status: "starting", backendPid: null });
  startBackend();
});
process.on("SIGTERM", () => shutdown("sigterm"));
process.on("SIGINT", () => shutdown("sigint"));
process.on("uncaughtException", (error) => {
  appendLog("daemon", `uncaught: ${error.stack || error.message}\n`);
  try { writeState({ status: "failed", error: error.message }); } catch (_ignored) {}
  killBackendTree();
  process.exit(1);
});
