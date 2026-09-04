const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { DaemonController, portOpen } = require("../runtime/daemon-controller.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function pipeRequest(pipe, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    let text = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => resolve(JSON.parse(text.trim())));
    socket.write(JSON.stringify(request) + "\n");
  });
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-daemon-integration-"));
  const port = await freePort();
  const fakeBackend = path.join(temporary, "fake-backend.cjs");
  fs.writeFileSync(fakeBackend, `
const http = require("node:http");
const port = Number(process.argv[2]);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<title>DeepSeek Harness</title>");
});
server.listen(port, "127.0.0.1", () => {
  process.stderr.write("dsh web: http://127.0.0.1:" + port + "\\n");
  process.stderr.write("[dsh-startup] compile cache flushed\\n");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`, "utf8");

  const options = {
    execPath: process.execPath,
    appRoot: root,
    userData: temporary,
    profileDir: path.join(temporary, "profile"),
    version: "test-1.0.0",
    port,
  };
  const spec = {
    command: process.execPath,
    args: [fakeBackend, String(port)],
    cwd: temporary,
    env: {},
    port,
  };

  const controller = new DaemonController(options);
  try {
    const competingController = new DaemonController(options);
    const [launched, competing] = await Promise.all([
      controller.ensure(spec, { timeoutMs: 10000 }),
      competingController.ensure(spec, { timeoutMs: 10000 }),
    ]);
    assert.equal(launched.ok, true);
    assert.equal(competing.ok, true);
    assert.equal(Number(launched.reused) + Number(competing.reused), 1,
      "concurrent desktop and login-prewarm launches must share one daemon");
    assert.equal(await portOpen(port), true);

    const state = controller.state();
    const denied = await pipeRequest(state.pipe, { token: "wrong", command: "status" });
    assert.equal(denied.error, "unauthorized");
    const status = await pipeRequest(state.pipe, { token: state.token, command: "status" });
    assert.equal(status.ok, true);
    assert.equal(status.state.status, "ready");

    const reused = await new DaemonController(options).ensure(spec, { timeoutMs: 2000 });
    assert.equal(reused.ok, true);
    assert.equal(reused.reused, true);
  } finally {
    controller.stopSync("integration-test");
    for (let attempt = 0; attempt < 40 && await portOpen(port, 50); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await portOpen(port, 50), false);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("persistent daemon integration verified");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
