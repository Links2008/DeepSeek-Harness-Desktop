// DeepSeek Harness Electron 桌面壳
const { app, BrowserWindow, WebContentsView, ipcMain, Notification } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  APP_ID,
  nextMaximizeCommand,
  sanitizeTaskTitle,
  shouldNotifyTaskCompletion,
} = require("./desktop-behavior");

const DEV_DSH_DIR = "D:\\deepseek-harness";
const URL = "http://127.0.0.1:3080";
const WIN_RADIUS = 30; // 窗口四角圆角(2026-08-14 用户最终确认:30px)
let dshProc = null;
let mainWindow = null;
let controlsView = null;
const recentCompletionKeys = new Map();
const liveNotifications = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

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
  let progressBucket = -1;
  autoUpdater.on("checking-for-update", () => log("checking for update: current=" + app.getVersion()));
  autoUpdater.on("update-available", (info) => log("update available: " + info.version));
  autoUpdater.on("update-not-available", (info) => log("update not available: remote=" + info.version));
  autoUpdater.on("download-progress", (info) => {
    const bucket = Math.floor(info.percent / 10) * 10;
    if (bucket === progressBucket) return;
    progressBucket = bucket;
    log("update download progress: " + bucket + "%");
  });
  autoUpdater.on("update-downloaded", (info) => {
    log("update ready for next quit: " + info.version + " file=" + info.downloadedFile);
  });
  autoUpdater.on("error", (e) => log("update error [" + (e.code || e.name || "Error") + "]: " + e.message));
  const checkForUpdates = () => autoUpdater.checkForUpdates().catch((e) => {
    log("update check failed [" + (e.code || e.name || "Error") + "]: " + e.message);
  });
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

function isDshBackend(port = 3080, timeout = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 65536) body += chunk;
      });
      response.on("end", () => {
        finish(response.statusCode === 200 && /<title>\s*DeepSeek Harness\s*<\/title>/i.test(body));
      });
    });
    request.on("error", () => finish(false));
    request.setTimeout(timeout, () => { request.destroy(); finish(false); });
  });
}

async function ensureDshBackend() {
  if (await portOpen(3080)) {
    if (await isDshBackend(3080)) {
      log("existing DeepSeek Harness on 3080, reuse without replacing it");
      return true;
    }
    log("3080 is occupied by a non-Harness service");
    return false;
  }
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
      transition: border-radius 160ms cubic-bezier(.23, 1, .32, 1);
    }
    body {
      clip-path: inset(0 round var(--dsh-window-radius));
      transition: clip-path 160ms cubic-bezier(.23, 1, .32, 1);
    }
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

