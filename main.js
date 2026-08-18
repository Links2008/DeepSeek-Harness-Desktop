// DeepSeek Harness Electron 桌面壳
const { app, BrowserWindow, WebContentsView, ipcMain, Notification } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { patchHarnessRuntime } = require("./scripts/patch-harness-runtime.cjs");
const {
  APP_ID,
  nextMaximizeCommand,
  sanitizeTaskTitle,
  shouldNotifyTaskCompletion,
} = require("./desktop-behavior");

const DEV_DSH_DIR = "D:\\deepseek-harness";
const URL = "http://127.0.0.1:3080";
const APP_BG = "#121214";
const CONTROL_COLLAPSED_X = 4;
const CONTROL_EXPANDED_X = 23;
const CONTROL_Y = 3;
const CONTROL_MOTION_MS = 160;
let dshProc = null;
let mainWindow = null;
let controlsView = null;
let controlsX = CONTROL_COLLAPSED_X;
let controlsMotionTimer = null;
let lastExpanded = null;
let autoUpdater = null;
let updateState = { status: "idle", current: app.getVersion() };
const recentCompletionKeys = new Map();
const liveNotifications = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  focusMainWindow();
});

function log(msg) {
  try {
    const logFile = path.join(app.getPath("userData"), "dsh_desktop.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

// v2.2：设置持久化层（dsh-atomic-write）用 <file>.lock 串行化跨进程写入，且从不
// 删除别人的锁（孤儿恢复是运维动作）。后端崩溃会留下 settings.yaml.lock，导致
// 之后所有设置写入（主题切换等）超时回滚。启动时检测锁内 PID，若已死亡则清理。
function healOrphanedSettingsLock() {
  try {
    const lockPath = path.join(app.getPath("home"), ".dsh", "settings.yaml.lock");
    if (!fs.existsSync(lockPath)) return;
    const pid = parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      fs.unlinkSync(lockPath);
      log("removed invalid settings lock");
      return;
    }
    try {
      process.kill(pid, 0);
    } catch (e) {
      fs.unlinkSync(lockPath);
      log("healed orphaned settings.yaml.lock (dead pid=" + pid + ")");
    }
  } catch (e) {
    log("settings lock heal failed: " + e.message);
  }
}

function emitUpdateState(next) {
  updateState = { ...updateState, ...next, current: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-state", updateState);
  }
}

function initializeUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    log("updater unavailable: " + e.message);
    emitUpdateState({ status: "error", message: "更新器不可用" });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  let progressBucket = -1;
  // v2.2.1-r3：更新终态系统通知（用户反馈点击更新无任何提示，此前仅写按钮 tooltip）
  const notifyUpdate = (title, body) => {
    if (!Notification.isSupported()) return;
    try {
      const n = new Notification({
        title, body,
        icon: path.join(__dirname, "deepseek_whale_hermes_rounded.png"),
      });
      n.on("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
      });
      n.show();
    } catch (e) { log("update notification failed: " + e.message); }
  };
  autoUpdater.on("checking-for-update", () => {
    log("checking for update: current=" + app.getVersion());
    emitUpdateState({ status: "checking", percent: 0, message: null });
  });
  autoUpdater.on("update-available", (info) => {
    log("update available: " + info.version);
    emitUpdateState({ status: "downloading", version: info.version, percent: 0 });
    notifyUpdate("发现新版本 " + info.version, "正在后台自动下载…");
  });
  autoUpdater.on("update-not-available", (info) => {
    log("update not available: remote=" + info.version);
    emitUpdateState({ status: "current", version: info.version, percent: 100 });
    notifyUpdate("DeepSeek Harness 已是最新", "当前版本 " + info.version + "，无需更新");
  });
  autoUpdater.on("download-progress", (info) => {
    const bucket = Math.floor(info.percent / 10) * 10;
    if (bucket === progressBucket) return;
    progressBucket = bucket;
    log("update download progress: " + bucket + "%");
    emitUpdateState({ status: "downloading", percent: bucket });
  });
  autoUpdater.on("update-downloaded", (info) => {
    log("update ready: " + info.version + " file=" + info.downloadedFile);
    emitUpdateState({ status: "ready", version: info.version, percent: 100 });
    notifyUpdate("新版本 " + info.version + " 已就绪", "点击侧栏「重启更新」按钮立即安装");
  });
  autoUpdater.on("error", (e) => {
    log("update error [" + (e.code || e.name || "Error") + "]: " + e.message);
    emitUpdateState({ status: "error", message: "检查更新失败，请稍后重试" });
    notifyUpdate("检查更新失败", String(e.message || "请稍后重试").slice(0, 120));
  });
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

function portOpen(port, timeout = 400) {
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
  // v2.2.1-gate：后端 stdout/stderr 汇流写入 dsh_backend.log（每次启动截断，
  // 旧文件先重命名为 .prev；约 2MB 上限，超出后停止写入；出错静默降级）
  const backendLogPath = path.join(app.getPath("userData"), "dsh_backend.log");
  const BACKEND_LOG_LIMIT = 2 * 1024 * 1024;
  let backendLogClosed = false;
  try {
    if (fs.existsSync(backendLogPath)) {
      try { fs.renameSync(backendLogPath, backendLogPath + ".prev"); } catch (e) {}
    }
    fs.writeFileSync(backendLogPath, `[${new Date().toISOString()}] dsh backend log start\n`);
  } catch (e) { backendLogClosed = true; }
  let backendLogSize = 0;
  try { backendLogSize = fs.statSync(backendLogPath).size; } catch (e) {}
  const appendBackendLog = (label, chunk) => {
    if (backendLogClosed) return;
    try {
      const text = `[${label}] ` + chunk.toString();
      if (backendLogSize + Buffer.byteLength(text) > BACKEND_LOG_LIMIT) {
        backendLogClosed = true;
        fs.appendFileSync(backendLogPath, "\n[dsh-desktop] log size limit reached, further output dropped\n");
        return;
      }
      backendLogSize += Buffer.byteLength(text);
      fs.appendFileSync(backendLogPath, text);
    } catch (e) { backendLogClosed = true; }
  };
  let backendReady = false;
  let respawned = false;

const startBackend = (attempt) => {
    try {
      dshProc = spawn(
        backend.command,
        backend.args,
        { cwd: backend.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      log("spawned backend pid=" + dshProc.pid + " attempt=" + attempt);
      const spawnStartedAt = Date.now();
      let firstOutputAt = null;
      let readyKeywordAt = null;
      const onOutput = (label) => (chunk) => {
        if (firstOutputAt === null) {
          firstOutputAt = Date.now();
          log("backend first-output after " + (firstOutputAt - spawnStartedAt) + "ms");
        }
        appendBackendLog(label, chunk);
        if (readyKeywordAt === null && /\b(listening|started|ready)\b/i.test(chunk.toString())) {
          readyKeywordAt = Date.now();
          log("backend ready-keyword after " + (readyKeywordAt - spawnStartedAt) + "ms");
        }
      };
      if (dshProc.stdout) dshProc.stdout.on("data", onOutput("stdout"));
      if (dshProc.stderr) dshProc.stderr.on("data", onOutput("stderr"));
      dshProc.on("error", (e) => log("spawn error: " + e.message));
      dshProc.on("exit", (c) => {
        log("backend exited code=" + c);
        if (!backendReady && c !== 0 && !respawned) {
          respawned = true;
          log("backend respawn attempt=1");
          startBackend(2);
        }
      });
    } catch (e) { log("spawn threw: " + e.message); }
  };
  startBackend(1);
  const startedAt = Date.now();
  let lastLoadingUpdateMs = 0;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(3080)) {
      backendReady = true;
      backendReadyAt = Date.now();
      log("backend ready after " + ((i + 1) * 250) + "ms");
      return true;
    }
    // v2.2.1-gate：loading 页文案附加已耗时秒数；超过 60 秒提示可能被杀毒软件拖慢
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs - lastLoadingUpdateMs >= 1000 && mainWindow && !mainWindow.isDestroyed()) {
      lastLoadingUpdateMs = elapsedMs;
      const seconds = Math.floor(elapsedMs / 1000);
      const slowHint = seconds > 60 ? "，启动较慢，可能被杀毒软件扫描拖慢" : "";
      mainWindow.webContents.executeJavaScript(`
        (function () {
          var detail = document.querySelector('[data-detail]');
          if (detail) detail.textContent = '首次启动可能需要约一分钟，已等待 ' + ${seconds} + ' 秒' + ${JSON.stringify(slowHint)};
        })();
      `).catch(() => {});
    }
  }
  log("backend timeout after 150s");
  return false;
}

  // v3.1：插件安装/卸载后自动刷新 Web UI。只 stat 轮询 package.json 与
