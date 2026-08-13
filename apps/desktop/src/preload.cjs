const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  grantFolder: () => ipcRenderer.invoke("desktop.grantFolder"),
  listGrants: () => ipcRenderer.invoke("desktop.listGrants"),
  readGranted: (filePath) => ipcRenderer.invoke("desktop.readGranted", filePath),
  writeGranted: (filePath, content) => ipcRenderer.invoke("desktop.writeGranted", filePath, content),
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
  },
});
