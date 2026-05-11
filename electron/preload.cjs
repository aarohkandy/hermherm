const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hermherm", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  hermes: {
    status: () => ipcRenderer.invoke("hermes:status"),
    bootstrapWsl: () => ipcRenderer.invoke("hermes:bootstrap-wsl"),
    chat: (payload) => ipcRenderer.invoke("hermes:chat", payload),
    rerunDeep: (payload) => ipcRenderer.invoke("hermes:rerun-deep", payload),
    retryDeepDownload: () => ipcRenderer.invoke("hermes:retry-deep"),
  },
  visuals: {
    tools: () => ipcRenderer.invoke("visuals:tools"),
  },
});