// cordis.patch.yml 两个清单并做内容摘要比对；不再 fs.watch node_modules——
// pnpm 安装期的事件风暴曾把冷启动拖到 40s+ 并引发 ERR_ABORTED 重载循环
// （侧栏打不开、设置按键失灵均为重载吞点击的表象）。防护：后端就绪前
// 不重载；5s 静默合并；两次重载至少间隔 15s。
let pluginReloadTimer = null;
let lastPluginReloadAt = 0;
let backendReadyAt = 0;
const profileDigests = new Map();
function profileDigest(file) {
  try {
    return require("node:crypto").createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  } catch (_error) {
    return null;
  }
}
function watchProfileChanges() {
  const profileDir = path.join(app.getPath("home"), ".dsh", "profiles", "web");
  const queueReload = (why) => {
    if (!backendReadyAt) {
      log("profile change before backend ready ignored (" + why + ")");
      return;
    }
    log("profile change detected (" + why + "), reload queued");
    if (pluginReloadTimer) clearTimeout(pluginReloadTimer);
    pluginReloadTimer = setTimeout(() => {
      pluginReloadTimer = null;
      if (Date.now() - lastPluginReloadAt < 15000) {
        log("plugin reload skipped: rate limited");
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        lastPluginReloadAt = Date.now();
        log("reloading web UI after plugin change");
        mainWindow.webContents.reload();
      }
    }, 5000);
  };
  try {
    ["package.json", "cordis.patch.yml"].forEach((name) => {
      const file = path.join(profileDir, name);
      profileDigests.set(name, profileDigest(file));
      fs.watchFile(file, { interval: 2500 }, () => {
        const digest = profileDigest(file);
        if (digest !== profileDigests.get(name)) {
          profileDigests.set(name, digest);
          queueReload(name);
        }
      });
    });
    log("profile watcher armed (manifest digests)");
  } catch (e) {
    log("profile watcher failed: " + e.message);
  }
}

