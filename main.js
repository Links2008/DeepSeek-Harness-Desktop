// DeepSeek Harness Electron 桌面壳
const { app, BrowserWindow, WebContentsView, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");

const DEV_DSH_DIR = "D:\\deepseek-harness";
const URL = "http://127.0.0.1:3080";
const WIN_RADIUS = 30; // 窗口四角圆角(2026-08-14 用户最终确认:30px)
let dshProc = null;
let mainWindow = null;
let controlsView = null;
let mainWindowMaximized = false;
let normalWindowBounds = null;

function log(msg) {
  try {
    const logFile = path.join(app.getPath("userData"), "dsh_desktop.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

function scheduleAutoUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    log("updater unavailable: " + e.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => log("checking for update"));
  autoUpdater.on("update-available", (info) => log("update available: " + info.version));
  autoUpdater.on("update-not-available", () => log("update not available"));
  autoUpdater.on("update-downloaded", (info) => log("update ready for next quit: " + info.version));
  autoUpdater.on("error", (e) => log("update error: " + e.message));
  const checkForUpdates = () => autoUpdater.checkForUpdates().catch((e) => log("update check failed: " + e.message));
  const firstCheck = setTimeout(checkForUpdates, 30000);
  const recurringCheck = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
  firstCheck.unref();
  recurringCheck.unref();
}

function resolveBackend() {
  const runtimeRoot = path.join(process.resourcesPath, "dsh-runtime");
  const bundledNode = path.join(process.resourcesPath, "node", "node.exe");
  const bundledCli = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (fs.existsSync(bundledNode) && fs.existsSync(bundledCli)) {
    return {
      command: bundledNode,
      args: [bundledCli, "web", "--host", "127.0.0.1", "--port", "3080"],
      cwd: runtimeRoot,
    };
  }
  if (!app.isPackaged && fs.existsSync(DEV_DSH_DIR)) {
    return {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/c", "pnpm", "dsh", "web"],
      cwd: DEV_DSH_DIR,
    };
  }
  return null;
}

function portOpen(port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(timeout, () => { s.destroy(); resolve(false); });
  });
}

async function ensureDshBackend() {
  if (await portOpen(3080)) { log("3080 already open, reuse"); return true; }
  const backend = resolveBackend();
  if (!backend) { log("bundled backend runtime is missing"); return false; }
  try {
    dshProc = spawn(
      backend.command,
      backend.args,
      { cwd: backend.cwd, windowsHide: true, stdio: "ignore" }
    );
    log("spawned backend pid=" + dshProc.pid);
    dshProc.on("error", (e) => log("spawn error: " + e.message));
    dshProc.on("exit", (c) => log("backend exited code=" + c));
  } catch (e) { log("spawn threw: " + e.message); }
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await portOpen(3080)) { log("backend ready after " + ((i + 1) * 2) + "s"); return true; }
  }
  log("backend timeout after 150s");
  return false;
}

async function injectWindowChrome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.insertCSS(`
    :root { --dsh-window-radius: ${WIN_RADIUS}px; }
    html, body { background: transparent !important; }
    html, body, #root, #app, body > div:first-child {
      border-radius: var(--dsh-window-radius) !important;
      overflow: hidden !important;
    }
    body { clip-path: inset(0 round var(--dsh-window-radius)); }
    .dsh-drag-region { position: fixed; top: 4px; left: 76px; width: 156px; height: 22px; z-index: 2147483646; -webkit-app-region: drag; }
  `);
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      function ensureChrome() {
        if (!document.body) return;
        if (!document.querySelector('.dsh-drag-region')) {
        var drag = document.createElement('div');
        drag.className = 'dsh-drag-region';
        drag.setAttribute('aria-hidden', 'true');
        drag.addEventListener('dblclick', function () { if (window.dshWin) window.dshWin.max(); });
        document.body.appendChild(drag);
        }
      }
      ensureChrome();
      if (!window.__dshChromeObserver) {
        window.__dshChromeObserver = new MutationObserver(function () { queueMicrotask(ensureChrome); });
        window.__dshChromeObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    })();
  `);
}

async function createControlsOverlay() {
  controlsView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  controlsView.setBackgroundColor("#00000000");
  controlsView.setBounds({ x: 26, y: 10, width: 48, height: 12 });
  mainWindow.contentView.addChildView(controlsView);
  await controlsView.webContents.loadFile(path.join(__dirname, "window-controls.html"));
}

function updateMaximizedChrome(maximized) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const radius = maximized ? 0 : WIN_RADIUS;
  mainWindow.webContents.executeJavaScript(
    `document.documentElement.style.setProperty('--dsh-window-radius', '${radius}px')`
  );
  if (controlsView && !controlsView.webContents.isDestroyed()) {
    controlsView.webContents.executeJavaScript(`document.body.classList.toggle('maximized', ${maximized})`).catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "DeepSeek Harness",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  let renderReady = false;
  let chromeReady = false;
  let controlsReady = false;
  let revealed = false;
  const revealWhenReady = () => {
    if (!revealed && renderReady && chromeReady && controlsReady && mainWindow && !mainWindow.isDestroyed()) {
      revealed = true;
      mainWindow.show();
    }
  };
  createControlsOverlay()
    .catch((e) => log("controls overlay error: " + e.message))
    .finally(() => { controlsReady = true; revealWhenReady(); });
  mainWindow.webContents.on("dom-ready", async () => {
    try { await injectWindowChrome(); } catch (e) { log("inject error: " + e.message); }
    chromeReady = true;
    revealWhenReady();
  });
  mainWindow.once("ready-to-show", () => {
    renderReady = true;
    revealWhenReady();
  });
  mainWindow.loadURL(URL).catch((e) => log("load error: " + e.message));
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log("window reveal fallback");
      mainWindow.show();
    }
  }, 10000);
  mainWindow.on("closed", () => {
    mainWindow = null;
    controlsView = null;
    mainWindowMaximized = false;
    normalWindowBounds = null;
    if (dshProc) { try { dshProc.kill(); } catch (e) {} dshProc = null; }
    app.quit();
  });
}

// 窗口控制 IPC
ipcMain.on("win:min", () => mainWindow && mainWindow.minimize());
ipcMain.on("win:max", () => {
  if (!mainWindow) return;
  if (mainWindowMaximized && normalWindowBounds) {
    mainWindow.setBounds(normalWindowBounds);
    mainWindowMaximized = false;
    updateMaximizedChrome(false);
    return;
  }
  normalWindowBounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(normalWindowBounds).workArea;
  mainWindow.setBounds(workArea);
  mainWindowMaximized = true;
  updateMaximizedChrome(true);
});
ipcMain.on("win:close", () => mainWindow && mainWindow.close());

app.whenReady().then(async () => {
  log("app ready");
  const ok = await ensureDshBackend();
  if (!ok) { log("backend failed, quitting"); app.quit(); return; }
  createWindow();
  scheduleAutoUpdates();
  log("window created");
});

app.on("window-all-closed", () => {
  if (dshProc) { try { dshProc.kill(); } catch (e) {} }
  app.quit();
});
