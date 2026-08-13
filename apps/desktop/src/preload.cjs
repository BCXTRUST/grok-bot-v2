const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  grantFolder: () => ipcRenderer.invoke("desktop.grantFolder"),
  listGrants: () => ipcRenderer.invoke("desktop.listGrants"),
  readGranted: (filePath) => ipcRenderer.invoke("desktop.readGranted", filePath),
  writeGranted: (filePath, content) => ipcRenderer.invoke("desktop.writeGranted", filePath, content),
});