async function injectWindowChrome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.insertCSS(`
    :root {
      --ds-transition-duration-fast: 120ms;
      --ds-transition-duration-medium: 180ms;
      --ds-transition-duration-slow: 240ms;
      --ds-ease-out: cubic-bezier(0, 0, .2, 1);
      --ds-ease-in-out: cubic-bezier(.4, 0, .2, 1);
    }
    .dsh-native-drag-region { -webkit-app-region: drag; }
    .dsh-native-drag-region button,
    .dsh-native-drag-region a,
    .dsh-native-drag-region input,
    .dsh-native-drag-region textarea,
    .dsh-native-drag-region select,
    .dsh-native-drag-region [role="button"],
    .dsh-native-drag-region [role="tab"],
    .dsh-native-drag-region [tabindex] { -webkit-app-region: no-drag; }
    /* v3.1：侧栏底部"检查更新"与"移动端远程控制"两枚按钮统一规格
       （36px 圆形幽灵按钮、同一颜色 token、flex 行对齐；此前更新钮被
       强制 40px 白色而远程钮保持插件原生 36px 灰色，大小颜色均不一致） */
    [data-dsh-entry-row] { display: flex !important; align-items: center !important; gap: 2px !important; }
    [data-dsh-entry-row] > button {
      width: 36px !important; height: 36px !important; min-width: 36px !important; max-width: 36px !important;
      padding: 0 !important; border: 0 !important; border-radius: 50% !important; margin: 0 !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      flex: 0 0 36px !important;
      color: var(--dsw-alias-label-secondary, rgba(255,255,255,.72)) !important;
      background: transparent !important;
      transform: translateZ(0); -webkit-app-region: no-drag;
      transition: color 120ms linear, background-color 120ms linear, transform 90ms var(--ds-ease-out);
    }
    [data-dsh-entry-row] > button svg { width: 18px !important; height: 18px !important; }
    [data-dsh-entry-row] > button:hover:not(:disabled) {
      background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.10)) !important;
      color: var(--dsw-alias-label-primary, rgba(255,255,255,1)) !important;
    }
    button[data-dsh-update-state="checking"],
    button[data-dsh-update-state="downloading"] { opacity: .68; }
    button[data-dsh-update-state="error"] { color: #ff6b63 !important; }
    button[data-dsh-update-state]:active:not(:disabled) { transform: scale(.96); }
    button[data-dsh-update-state]:focus-visible { outline: 2px solid rgba(255,255,255,.84); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      [data-dsh-entry-row] > button { transition: color 120ms linear, background-color 120ms linear; }
      button[data-dsh-update-state]:active:not(:disabled) { transform: none; }
    }
  `);
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      function bindSidebarTracker() {
        if (!window.dshWin || !window.dshWin.sidebarState || typeof ResizeObserver === 'undefined') return;
        var frame = Array.from(document.querySelectorAll('div')).find(function (el) {
          return el.style.gridTemplateColumns && el.style.gridTemplateColumns.indexOf('px') >= 0;
        });
        var sidebar = frame && frame.firstElementChild;
        if (!sidebar || (sidebar === window.__dshSidebarTarget && frame === window.__dshSidebarFrame)) return;
        if (window.__dshSidebarResizeObserver) window.__dshSidebarResizeObserver.disconnect();
        if (window.__dshSidebarMutationObserver) window.__dshSidebarMutationObserver.disconnect();
        window.__dshSidebarTarget = sidebar;
        window.__dshSidebarFrame = frame;
        var lastExpanded = window.__dshSidebarExpanded;
        var report = function (width) {
          width = Math.round(width * 10) / 10;
          // v2.2.1-r5：滞回+消抖。better-sidebar 接管侧栏后宽度在 168px 阈值附近
          // 抖动，壳层窗口控件位置（23px<->4px）来回弹跳。滞回带 [152,184]：
          // 越过上沿算展开、跌破下沿算收起，带内保持原状态；变化延迟 250ms 确认。
          var pendingTimer = null;
          var next = width > 184 ? true : width < 152 ? false : lastExpanded;
          if (next === lastExpanded) {
            if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
            return;
          }
          if (pendingTimer) clearTimeout(pendingTimer);
          pendingTimer = setTimeout(function () {
            pendingTimer = null;
            if (next === lastExpanded) return;
            lastExpanded = next;
            window.__dshSidebarExpanded = next;
            window.dshWin.sidebarState({
              expanded: next,
              reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            });
          }, 250);
        };
        var reportMeasured = function () { report(sidebar.getBoundingClientRect().width); };
        var reportTarget = function () {
          var width = parseFloat(frame.style.gridTemplateColumns);
          report(Number.isFinite(width) ? width : sidebar.getBoundingClientRect().width);
        };
        window.__dshSidebarResizeObserver = new ResizeObserver(reportMeasured);
        window.__dshSidebarResizeObserver.observe(sidebar);
        window.__dshSidebarMutationObserver = new MutationObserver(reportTarget);
        window.__dshSidebarMutationObserver.observe(frame, { attributes: true, attributeFilter: ['style', 'class'] });
        reportTarget();
      }

      function updateLabelFor(state) {
        if (!state) return '检查更新';
        if (state.status === 'checking') return '检查中';
        if (state.status === 'downloading') return '下载中 ' + (state.percent || 0) + '%';
        if (state.status === 'ready') return '重启更新';
        if (state.status === 'current') return '已是最新';
        if (state.status === 'error') return '重试更新';
        return '检查更新';
      }

      function bindUpdateButton() {
        if (!window.dshWin || !window.dshWin.checkUpdate) return;
        var button = document.querySelector('button[data-dsh-update-state], button[aria-label="检查更新"]');
        if (!button) return;
        var row = button.parentElement;
        if (row && row.dataset.dshEntryRow === undefined) row.dataset.dshEntryRow = '';
        if (button.__dshUpdateBound) return;
        if (window.__dshUpdateUnsubscribe) window.__dshUpdateUnsubscribe();
        button.__dshUpdateBound = true;
        var render = function (state) {
          var text = updateLabelFor(state);
          button.dataset.dshUpdateState = (state && state.status) || 'idle';
          button.setAttribute('aria-label', text);
          button.title = text;
          button.disabled = state && (state.status === 'checking' || state.status === 'downloading');
        };
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (button.dataset.dshUpdateState === 'ready') window.dshWin.installUpdate();
          else window.dshWin.checkUpdate();
        }, true);
        window.__dshUpdateUnsubscribe = window.dshWin.onUpdateState(render);
        window.dshWin.getUpdateState().then(render);
      }

      function bindNativeDragRegion() {
        var action = Array.from(document.querySelectorAll('button')).find(function (button) {
          var label = (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '');
          return /总结导出|Session log|会话层级/.test(label);
        });
        var header = action && action.closest('header');
        if (!header) {
          header = Array.from(document.querySelectorAll('header')).find(function (candidate) {
            return candidate.querySelector('button') && candidate.querySelector('[role="tablist"], [role="tab"]');
          });
        }
        if (!header || header === window.__dshNativeDragTarget) return;
        if (window.__dshNativeDragTarget) window.__dshNativeDragTarget.classList.remove('dsh-native-drag-region');
        header.classList.add('dsh-native-drag-region');
        header.addEventListener('dblclick', function (event) {
          if (event.target.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [tabindex]')) return;
          if (window.dshWin) window.dshWin.max();
        });
        window.__dshNativeDragTarget = header;
      }

      function ensureChrome() {
        if (!document.body) return;
        document.querySelector('.dsh-drag-region')?.remove();
        bindSidebarTracker();
        bindUpdateButton();
        bindNativeDragRegion();
      }
      ensureChrome();
      if (!window.__dshChromeObserver) {
        window.__dshChromeObserver = new MutationObserver(function () { queueMicrotask(ensureChrome); });
        window.__dshChromeObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    })();
  `);
}

async function injectDesktopTweaks() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.insertCSS(`
    /* v2.2：用户要求移除一级菜单的任务看板（插件入口与看板视图一并隐藏） */
    [data-dsh-taskboard-entry],
    [data-dsh-taskboard-board],
    [data-dsh-taskboard-view] { display: none !important; }
    /* v2.2：云母模式下会话框底下的命中数据栏右偏：aqua 主题给该元素加了
       position:relative，left:50%+translateX 叠加产生净右偏；改为 left:0 清除
       相对偏移，用 margin auto + 定宽 width 居中，窄窗口不再压扁栏体 */
    /* v2.2.1-r3：设置对话框内 Web UI 插件卡片默认收起（抽屉化），点卡片首行展开 */
    [data-dsh-drawer] { cursor: pointer; }
    [data-dsh-drawer][data-dsh-collapsed] > *:not(:first-child) { display: none !important; }
    /* v2.2.1-r5：顶级商店条目（SSH 正下方，低频轮询注入）。收起态纯图标居中 */
    [data-dsh-store-entry][data-dsh-icon] { padding: 8px 0 !important; justify-content: center !important; gap: 0 !important; }
    [data-dsh-store-entry][data-dsh-icon] > span { display: none !important; }
    [data-dsh-float] [data-dsh-stats] {
      left: 0 !important;
      transform: none !important;
      margin-left: auto !important;
      margin-right: auto !important;
      width: min(calc(var(--dsh-chat-content-width) + 32px), calc(100% - 32px)) !important;
      max-width: 100% !important;
    }
  `);
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      if (window.__dshSettingsCollapseBound) return;
      window.__dshSettingsCollapseBound = true;
      // v2.2.1-r3：设置对话框的 Web UI 插件分区卡片默认收起。前端无原生折叠机制，
      // 锚点用标题文案（/web ui/i）+ 结构（ul/subcards 子项），不依赖哈希类名。
      function collapseCard(card) {
        if (card.dataset.dshDrawer !== undefined) return;
        if (!card.children || card.children.length <= 1) return;
        card.dataset.dshDrawer = '';
        card.dataset.dshCollapsed = '';
        var header = card.firstElementChild;
        header.addEventListener('click', function (e) {
          if (e.target.closest('[data-dsh-drawer]') !== card) return;
          if (e.target.closest('button, input, select, textarea, a, [role="switch"], [role="button"]')) return;
          if (card.dataset.dshCollapsed !== undefined) delete card.dataset.dshCollapsed;
          else card.dataset.dshCollapsed = '';
        });
      }
      function processDialog(dialog) {
        var headings = Array.prototype.slice.call(dialog.querySelectorAll('h2, h3'));
        headings.forEach(function (h) {
          if (!/web ui/i.test(h.textContent || '')) return;
          var section = h.parentElement;
          if (!section || section.dataset.dshDrawerSection !== undefined) return;
          section.dataset.dshDrawerSection = '';
          var list = section.querySelector('ul, [class*="subcards"], [class*="sectionList"]');
          var cards = list ? Array.prototype.slice.call(list.children)
            : Array.prototype.slice.call(section.children).filter(function (el) {
                return el !== h && el.tagName !== 'P';
              });
          cards.forEach(collapseCard);
        });
      }
      function scan() {
        var dialogs = document.querySelectorAll('div[role="dialog"]');
        Array.prototype.forEach.call(dialogs, processDialog);
      }
      scan();
      new MutationObserver(function () { queueMicrotask(scan); })
        .observe(document.documentElement, { childList: true, subtree: true });
    })();
  `);
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      // v2.2.1-r5：顶级商店入口（SSH 正下方）回归。改用低频轮询（2.5s）而非
      // MutationObserver：better-sidebar 高频重写侧栏 DOM，观察器会与之形成
      // 正反馈（r3 崩溃根因）；轮询只在条目脱链时补插一次，不监听 DOM 变化。
      if (window.__dshStorePollTimer) clearInterval(window.__dshStorePollTimer);
      function sidebarColumn() {
        return document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      }
      function findSshButton() {
        var scopes = [sidebarColumn(), document];
        for (var i = 0; i < scopes.length; i++) {
          if (!scopes[i]) continue;
          var btn = Array.prototype.slice.call(scopes[i].querySelectorAll('button')).find(function (b) {
            var label = (b.getAttribute('aria-label') || '').trim();
            var text = (b.textContent || '').trim();
            return label === 'SSH' || text === 'SSH';
          });
          if (btn) return btn;
        }
        return null;
      }
      function openStore() {
        function findSettingsButton() {
          var column = sidebarColumn();
          var matches = column
            ? Array.prototype.slice.call(column.querySelectorAll('button[aria-haspopup="dialog"]'))
            : [];
          if (matches.length === 0) {
            matches = Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup="dialog"]'));
          }
          if (matches.length === 0) return null;
          return matches.slice().sort(function (a, b) {
            return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
          })[0];
        }
        function findMarketplaceTab(scope) {
          var candidates = Array.prototype.slice.call((scope || document).querySelectorAll('[role="tab"], button'));
          var labels = ['插件市场', 'Plugin Market', 'DSH插件市场', 'DSH Plugin Marketplace'];
          for (var i = 0; i < labels.length; i++) {
            var found = candidates.find(function (b) { return (b.textContent || '').trim() === labels[i]; });
            if (found) return found;
          }
          return candidates.find(function (b) { return /插件市场|plugin\\s*market/i.test((b.textContent || '').trim()); });
        }
        function tryClickMarketplaceTab() {
          var dialog = document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          var tab = findMarketplaceTab(dialog);
          if (!tab) return false;
          tab.click();
          return true;
        }
        if (tryClickMarketplaceTab()) return;
        var settingsButton = findSettingsButton();
        if (!settingsButton) return;
        settingsButton.click();
        var tries = 0;
        var timer = setInterval(function () {
          if (tryClickMarketplaceTab() || ++tries > 20) clearInterval(timer);
        }, 250);
      }
      function ensureStoreEntry() {
        var existing = document.querySelector('[data-dsh-store-entry]');
        if (existing && existing.isConnected) {
          var col = sidebarColumn();
          var w = col ? col.getBoundingClientRect().width : 320;
          if (w > 0 && w < 72) existing.dataset.dshIcon = '';
          else delete existing.dataset.dshIcon;
          return;
        }
        var sshBtn = findSshButton();
        if (!sshBtn || !sshBtn.parentElement) return;
        var entry = document.createElement('button');
        entry.type = 'button';
        entry.dataset.dshStoreEntry = '';
        entry.setAttribute('aria-label', '插件商店');
        entry.title = '插件商店';
        entry.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;min-height:36px;box-sizing:border-box;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:8px;';
        entry.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h10l1 3H2l1-3z"/><path d="M2.5 5h11V14h-11V5z"/><path d="M6 7.5a2 2 0 0 0 4 0"/></svg><span>插件商店</span>';
        entry.addEventListener('click', openStore);
        // v3.0.1：收起态下新建时直接以纯图标插入，避免先渲染中文文字、
        // 再等下一轮轮询（最长 2.5s）才切成图标。
        var colNow = sidebarColumn();
        var wNow = colNow ? colNow.getBoundingClientRect().width : 320;
        if (wNow > 0 && wNow < 72) entry.dataset.dshIcon = '';
        sshBtn.parentElement.insertBefore(entry, sshBtn.nextSibling);
      }
      ensureStoreEntry();
      window.__dshStorePollTimer = setInterval(ensureStoreEntry, 2500);
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
        const aria = clean(row.getAttribute && (row.getAttribute('aria-label') || row.getAttribute('data-state')));
        const text = label + ' ' + aria;
        if (/(等待批准|等待回答|计划审核|等待输入|Waiting for (?:approval|answer|input)|Plan review)/i.test(text)) return 'waiting';
        if (/(进行中|运行中|生成中|思考中|Running|Thinking|In progress)/i.test(text)) return 'running';
        if (/(已完成|完成|已结束|Completed|Done|Finished)/i.test(text)) return 'completed';
        if (/(失败|出错|已取消|Failed|Error|Cancelled|Canceled)/i.test(text)) return 'failed';
        return 'idle';
      };
      const titleOf = (row, state) => {
        const children = Array.from(row.children);
        const first = clean(children[0] && children[0].textContent);
        const titleNode = state === 'idle' && first ? children[0] : children[1];
        return clean(titleNode && titleNode.textContent) || 'DeepSeek Harness';
      };
      const urlOf = (row) => {
        const link = row.matches && row.matches('a[href]') ? row : row.querySelector && row.querySelector('a[href]');
        try { return link ? new URL(link.getAttribute('href'), location.href).href : location.href; }
        catch (_error) { return location.href; }
      };
      const scan = () => {
        scanQueued = false;
        const counts = new Map();
        const seen = new Set();
        document.querySelectorAll('[role="treeitem"]:not(button), li[data-state], div[data-state="task"]').forEach((row) => {
          const state = statusOf(row);
          const title = titleOf(row, state);
          const taskUrl = urlOf(row);
          const occurrence = counts.get(title) || 0;
          counts.set(title, occurrence + 1);
          const stableId = row.id || row.getAttribute('data-id') || row.getAttribute('data-key') || taskUrl;
          const key = stableId + '::' + title + '::' + occurrence;
          seen.add(key);
          const previous = states.get(key);
          if (previous && (previous.state === 'running' || previous.state === 'waiting') &&
              (state === 'completed' || state === 'failed')) {
            window.dshWin && window.dshWin.taskComplete({ key, title, taskUrl });
          }
          states.set(key, { state, title, taskUrl });
        });
        for (const [key, previous] of states) {
          if (!seen.has(key)) {
            if (previous.state === 'running' || previous.state === 'waiting') {
              window.dshWin && window.dshWin.taskComplete({
                key, title: previous.title, taskUrl: previous.taskUrl,
              });
            }
            states.delete(key);
          }
        }
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
  controlsView.setBounds({ x: controlsX, y: CONTROL_Y, width: 48, height: 18 });
  mainWindow.contentView.addChildView(controlsView);
  await controlsView.webContents.loadFile(path.join(__dirname, "window-controls.html"));
}

