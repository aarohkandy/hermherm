const { contextBridge } = require("node:electron");

contextBridge.exposeInMainWorld("hermherm", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
});
