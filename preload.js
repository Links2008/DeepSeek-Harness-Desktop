// DeepSeek Harness preload:暴露窗口控制(最小化/最大化/关闭)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dshWin", {
  min: () => ipcRenderer.send("win:min"),
  max: () => ipcRenderer.send("win:max"),
  close: () => ipcRenderer.send("win:close"),
});
