import { contextBridge, ipcRenderer } from "electron";
import type { ApiBridge, AppPlatform } from "@shared/ipc-contract";

const api: ApiBridge = {
  secureStore: {
    get: (key) => ipcRenderer.invoke("secure-store:get", key),
    set: (key, value) => ipcRenderer.invoke("secure-store:set", key, value),
    delete: (key) => ipcRenderer.invoke("secure-store:delete", key),
  },
  appInfo: {
    version: () => ipcRenderer.invoke("app:version"),
    platform: () => process.platform as AppPlatform,
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
    showInFolder: (path) => ipcRenderer.send("system:show-in-folder", path),
  },
};

contextBridge.exposeInMainWorld("api", api);
