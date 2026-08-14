// DeepSeek Harness Electron 桌面壳(v3:透明窗口 + 180px 圆角 + 自绘控制按钮)
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");

const DEV_DSH_DIR = "D:\\deepseek-harness";
const URL = "http://127.0.0.1:3080";
const WIN_RADIUS = 30; // 窗口四角圆角(2026-08-14 用户最终确认:30px)
let dshProc = null;
let mainWindow = null;
let mainWindowMaximized = false;
let normalWindowBounds = null;

function log(msg) {
  try {
    const logFile = path.join(app.getPath("userData"), "dsh_desktop.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
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

function injectWindowChrome() {
  mainWindow.webContents.insertCSS(`
    html, body { background: transparent !important; }
    #root, #app, body > div:first-child { border-radius: ${WIN_RADIUS}px !important; overflow: hidden !important; }
    .dsh-win-controls {
      position: fixed; top: 10px; right: 10px; z-index: 2147483647;
      display: flex; gap: 4px; -webkit-app-region: no-drag;
    }
    .dsh-win-control {
      width: 28px; height: 28px; padding: 0; border: none; border-radius: 5px; background: transparent; color: #d8d8dc;
      display: grid; place-items: center; cursor: pointer; line-height: 1;
      font: 500 13px/1 "Segoe UI Symbol", sans-serif;
      box-shadow: none; transition: background .15s, color .15s;
    }
    .dsh-win-control:hover { background: rgba(255,255,255,.10); color: #fff; }
    .dsh-win-control[data-action="close"]:hover { background: #e5484d; }
    .dsh-win-control[data-action="max"] .restore-icon { display: none; }
    .dsh-win-controls.dsh-maximized [data-action="max"] .maximize-icon { display: none; }
    .dsh-win-controls.dsh-maximized [data-action="max"] .restore-icon { display: inline; }
  `);
  mainWindow.webContents.executeJavaScript(`
    (function () {
      if (!document.querySelector('.dsh-drag-region')) {
        var drag = document.createElement('div');
        drag.className = 'dsh-drag-region';
        drag.style.cssText = 'position:fixed;top:0;left:0;right:108px;height:48px;z-index:2147483646;-webkit-app-region:drag;';
        document.body.appendChild(drag);
      }
      if (!document.querySelector('.dsh-win-controls')) {
        var controls = document.createElement('div');
        controls.className = 'dsh-win-controls';
        controls.innerHTML = '<button class="dsh-win-control" data-action="min" title="最小化">&#8722;</button>' +
          '<button class="dsh-win-control" data-action="max" title="最大化/还原"><span class="maximize-icon">&#9633;</span><span class="restore-icon">&#10064;</span></button>' +
          '<button class="dsh-win-control" data-action="close" title="关闭">&#10005;</button>';
        controls.addEventListener('click', function (event) {
          var button = event.target.closest('[data-action]');
          if (button && window.dshWin) window.dshWin[button.dataset.action]();
        });
        document.body.appendChild(controls);
      }
    })();
  `);
}

function updateMaximizedChrome(maximized) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const radius = maximized ? 0 : WIN_RADIUS;
  mainWindow.webContents.insertCSS(`#root, #app, body > div:first-child { border-radius: ${radius}px !important; }`);
  mainWindow.webContents.executeJavaScript(
    `document.querySelector('.dsh-win-controls')?.classList.toggle('dsh-maximized', ${maximized})`
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "DeepSeek Harness",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadURL(URL);
  // 注入 UI:多次尝试(页面 SPA 重渲染会清掉注入的按钮,延时重试)
  const tryInject = (delay) => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { injectWindowChrome(); } catch (e) { log("inject error: " + e.message); }
      }
    }, delay);
  };
  mainWindow.webContents.on("did-finish-load", () => { tryInject(800); tryInject(3000); tryInject(8000); });
  mainWindow.on("closed", () => {
    mainWindow = null;
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
  log("window created");
});

app.on("window-all-closed", () => {
  if (dshProc) { try { dshProc.kill(); } catch (e) {} }
  app.quit();
});
