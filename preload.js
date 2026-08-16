// DeepSeek Harness preload:暴露窗口控制(最小化/最大化/关闭)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dshWin", {
  min: (options) => ipcRenderer.send("win:min", options),
  max: (options) => ipcRenderer.send("win:max", options),
  close: (options) => ipcRenderer.send("win:close", options),
  taskComplete: (details) => ipcRenderer.send("task:complete", details),
  sidebarFrame: (width) => ipcRenderer.send("win:sidebar-frame", width),
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
