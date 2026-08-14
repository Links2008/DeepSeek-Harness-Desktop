// DeepSeek Harness preload:暴露窗口控制(最小化/最大化/关闭)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dshWin", {
  min: (options) => ipcRenderer.send("win:min", options),
  max: (options) => ipcRenderer.send("win:max", options),
  close: (options) => ipcRenderer.send("win:close", options),
  taskComplete: (details) => ipcRenderer.send("task:complete", details),
});