function applyRuntimePatches() {
  if (!app.isPackaged) return;
  try {
    const runtimeRoot = path.join(process.resourcesPath, "dsh-runtime");
    const profileDir = path.join(app.getPath("home"), ".dsh", "profiles", "web");
    const changed = patchHarnessRuntime(runtimeRoot, profileDir, {
      onFailure: (message) => log("runtime compatibility " + message),
    });
    log("runtime compatibility: " + (changed.join(",") || "already patched"));
  } catch (e) {
    log("runtime compatibility failed: " + e.message);
  }
}

function controlStatePath() {
  return path.join(app.getPath("userData"), "window-control-state.json");
}

function loadControlState() {
  try {
    const saved = JSON.parse(fs.readFileSync(controlStatePath(), "utf8"));
    controlsX = saved.expanded ? CONTROL_EXPANDED_X : CONTROL_COLLAPSED_X;
  } catch (_error) {
    controlsX = CONTROL_COLLAPSED_X;
  }
}

function saveControlState(expanded) {
  try {
    fs.writeFileSync(controlStatePath(), JSON.stringify({ expanded: Boolean(expanded) }));
  } catch (error) {
    log("control state save failed: " + error.message);
  }
}

function stopControlsMotion() {
  if (controlsMotionTimer) clearInterval(controlsMotionTimer);
  controlsMotionTimer = null;
}

