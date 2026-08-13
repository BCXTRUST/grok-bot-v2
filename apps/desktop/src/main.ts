import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const WEB_URL = process.env.RAKAZO_WEB_URL ?? "http://127.0.0.1:5173";

function grantsFile() {
  return path.join(app.getPath("userData"), "folder-grants.json");
}

function loadGrants(): string[] {
  try {
    return JSON.parse(readFileSync(grantsFile(), "utf8")) as string[];
  } catch {
    return [];
  }
}

function saveGrants(grants: string[]) {
  mkdirSync(path.dirname(grantsFile()), { recursive: true });
  writeFileSync(grantsFile(), JSON.stringify(grants, null, 2));
}

function assertGranted(filePath: string) {
  const resolved = path.resolve(filePath);
  const ok = loadGrants().some((grant) => resolved === grant || resolved.startsWith(grant + path.sep));
  if (!ok) throw new Error("Folder is not granted");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#050506",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  void win.loadURL(WEB_URL);
}

app.whenReady().then(() => {
  ipcMain.handle("desktop.grantFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const folder = result.filePaths[0];
    if (!folder) return null;
    const grants = loadGrants();
    if (!grants.includes(folder)) {
      grants.push(folder);
      saveGrants(grants);
    }
    return folder;
  });
  ipcMain.handle("desktop.listGrants", () => loadGrants());
  ipcMain.handle("desktop.readGranted", (_event, filePath: string) => {
    assertGranted(filePath);
    if (!existsSync(filePath)) throw new Error("Missing file");
    return readFileSync(filePath, "utf8");
  });
  ipcMain.handle("desktop.writeGranted", (_event, filePath: string, content: string) => {
    assertGranted(filePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    return true;
  });
  createWindow();
});
