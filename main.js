// DeepSeek Harness Electron 桌面壳
const { app, BrowserWindow, WebContentsView, ipcMain, Notification, globalShortcut, nativeTheme } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createBackendSpec } = require("./runtime/backend-spec.cjs");
const { DaemonController } = require("./runtime/daemon-controller.cjs");
const { patchHarnessRuntime } = require("./scripts/patch-harness-runtime.cjs");
const { prepareCompileCache } = require("./scripts/prepare-compile-cache.cjs");
const { prepareProfilePrebundles } = require("./scripts/prepare-profile-prebundles.cjs");
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
let daemonController = null;
// 更新/退出状态。更新时杀后端会触发 exit→respawn 恶性循环
// （后端重启→运行时重新锁住安装目录→NSIS 无法替换文件→"无法关闭"死循环），
// isQuitting 用于阻断 respawn；pendingInstallerPath 供看门狗兜底拉起安装器。
let isQuitting = false;
let pendingInstallerPath = null;
let installInFlight = false;

// 普通关窗保留 daemon；只有安装更新才停止整棵后端进程树并释放安装目录。
function stopBackendForUpdate() {
  if (daemonController && daemonController.stopSync("installer-update")) return;
  if (process.platform === "win32") {
    // v3 升级兼容：清理旧版本从安装目录启动的独立 node，不误杀其它 Node。
    try {
      const instDir = path.dirname(process.execPath).replace(/'/g, "''");
      require("child_process").spawnSync(
        "powershell",
        ["-NoProfile", "-Command",
         "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
         "Where-Object { $_.ExecutablePath -like '" + instDir + "*' } | " +
         "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
        { windowsHide: true, stdio: "ignore", timeout: 20000 }
      );
    } catch (e) {}
  }
}
let mainWindow = null;
let controlsView = null;
let startupView = null;
let controlsX = CONTROL_COLLAPSED_X;
let controlsMotionTimer = null;
let lastExpanded = null;
let startupEntryArmed = false;
let backendPagePreparedResolve = null;
let backendNavigationPromise = null;
let autoUpdater = null;
let updateState = { status: "idle", current: app.getVersion() };
const recentCompletionKeys = new Map();
const liveNotifications = new Set();
const isDaemonPrewarm = process.argv.includes("--daemon-prewarm");
const disableLoginPrewarm = process.argv.includes("--no-login-prewarm");
const benchmarkHideAfterReady = process.argv.includes("--benchmark-hide-after-ready");
const hasSingleInstanceLock = isDaemonPrewarm || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  focusMainWindow();
});

ipcMain.on("startup:consume-entry", (event) => {
  event.returnValue = false;
  if (!startupEntryArmed || !mainWindow || mainWindow.isDestroyed()) return;
  if (event.sender !== mainWindow.webContents) return;
  startupEntryArmed = false;
  event.returnValue = true;
});

function log(msg) {
  try {
    const logFile = path.join(app.getPath("userData"), "dsh_desktop.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

function configureLoginPrewarm() {
  if (!app.isPackaged || process.platform !== "win32" || disableLoginPrewarm) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: ["--daemon-prewarm"],
      enabled: true,
      name: "DeepSeekHarness",
    });
    log("login daemon prewarm enabled");
  } catch (error) {
    log("login daemon prewarm registration failed: " + error.message);
  }
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
  // v3.1.2-fix：app-update.yml 已有正确的 owner/repo 配置（验证脚本确认），
  // setFeedURL 会覆盖 app-update.yml 且可能触发 GitHub API 速率限制（未认证
  // 60 次/小时），导致"更新失败"。移除 setFeedURL，让 electron-updater 用
  // app-update.yml 的原生配置。
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
    pendingInstallerPath = info.downloadedFile || null;
    emitUpdateState({ status: "ready", version: info.version, percent: 100 });
    notifyUpdate("新版本 " + info.version + " 已就绪", "点击侧栏「重启更新」按钮立即安装");
  });
  autoUpdater.on("error", (e) => {
    log("update error [" + (e.code || e.name || "Error") + "]: " + e.message);
    emitUpdateState({ status: "error", message: "检查更新失败，请稍后重试" });
    notifyUpdate("检查更新失败", String(e.message || "请稍后重试").slice(0, 120));
  });
}