function setControlsX(nextX) {
  if (!controlsView || controlsView.webContents.isDestroyed() || nextX === controlsX) return;
  controlsX = nextX;
  controlsView.setBounds({ x: controlsX, y: CONTROL_Y, width: 48, height: 18 });
}

function animateControlsTo(expanded, reducedMotion) {
  const targetX = expanded ? CONTROL_EXPANDED_X : CONTROL_COLLAPSED_X;
  stopControlsMotion();
  if (reducedMotion || targetX === controlsX) {
    setControlsX(targetX);
    return;
  }
  const startX = controlsX;
  const startedAt = Date.now();
  const tick = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / CONTROL_MOTION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    setControlsX(Math.round(startX + (targetX - startX) * eased));
    if (progress === 1) stopControlsMotion();
  };
  controlsMotionTimer = setInterval(tick, 16);
  tick();
}

ipcMain.on("win:sidebar-state", (event, details) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  if (!controlsView || controlsView.webContents.isDestroyed()) return;
  if (!details || typeof details.expanded !== "boolean") return;
  // 侧栏状态上报在主进程侧同样去重：渲染层滞回+消抖已合并重复帧，
  // 若仍有重复状态漏到这里，跳过多余的控件动画与磁盘写入。
  if (details.expanded === lastExpanded) return;
  lastExpanded = details.expanded;
  saveControlState(details.expanded);
  animateControlsTo(details.expanded, Boolean(details.reducedMotion));
});