async function injectTaskCompletionBridge() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      if (window.__dshTaskCompletionObserver) return;
      const states = new Map();
      let scanQueued = false;
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const statusOf = (row) => {
        const label = clean(row.firstElementChild && row.firstElementChild.textContent);
        if (/^(等待批准|等待回答|计划审核|Waiting for approval|Waiting for answer|Plan review)/i.test(label)) return 'waiting';
        if (/^(进行中|Running)(?:\\s|$)/i.test(label)) return 'running';
        if (/^(已完成|Completed)$/i.test(label)) return 'completed';
        return 'idle';
      };
      const titleOf = (row, state) => {
        const children = Array.from(row.children);
        const first = clean(children[0] && children[0].textContent);
        const titleNode = state === 'idle' && first ? children[0] : children[1];
        return clean(titleNode && titleNode.textContent) || 'DeepSeek Harness';
      };
      const scan = () => {
        scanQueued = false;
        const counts = new Map();
        const seen = new Set();
        document.querySelectorAll('[role="treeitem"]:not(button)').forEach((row) => {
          const state = statusOf(row);
          const title = titleOf(row, state);
          const occurrence = counts.get(title) || 0;
          counts.set(title, occurrence + 1);
          const key = title + '::' + occurrence;
          seen.add(key);
          const previous = states.get(key);
          if (previous === 'running' && (state === 'idle' || state === 'completed')) {
            window.dshWin && window.dshWin.taskComplete({ key, title });
          }
          states.set(key, state);
        });
        for (const key of states.keys()) if (!seen.has(key)) states.delete(key);
      };
      const queueScan = () => {
        if (scanQueued) return;
        scanQueued = true;
        queueMicrotask(scan);
      };
      window.__dshTaskCompletionObserver = new MutationObserver(queueScan);
      window.__dshTaskCompletionObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      scan();
    })();
  `);
}

async function createControlsOverlay() {
  controlsView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  controlsView.setBackgroundColor("#00000000");
  controlsView.setBounds({ x: 23, y: 6, width: 48, height: 18 });
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
    try { await injectTaskCompletionBridge(); } catch (e) { log("completion bridge error: " + e.message); }
    chromeReady = true;
    revealWhenReady();
  });
  mainWindow.once("ready-to-show", () => {
    renderReady = true;
    revealWhenReady();
  });
  mainWindow.on("maximize", () => updateMaximizedChrome(true));
  mainWindow.on("unmaximize", () => updateMaximizedChrome(false));
  mainWindow.loadFile(path.join(__dirname, "loading.html")).catch((e) => log("loading page error: " + e.message));
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log("window reveal fallback");
      mainWindow.show();
    }
  }, 10000);
  mainWindow.on("closed", () => {
    mainWindow = null;
    controlsView = null;
    if (dshProc) { try { dshProc.kill(); } catch (e) {} dshProc = null; }
    app.quit();
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function showTaskCompletionNotification(title) {
  if (!Notification.isSupported()) {
    log("notification skipped: unsupported");
    return;
  }
  const safeTitle = sanitizeTaskTitle(title);
  log("notification attempted");
  const notification = new Notification({
    title: "DeepSeek Harness",
    body: safeTitle ? `任务已完成：${safeTitle}，点击查看结果` : "任务已完成，点击查看结果",
    icon: path.join(__dirname, "deepseek_whale_hermes_rounded.png"),
  });
  liveNotifications.add(notification);
  notification.on("show", () => log("notification shown"));
  notification.on("click", () => {
    log("notification clicked");
    focusMainWindow();
  });
  notification.on("close", () => {
    liveNotifications.delete(notification);
    log("notification closed");
  });
  notification.on("failed", (_event, error) => {
    liveNotifications.delete(notification);
    log("notification failed: " + error);
  });
  notification.show();
}

// 窗口控制与任务完成 IPC
ipcMain.on("win:min", () => mainWindow && mainWindow.minimize());
ipcMain.on("win:max", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const command = nextMaximizeCommand(mainWindow.isMaximized());
  updateMaximizedChrome(command === "maximize");
  mainWindow[command]();
});
ipcMain.on("win:close", () => mainWindow && mainWindow.close());
ipcMain.on("task:complete", (event, details = {}) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  const title = sanitizeTaskTitle(details.title);
  const key = typeof details.key === "string" ? details.key.slice(0, 180) : title;
  const now = Date.now();
  for (const [oldKey, timestamp] of recentCompletionKeys) {
    if (now - timestamp > 30000) recentCompletionKeys.delete(oldKey);
  }
  if (!key || recentCompletionKeys.has(key)) return;
  recentCompletionKeys.set(key, now);
  log("task completed");
  if (shouldNotifyTaskCompletion({
    focused: mainWindow.isFocused(),
    minimized: mainWindow.isMinimized(),
  })) showTaskCompletionNotification(title);
  else log("notification skipped: policy");
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId(APP_ID);
    log("app ready");
    createWindow();
    scheduleAutoUpdates();
    log("window created");
    const ok = await ensureDshBackend();
    if (!ok) {
      log("backend failed");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
          document.querySelector('[data-status]').textContent = '启动失败，请关闭后重试';
          document.querySelector('[data-detail]').textContent = 'DeepSeek Harness 后端未能在 150 秒内启动。';
          document.querySelector('.spinner').hidden = true;
        `).catch(() => {});
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(URL).catch((e) => log("load error: " + e.message));
    }
  });
}

app.on("window-all-closed", () => {
  if (dshProc) { try { dshProc.kill(); } catch (e) {} }
  app.quit();
});
