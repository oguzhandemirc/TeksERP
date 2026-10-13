import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiBridge,
  AppPlatform,
  ScannerStatus,
  ScannerTransport,
  ScannerOpenOpts,
  PrinterSendOpts,
  ScaleReadOpts,
  PdfSaveOpts,
  PdfSaveBatchOpts,
  PdfLicenseMetaInput,
  FilesSaveBatchOpts,
  FileSaveOpts,
  UpdateStatus,
} from "@shared/ipc-contract";
import type { LicenseRelayRequest } from "@shared/license-relay";
import { isAppDocumentUrl, readAppEntryArgument } from "@shared/app-origin";
import { PDF_BATCH_PROGRESS_CHANNEL, parsePdfBatchProgress } from "@shared/pdf-progress";
import { LOOM_ALARM_NOTIFY_CHANNEL, LOOM_ALARM_OPEN_CHANNEL, parseLoomAlarmOpenEvent } from "@shared/loom-alarm-notify";

const api: ApiBridge = {
  secureStore: {
    get: (key) => ipcRenderer.invoke("secure-store:get", key),
    set: (key, value) => ipcRenderer.invoke("secure-store:set", key, value),
    delete: (key) => ipcRenderer.invoke("secure-store:delete", key),
  },
  discovery: {
    state: () => ipcRenderer.invoke("discovery:state"),
    start: (opts) => ipcRenderer.invoke("discovery:start", opts),
    probe: (baseUrl: string) => ipcRenderer.invoke("discovery:probe", baseUrl),
    pin: (installationId: string | null) => ipcRenderer.invoke("discovery:pin", installationId),
    tlsObserve: (baseUrl: string) => ipcRenderer.invoke("discovery:tlsObserve", baseUrl),
    tlsPin: (req) => ipcRenderer.invoke("discovery:tlsPin", req),
    tlsUnpin: (installationId: string | null) => ipcRenderer.invoke("discovery:tlsUnpin", installationId),
    tlsPins: () => ipcRenderer.invoke("discovery:tlsPins"),
    lanHosts: () => ipcRenderer.invoke("discovery:lanHosts"),
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
    captureScreenshot: () => ipcRenderer.invoke("window:capture-screenshot"),
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
  pdf: {
    save: (opts: PdfSaveOpts) => ipcRenderer.invoke("pdf:save", opts),
    saveBatch: (opts: PdfSaveBatchOpts) => ipcRenderer.invoke("pdf:saveBatch", opts),
    setLicenseMeta: (meta: PdfLicenseMetaInput | null) => ipcRenderer.invoke("pdf:setLicenseMeta", meta),
    onBatchProgress: (cb) => {
      const listener = (_e: unknown, payload: unknown) => {
        const p = parsePdfBatchProgress(payload);
        if (p) cb(p);
      };
      ipcRenderer.on(PDF_BATCH_PROGRESS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(PDF_BATCH_PROGRESS_CHANNEL, listener);
    },
  },
  files: {
    save: (opts: FileSaveOpts) => ipcRenderer.invoke("files:save", opts),
    saveBatch: (opts: FilesSaveBatchOpts) => ipcRenderer.invoke("files:saveBatch", opts),
  },
  updater: {
    status: () => ipcRenderer.invoke("updater:status"),
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.send("updater:install"),
    defer: () => ipcRenderer.send("updater:defer"),
    setFeedUrl: (url: string | null) => ipcRenderer.invoke("updater:set-feed-url", url),
    onStatus: (cb: (status: UpdateStatus) => void) => {
      const listener = (_e: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on("updater:status", listener);
      return () => ipcRenderer.removeListener("updater:status", listener);
    },
  },
  license: {
    relay: (req: LicenseRelayRequest) => ipcRenderer.invoke("license:relay", req),
  },
  tvWindow: {
    displays: () => ipcRenderer.invoke("tv-window:displays"),
    // Yalnız ekran kimliği geçer — adres ana süreçte kurulur (keyfi URL açılamaz).
    open: (req) => ipcRenderer.invoke("tv-window:open", { displayId: req.displayId }),
    onClosed: (cb) => {
      const listener = (_e: unknown, payload: { byUser: boolean }) => cb({ byUser: payload?.byUser === true });
      ipcRenderer.on("tv-window:closed", listener);
      return () => ipcRenderer.removeListener("tv-window:closed", listener);
    },
  },
  loomAlarm: {
    // Yalnız alarm kimliği + düz metin geçer (adres/ek alan düşer); ana süreç yeniden doğrular.
    notify: (req) => ipcRenderer.invoke(LOOM_ALARM_NOTIFY_CHANNEL, { alarmId: req.alarmId, title: req.title, body: req.body }),
    onOpen: (cb) => {
      const listener = (_e: unknown, payload: unknown) => {
        const alarmId = parseLoomAlarmOpenEvent(payload);
        if (alarmId) cb(alarmId);
      };
      ipcRenderer.on(LOOM_ALARM_OPEN_CHANNEL, listener);
      return () => ipcRenderer.removeListener(LOOM_ALARM_OPEN_CHANNEL, listener);
    },
  },
};

// Köprü YALNIZ uygulamanın kendi belgesine açılır: giriş adresi ana süreçten
// (`additionalArguments`) gelir. Splash ve pencereye herhangi bir yoldan yüklenmiş
// yabancı belge (ör. ağ paylaşımındaki sayfa) `window.api` ALMAZ.
const appEntry = readAppEntryArgument(process.argv);
if (isAppDocumentUrl(window.location.href, appEntry, process.platform)) {
  contextBridge.exposeInMainWorld("api", api);
}