function updateMaximizedChrome(maximized) {
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
    transparent: false,
    backgroundColor: APP_BG,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  createControlsOverlay().catch((e) => log("controls overlay error: " + e.message));
  mainWindow.webContents.on("dom-ready", async () => {
    try { await injectWindowChrome(); } catch (e) { log("inject error: " + e.message); }
    try { await injectDesktopTweaks(); } catch (e) { log("desktop tweaks error: " + e.message); }
    try { await injectTaskCompletionBridge(); } catch (e) { log("completion bridge error: " + e.message); }
  });
  mainWindow.on("maximize", () => updateMaximizedChrome(true));
  mainWindow.on("unmaximize", () => updateMaximizedChrome(false));
  mainWindow.on("closed", () => {
    stopControlsMotion();
    mainWindow = null;
    controlsView = null;
    if (dshProc) { try { dshProc.kill(); } catch (e) {} dshProc = null; }
    app.quit();
  });
}

function safeTaskUrl(value) {
  try {
    const taskUrl = new URL(value);
    return taskUrl.origin === new URL(URL).origin ? taskUrl.href : null;
  } catch (_error) {
    return null;
  }
}

async function focusMainWindow(taskUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  const target = safeTaskUrl(taskUrl);
  if (target && mainWindow.webContents.getURL() !== target) {
    try { await mainWindow.loadURL(taskUrl); }
    catch (e) { log("notification navigation failed: " + e.message); }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.moveTop();
    mainWindow.focus();
  }
}

