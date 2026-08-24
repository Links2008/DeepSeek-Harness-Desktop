// DeepSeek Harness preload:暴露窗口控制(最小化/最大化/关闭)
const { contextBridge, ipcRenderer, webFrame } = require("electron");

if (location.origin === "http://127.0.0.1:3080" && ipcRenderer.sendSync("startup:consume-entry")) {
  webFrame.insertCSS(`
    html {
      opacity: 0;
      transform: translateY(6px);
    }
    html.dsh-startup-entered {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 210ms cubic-bezier(.23, 1, .32, 1), transform 210ms cubic-bezier(.23, 1, .32, 1);
    }
    @media (prefers-reduced-motion: reduce) {
      html { transform: none; }
      html.dsh-startup-entered { transition: opacity 60ms linear; }
    }
  `);
  window.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("dsh-startup-entered");
  }, { once: true });
}

contextBridge.exposeInMainWorld("dshWin", {
  min: (options) => ipcRenderer.send("win:min", options),
  max: (options) => ipcRenderer.send("win:max", options),
  close: (options) => ipcRenderer.send("win:close", options),
  taskComplete: (details) => ipcRenderer.send("task:complete", details),
  sidebarState: (details) => ipcRenderer.send("win:sidebar-state", details),
  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  getUpdateState: () => ipcRenderer.invoke("app:get-update-state"),
  onUpdateState: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("app:update-state", wrapped);
    return () => ipcRenderer.removeListener("app:update-state", wrapped);
  },
});
