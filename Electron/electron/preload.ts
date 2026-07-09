import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiBridge,
  AppPlatform,
  ScannerStatus,
  ScannerTransport,
  ScannerOpenOpts,
  PrinterSendOpts,
  ScaleReadOpts,
} from "@shared/ipc-contract";

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
  power: {
    getSystemIdleTime: () => ipcRenderer.invoke("power:get-system-idle-time"),
  },
  scanner: {
    list: (transport: ScannerTransport) => ipcRenderer.invoke("scanner:list", transport),
    open: (opts: ScannerOpenOpts) => ipcRenderer.invoke("scanner:open", opts),
    close: () => ipcRenderer.invoke("scanner:close"),
    status: () => ipcRenderer.invoke("scanner:status"),
    mockEmit: (code: string) => ipcRenderer.send("scanner:mock-emit", code),
    onData: (cb: (code: string) => void) => {
      const listener = (_e: unknown, code: string) => cb(code);
      ipcRenderer.on("scanner:data", listener);
      return () => ipcRenderer.removeListener("scanner:data", listener);
    },
    onStatus: (cb: (status: ScannerStatus) => void) => {
      const listener = (_e: unknown, status: ScannerStatus) => cb(status);
      ipcRenderer.on("scanner:status", listener);
      return () => ipcRenderer.removeListener("scanner:status", listener);
    },
  },
  printer: {
    listSerial: () => ipcRenderer.invoke("printer:list-serial"),
    listCups: () => ipcRenderer.invoke("printer:list-cups"),
    listWinspool: () => ipcRenderer.invoke("printer:list-winspool"),
    send: (opts: PrinterSendOpts) => ipcRenderer.invoke("printer:send", opts),
  },
  scale: {
    read: (opts: ScaleReadOpts) => ipcRenderer.invoke("scale:read", opts),
  },
};

contextBridge.exposeInMainWorld("api", api);