function showTaskCompletionNotification(details = {}) {
  if (!Notification.isSupported()) {
    log("notification skipped: unsupported");
    return;
  }
  const safeTitle = sanitizeTaskTitle(details.title);
  const taskUrl = safeTaskUrl(details.taskUrl);
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
    focusMainWindow(taskUrl);
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
ipcMain.handle("app:get-update-state", () => updateState);
ipcMain.handle("app:check-update", async (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return updateState;
  if (!app.isPackaged) {
    emitUpdateState({ status: "error", message: "开发模式不检查更新" });
    return updateState;
  }
  if (!autoUpdater) initializeUpdater();
  if (!autoUpdater || updateState.status === "checking" || updateState.status === "downloading") return updateState;
  if (updateState.status === "ready") return updateState;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    log("update check failed [" + (e.code || e.name || "Error") + "]: " + e.message);
    emitUpdateState({ status: "error", message: "检查更新失败，请稍后重试" });
    notifyUpdate("检查更新失败", String(e.message || "请稍后重试").slice(0, 120));
  }
  return updateState;
});
ipcMain.handle("app:install-update", (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
  if (!autoUpdater || updateState.status !== "ready") return false;
  log("installing downloaded update");
  autoUpdater.quitAndInstall(false, true);
  return true;
});
ipcMain.on("task:complete", (event, details = {}) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  const title = sanitizeTaskTitle(details.title);
  const key = typeof details.key === "string" ? details.key.slice(0, 180) : title;
  const taskUrl = safeTaskUrl(details.taskUrl);
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
  })) showTaskCompletionNotification({ title, taskUrl });
  else log("notification skipped: policy");
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId(APP_ID);
    log("app ready");
    loadControlState();
    healOrphanedSettingsLock();
    applyRuntimePatches();
    const backendPromise = ensureDshBackend();
    createWindow();
    initializeUpdater();
    log("window created");
    const ok = await backendPromise;
    // v3.1：后端就绪后再挂清单监视器（启动期 pnpm 自检不再触发重载）。
    // 更新检查仍只由用户点击侧栏按钮发起（见 tests/manual_runtime_v2.test.js 契约）。
    watchProfileChanges();
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