function persistentBackendSpec() {
  const backend = createBackendSpec({
    packaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
    devDshDir: DEV_DSH_DIR,
    prepareCompileCache,
  });
  if (backend?.compileCache && !backend.compileCache.packaged) {
    log("packaged compile cache unavailable, using user-data fallback: " + backend.compileCache.error.message);
  }
  return backend;
}

function persistentDaemon() {
  if (!daemonController) {
    daemonController = new DaemonController({
      execPath: process.execPath,
      appRoot: __dirname,
      userData: app.getPath("userData"),
      profileDir: path.join(app.getPath("home"), ".dsh", "profiles", "web"),
      version: app.getVersion(),
      port: 3080,
      log,
      onPortOpen: () => { void startBackendNavigation(); },
    });
  }
  return daemonController;
}

async function ensurePersistentBackend() {
  const backend = persistentBackendSpec();
  if (!backend) { log("bundled backend runtime is missing"); return false; }
  const result = await persistentDaemon().ensure(backend, {
    beforeLaunch: async () => {
      healOrphanedSettingsLock();
      if (!backend.cwd) return;
      try {
        const prepared = await prepareProfilePrebundles({
          profileDir: path.join(app.getPath("home"), ".dsh", "profiles", "web"),
          runtimeRoot: backend.cwd,
          stateDir: app.getPath("userData"),
          onLog: log,
        });
        log("profile prebundle " + JSON.stringify(prepared));
      } catch (error) {
        log("profile prebundle unavailable, continuing with original modules: " + error.message);
      }
    },
  });
  if (!result.ok) log("daemon backend failed: " + result.reason);
  else {
    backendReadyAt = Date.now();
    log(`persistent backend ready reused=${Boolean(result.reused)} elapsed=${result.elapsedMs || 0}ms`);
  }
  return result.ok;
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
    // v3.0.1-fix：后端就绪后 5 秒静默窗口，避免后端启动末尾的 pnpm 自检触发重载。
    if (Date.now() - backendReadyAt < 5000) {
      log("profile change in startup quiet window ignored (" + why + ")");
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
      // v3.1.1：重载前重放运行时补丁（含聚合入口去重）——插件/商店更新可能
      // 引入与显式 bundle 重复的聚合入口，不先去重会在后端下次启动时因
      // duplicate prefix route 崩溃（better-sidebar /sidebar/api 双注册事故）
      try { applyRuntimePatches(); } catch (e) { log("pre-reload patch replay failed: " + e.message); }
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
    /* v4：侧栏底部壳层入口统一为 36px 圆形幽灵按钮。 */
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
        var frame = window.__dshSidebarFrame;
        var sidebar = window.__dshSidebarTarget;
        if (!frame || !sidebar || !frame.isConnected || !sidebar.isConnected) {
          frame = Array.from(document.querySelectorAll('div')).find(function (el) {
            return el.style.gridTemplateColumns && el.style.gridTemplateColumns.indexOf('px') >= 0;
          });
          sidebar = frame && frame.firstElementChild;
        }
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

      function ensureUpdateButton() {
        var button = document.querySelector('button[data-dsh-update-state], button[aria-label="检查更新"]');
        if (button) return button;
        var sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]') || document;
        var settingsButtons = Array.prototype.slice.call(sidebar.querySelectorAll('button')).filter(function (candidate) {
          var label = (candidate.getAttribute('aria-label') || '').trim();
          var text = (candidate.textContent || '').trim();
          return label === '设置' || label.toLowerCase() === 'settings' ||
            text === '设置' || text.toLowerCase() === 'settings';
        });
        var settingsButton = settingsButtons.sort(function (a, b) {
          return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        })[0];
        var settingsArea = settingsButton && settingsButton.parentElement;
        var footerActions = settingsArea && settingsArea.previousElementSibling;
        if (!footerActions && settingsArea && settingsArea.parentElement) {
          settingsArea = settingsArea.parentElement;
          footerActions = settingsArea.previousElementSibling;
        }
        if (!footerActions) return null;
        var row = footerActions.querySelector('[data-dsh-update-row]');
        if (!row) {
          row = document.createElement('div');
          row.dataset.dshEntryRow = '';
          row.dataset.dshUpdateRow = '';
          footerActions.appendChild(row);
        }
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.dshUpdateEntry = '';
        button.setAttribute('aria-label', '检查更新');
        button.title = '检查更新';
        button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
        row.appendChild(button);
        return button;
      }

      function bindUpdateButton() {
        if (!window.dshWin || !window.dshWin.checkUpdate) return;
        var button = ensureUpdateButton();
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

      // v3.1.2-fix：移除 bindQuitButton。它用 stopImmediatePropagation 拦截
      // click 事件，但选择器太宽泛可能匹配错误按钮，导致正常退出被阻止。
      // 普通关闭由主窗口隐藏保活；Ctrl+Q 与安装更新负责显式退出。

      function ensureChrome() {
        if (!document.body) return;
        document.querySelector('.dsh-drag-region')?.remove();
        bindSidebarTracker();
        bindUpdateButton();
        bindNativeDragRegion();
      }
      ensureChrome();
      if (!window.__dshChromeObserver) {
        var chromeDebounce = null;
        window.__dshChromeObserver = new MutationObserver(function () {
          if (chromeDebounce) return;
          chromeDebounce = setTimeout(function () {
            chromeDebounce = null;
            ensureChrome();
          }, 200);
        });
        window.__dshChromeObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    })();
  `);
}

async function injectDesktopTweaks() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.insertCSS(`
    /* v3.1.3（issue #6）：恢复任务看板显示。v2.2 曾按当时用户要求用 CSS 隐藏
       （[data-dsh-taskboard-*] { display:none }），导致桌面版侧边栏无「任务看板」
       条目而浏览器版正常。现移除该隐藏，看板数据本身完好（GET /api/task-board/state 200）。 */
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
    /* v3.1.3-fix：去掉 Web UI 的 HARNESS 启动加载画面（HARNESS 字标 + 转圈，与桌面壳 loading.html 重复） */
    div[class*="_boot_"] { display: none !important; }
    /* v3.1.3-fix：去掉侧边栏「技能中心」条目 */
    button[data-dsh-skill-explorer-entry] { display: none !important; }
    /* v3.1.3-fix：删除「退出 DeepSeek Harness」悬浮按钮（退出键失灵，直接移除入口） */
    div[data-dsh-shutdown-float="true"] { display: none !important; }
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
      // v4：顶级商店入口固定在“新会话”正下方。改用低频轮询（2.5s）而非
      // MutationObserver：better-sidebar 高频重写侧栏 DOM，观察器会与之形成
      // 正反馈（r3 崩溃根因）；轮询只在条目脱链时补插一次，不监听 DOM 变化。
      if (window.__dshStorePollTimer) clearInterval(window.__dshStorePollTimer);
      function sidebarColumn() {
        return document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      }
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
      function findNewSessionButton() {
        var column = sidebarColumn();
        if (!column) return null;
        var buttons = Array.prototype.slice.call(column.querySelectorAll('button'));
        var textMatch = buttons.find(function (button) {
          var text = (button.textContent || '').trim();
          return text === '新会话' || text.toLowerCase() === 'new session';
        });
        if (textMatch) return textMatch;
        return buttons.find(function (button) {
          var label = (button.getAttribute('aria-label') || '').trim();
          return label === '新建会话' || label === '新会话' || label.toLowerCase() === 'new session';
        }) || null;
      }
      function storeInsertionPoint() {
        var newSessionButton = findNewSessionButton();
        if (newSessionButton && newSessionButton.parentElement) {
          return { parent: newSessionButton.parentElement, before: newSessionButton.nextSibling };
        }
        return null;
      }
      function openStore() {
        function findMarketplaceTabs(scope) {
          var candidates = Array.prototype.slice.call((scope || document).querySelectorAll('[role="tab"], button'));
          var labels = ['插件市场', 'Plugin Market', 'DSH插件市场', 'DSH Plugin Marketplace'];
          var matches = [];
          for (var i = 0; i < labels.length; i++) {
            candidates.forEach(function (button) {
              if ((button.textContent || '').trim() === labels[i] && matches.indexOf(button) === -1) matches.push(button);
            });
          }
          candidates.forEach(function (button) {
            if (/插件市场|plugin\\s*market/i.test((button.textContent || '').trim()) && matches.indexOf(button) === -1) matches.push(button);
          });
          return matches;
        }
        function dshMarketReady() {
          return Boolean(document.querySelector('[data-dsh-market-root]'));
        }
        function tryClickDshMarket(attempts) {
          if (dshMarketReady()) return true;
          var dialog = document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          var marketTabs = findMarketplaceTabs(dialog);
          if (marketTabs.length === 0) return false;
          marketTabs[attempts % marketTabs.length].click();
          return dshMarketReady();
        }
        if (dshMarketReady()) return;
        var settingsButton = findSettingsButton();
        if (!document.querySelector('[role="dialog"]')) {
          if (!settingsButton) return;
          settingsButton.click();
        }
        var attempts = 0;
        var timer = setInterval(function () {
          if (tryClickDshMarket(attempts) || ++attempts > 24) clearInterval(timer);
        }, 250);
      }
      function syncStoreIcon() {
        var entry = document.querySelector('[data-dsh-store-entry]');
        if (!entry || !entry.isConnected) return;
        var col = sidebarColumn();
        var w = col ? col.getBoundingClientRect().width : 320;
        if (w > 0 && w < 72) entry.dataset.dshIcon = '';
        else delete entry.dataset.dshIcon;
      }
      // v3.1.3-fix：ResizeObserver 实时监听侧栏宽度，收起/展开立即切换图标/文字
      // （此前靠 2.5s 轮询，收起后文字会停留最长 2.5s）。ResizeObserver 只响应尺寸，
      // 不会与 better-sidebar 的高频 DOM 重写形成正反馈。
      function bindStoreIconResize() {
        var col = sidebarColumn();
        if (!col || col === window.__dshStoreObservedCol) return;
        if (window.__dshStoreResizeObserver) window.__dshStoreResizeObserver.disconnect();
        window.__dshStoreObservedCol = col;
        window.__dshStoreResizeObserver = new ResizeObserver(function () { syncStoreIcon(); });
        window.__dshStoreResizeObserver.observe(col);
      }
      function ensureStoreEntry() {
        var existing = document.querySelector('[data-dsh-store-entry]');
        if (!existing || !existing.isConnected) {
          var target = storeInsertionPoint();
          if (!target) return;
          var entry = document.createElement('button');
          entry.type = 'button';
          entry.dataset.dshStoreEntry = '';
          entry.setAttribute('aria-label', '插件商店');
          entry.title = '插件商店';
          entry.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;min-height:36px;box-sizing:border-box;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:8px;';
          entry.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h10l1 3H2l1-3z"/><path d="M2.5 5h11V14h-11V5z"/><path d="M6 7.5a2 2 0 0 0 4 0"/></svg><span>插件商店</span>';
          entry.addEventListener('click', openStore);
          var colNow = sidebarColumn();
          var wNow = colNow ? colNow.getBoundingClientRect().width : 320;
          if (wNow > 0 && wNow < 72) entry.dataset.dshIcon = '';
          target.parent.insertBefore(entry, target.before);
        }
        syncStoreIcon();
        bindStoreIconResize();
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

async function runBackendInjections() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents.getURL().startsWith(URL)) return;
  const injectionStartedAt = Date.now();
  try { await injectWindowChrome(); } catch (e) { log("inject error: " + e.message); }
  try { await injectDesktopTweaks(); } catch (e) { log("desktop tweaks error: " + e.message); }
  try { await injectTaskCompletionBridge(); } catch (e) { log("completion bridge error: " + e.message); }
  log("backend injections finished after " + (Date.now() - injectionStartedAt) + "ms");
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

// v3.0.1-fix：providers 迁移。3.0.0 升级后 settings.yaml 的 llm-pi-ai.providers
// 被重置为空对象 {}，但 .credentials.yaml 仍保留 DEEPSEEK_API_KEY。启动时检测该
// 不一致，从凭据恢复 deepseek-official provider 占位配置。
function reconcileProviders() {
  try {
    const dshDir = path.join(app.getPath("home"), ".dsh");
    const settingsPath = path.join(dshDir, "settings.yaml");
    const credentialsPath = path.join(dshDir, ".credentials.yaml");
    if (!fs.existsSync(settingsPath) || !fs.existsSync(credentialsPath)) return;
    const settings = fs.readFileSync(settingsPath, "utf8");
    if (!/llm-pi-ai:\s*\n\s*providers:\s*\{\s*\}/.test(settings)) return;
    const credentials = fs.readFileSync(credentialsPath, "utf8");
    const apiKeyMatch = credentials.match(/DEEPSEEK_API_KEY:\s*(sk-[A-Za-z0-9]+)/);
    if (!apiKeyMatch) {
      log("reconcileProviders: 凭据中未找到 DEEPSEEK_API_KEY，跳过");
      return;
    }
    const apiKey = apiKeyMatch[1];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = path.join(dshDir, `settings.yaml.bak-reconcile-${stamp}`);
    try { fs.copyFileSync(settingsPath, backupPath); } catch (e) {}
    const newSettings = settings.replace(
      /llm-pi-ai:\s*\n\s*providers:\s*\{\s*\}/,
      `llm-pi-ai:\n  providers:\n    deepseek-official:\n      apiKey: ${apiKey}\n      baseURL: https://api.deepseek.com`
    );
    fs.writeFileSync(settingsPath, newSettings, "utf8");
    log("reconcileProviders: deepseek-official provider 已从凭据恢复（备份: " + path.basename(backupPath) + "）");
  } catch (e) {
    log("reconcileProviders failed: " + e.message);
  }
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

function layoutStartupOverlay() {
  if (!mainWindow || mainWindow.isDestroyed() || !startupView) return;
  const { width, height } = mainWindow.getContentBounds();
  startupView.setBounds({ x: 0, y: 0, width, height });
}

function createStartupOverlay() {
  startupView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  startupView.setBackgroundColor("#00000000");
  mainWindow.contentView.addChildView(startupView);
  layoutStartupOverlay();
  startupView.webContents.loadFile(path.join(__dirname, "loading.html"))
    .catch((e) => log("startup overlay error: " + e.message));
}

function startupWebContents() {
  if (startupView && !startupView.webContents.isDestroyed()) return startupView.webContents;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.webContents;
  return null;
}

async function waitForBackendPaint() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const paintState = await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const startedAt = performance.now();
      const deadline = performance.now() + 1500;
      const inspect = () => {
        const body = document.body;
        const root = body && (body.querySelector('#root') || body);
        const textLength = root ? root.innerText.trim().length : 0;
        const buttonCount = root ? root.querySelectorAll('button').length : 0;
        const hasEditor = Boolean(root && [...root.querySelectorAll(
          'textarea, [contenteditable="true"], [role="textbox"]'
        )].some((element) => {
          const label = [
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
            element.getAttribute('data-placeholder'),
          ].filter(Boolean).join(' ');
          return element.tagName === 'TEXTAREA' || element.isContentEditable
            || /消息|message|智能体/i.test(label);
        }));
        const ready = textLength > 40 && buttonCount >= 3 && hasEditor;
        const timedOut = performance.now() >= deadline;
        if (ready || timedOut) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({
            elapsedMs: Math.round(performance.now() - startedAt),
            timedOut,
            textLength,
            buttonCount,
            hasEditor,
          })));
          return;
        }
        setTimeout(inspect, 50);
      };
      inspect();
    })
  `).catch((e) => log("backend paint wait failed: " + e.message));
  if (paintState) log("backend paint-ready " + JSON.stringify(paintState));
}

function startBackendNavigation() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  if (backendNavigationPromise) return backendNavigationPromise;
  startupEntryArmed = true;
  const navigation = (async () => {
    let navigationFailed = false;
    const prepared = new Promise((resolve) => { backendPagePreparedResolve = resolve; });
    log("backend navigation started behind overlay");
    mainWindow.loadURL(URL).catch((e) => {
      navigationFailed = true;
      log("load error: " + e.message);
      if (backendPagePreparedResolve) backendPagePreparedResolve();
    });
    let preparedTimer;
    await Promise.race([
      prepared,
      new Promise((resolve) => { preparedTimer = setTimeout(resolve, 4000); }),
    ]);
    clearTimeout(preparedTimer);
    backendPagePreparedResolve = null;
    return !navigationFailed && Boolean(mainWindow && !mainWindow.isDestroyed());
  })();
  backendNavigationPromise = navigation;
  void navigation.then((ready) => {
    if (!ready && backendNavigationPromise === navigation) backendNavigationPromise = null;
  });
  return navigation;
}

async function transitionToBackend() {
  if (!await startBackendNavigation() || !mainWindow || mainWindow.isDestroyed()) return;
  revealBackendEntry();
  let paintFallbackTimer;
  await Promise.race([
    waitForBackendPaint(),
    new Promise((resolve) => {
      paintFallbackTimer = setTimeout(() => {
        log("backend paint-ready main-process fallback after 1600ms");
        resolve();
      }, 1600);
    }),
  ]);
  clearTimeout(paintFallbackTimer);
  if (!startupView || startupView.webContents.isDestroyed()) return;
  const transition = startupView.webContents.executeJavaScript(`
    typeof window.dshBeginStartupExit === 'function'
      ? window.dshBeginStartupExit()
      : Promise.resolve()
  `).catch((e) => log("startup exit transition failed: " + e.message));
  let fallbackTimer;
  await Promise.race([
    transition,
    new Promise((resolve) => { fallbackTimer = setTimeout(resolve, 560); }),
  ]);
  clearTimeout(fallbackTimer);
  if (mainWindow && !mainWindow.isDestroyed() && startupView) {
    const completedView = startupView;
    startupView = null;
    mainWindow.contentView.removeChildView(completedView);
    if (!completedView.webContents.isDestroyed()) completedView.webContents.close();
    void runBackendInjections();
  }
}

async function revealBackendEntry() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.executeJavaScript(`
    document.documentElement.classList.add('dsh-startup-entered')
  `).catch((e) => log("startup entry transition failed: " + e.message));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "DeepSeek Harness",
    frame: false,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121214" : "#f9fafb",
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "loading.html")).catch((e) => log("loading page error: " + e.message));
  createStartupOverlay();
  createControlsOverlay().catch((e) => log("controls overlay error: " + e.message));
  mainWindow.webContents.on("dom-ready", () => {
    const backendDocument = mainWindow && !mainWindow.isDestroyed()
      && mainWindow.webContents.getURL().startsWith(URL);
    if (!backendDocument) return;
    if (backendPagePreparedResolve) backendPagePreparedResolve();
    void revealBackendEntry();
    if (startupView) return;
    void runBackendInjections();
  });
  mainWindow.on("maximize", () => updateMaximizedChrome(true));
  mainWindow.on("unmaximize", () => updateMaximizedChrome(false));
  mainWindow.on("resize", layoutStartupOverlay);
  mainWindow.on("close", (event) => {
    if (isQuitting || installInFlight) return;
    event.preventDefault();
    mainWindow.hide();
    log("window hidden for instant reopen");
  });
  mainWindow.on("closed", () => {
    stopControlsMotion();
    mainWindow = null;
    controlsView = null;
    startupView = null;
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
  log("window restored from second instance");
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
  if (installInFlight) return true;
  installInFlight = true;
  log("installing downloaded update");
  // v3.1.2-deep：彻底修复"更新时无法关闭"。旧流程 quitAndInstall(false,true)
  // 的三层缺陷：①非静默安装器弹"无法关闭 DeepSeekHarness"+重试死循环；②后端
  // 被杀后 respawn 逻辑 1s 内重启运行时并重新锁住安装目录；③残留的 esbuild/
  // ripgrep/conpty 子进程锁文件占用端口。修复：先标记退出（阻断 respawn）→
  // 杀整棵进程树（释放文件锁与端口）→ 静默安装（无对话框）→ 看门狗兜底强退。
  isQuitting = true;
  stopBackendForUpdate();
  try { if (controlsView) { controlsView = null; } } catch (e) {}
  autoUpdater.quitAndInstall(true, true);
  // 看门狗：若 app.quit() 被未知句柄阻塞，4s 后直接拉起安装器并强退自身。
  // 安装器已由 quitAndInstall 以 detached 模式拉起；此处二次拉起会被 NSIS
  // 互斥锁安全忽略，不影响安装。
  const installer = pendingInstallerPath;
  setTimeout(() => {
    log("update watchdog: forcing exit");
    try {
      if (installer && fs.existsSync(installer)) {
        spawn(installer, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      }
    } catch (e) { log("watchdog spawn failed: " + e.message); }
    setTimeout(() => app.exit(0), 800);
  }, 4000).unref();
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
    configureLoginPrewarm();
    loadControlState();

    if (!isDaemonPrewarm) {
      createWindow();
      initializeUpdater();
      log("window created");
    }

    // 先把本地壳交给 Chromium 绘制，再执行运行时兼容和 profile 准备。
    await new Promise((resolve) => setImmediate(resolve));
    healOrphanedSettingsLock();
    applyRuntimePatches();
    reconcileProviders();

    if (!isDaemonPrewarm) {
      try {
        globalShortcut.register("CommandOrControl+Q", () => {
          log("quit via Ctrl+Q shortcut");
          isQuitting = true;
          app.quit();
        });
      } catch (e) { log("global shortcut register failed: " + e.message); }
    }

    const ok = await ensurePersistentBackend();
    if (isDaemonPrewarm) {
      log(`daemon prewarm completed ok=${ok}`);
      app.quit();
      return;
    }
    // v3.1：后端就绪后再挂清单监视器（启动期 pnpm 自检不再触发重载）。
    // 更新检查仍只由用户点击侧栏按钮发起（见 tests/manual_runtime_v2.test.js 契约）。
    watchProfileChanges();
    if (!ok) {
      log("backend failed");
      if (mainWindow && !mainWindow.isDestroyed()) {
        const loadingContents = startupWebContents();
        if (loadingContents) loadingContents.executeJavaScript(`
          document.querySelector('[data-status]').textContent = '启动失败，请关闭后重试';
          document.querySelector('[data-detail]').textContent = 'DeepSeek Harness 后端未能在 150 秒内启动。';
          document.querySelector('.spinner').hidden = true;
        `).catch(() => {});
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      await transitionToBackend();
      if (benchmarkHideAfterReady) {
        mainWindow.hide();
        log("benchmark window hidden");
      }
    }
  });
}

app.on("window-all-closed", () => {
  try { globalShortcut.unregisterAll(); } catch (e) {}
  isQuitting = true;
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
});
