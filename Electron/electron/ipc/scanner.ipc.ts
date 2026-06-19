import { ipcMain, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { createScanFramer, sanitizeHidChunk, type ScanFramer } from "@shared/scan-framer.js";
import type {
  ScannerListResult,
  ScannerOpenOpts,
  ScannerStatus,
  ScannerTransport,
  ScannerDeviceInfo,
} from "@shared/ipc-contract.js";

// ESM main → CJS native modülleri createRequire ile, TEMBEL ve try/catch'li
// yükle. Native binary Electron ABI'sine derlenmemişse (electron:rebuild
// yapılmadıysa) modül require'da hata verir → "available:false" döner,
// uygulama ASLA çökmemeli. Gerçek cihaz için `npm run electron:rebuild`.
const req = createRequire(import.meta.url);

// --- Minimal native modül tipleri (no `any`) ---
interface SerialPortInstance {
  on(event: "data", listener: (data: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  close(callback?: (err?: Error | null) => void): void;
}
interface SerialPortListItem {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}
interface SerialPortCtor {
  new (opts: { path: string; baudRate: number }): SerialPortInstance;
  list(): Promise<SerialPortListItem[]>;
}
interface SerialportModule {
  SerialPort: SerialPortCtor;
}

interface HidInstance {
  on(event: "data", listener: (data: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  close(): void;
}
interface HidDeviceInfo {
  path?: string;
  vendorId: number;
  productId: number;
  product?: string;
  manufacturer?: string;
}
interface HidCtor {
  new (path: string): HidInstance;
  new (vid: number, pid: number): HidInstance;
}
interface NodeHidModule {
  HID: HidCtor;
  devices(): HidDeviceInfo[];
}

function loadSerial(): { mod?: SerialportModule; error?: string } {
  try {
    return { mod: req("serialport") as SerialportModule };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
function loadHid(): { mod?: NodeHidModule; error?: string } {
  try {
    return { mod: req("node-hid") as NodeHidModule };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// --- Aktif cihaz yöneticisi (tekil) ---
interface ActiveHandle {
  close: () => void;
}
let active: ActiveHandle | null = null;
let framer: ScanFramer | null = null;
let status: ScannerStatus = { connected: false, transport: null, path: null, error: null };

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function setStatus(next: Partial<ScannerStatus>): void {
  status = { ...status, ...next };
  broadcast("scanner:status", status);
}

/** Çerçevelenmiş tam kodu renderer'a gönder. */
function emitCode(code: string): void {
  const trimmed = code.trim();
  if (trimmed) broadcast("scanner:data", trimmed);
}

function onChunk(text: string): void {
  if (!framer) return;
  for (const code of framer.push(text)) emitCode(code);
}

function closeActive(): void {
  if (active) {
    try {
      active.close();
    } catch {
      /* yut — zaten kapanıyor olabilir */
    }
    active = null;
  }
  framer = null;
}

function openSerial(opts: ScannerOpenOpts): ScannerStatus {
  const { mod, error } = loadSerial();
  if (!mod) {
    setStatus({ connected: false, transport: "serial", path: opts.path, error: error ?? "serialport yüklenemedi" });
    return status;
  }
  try {
    const port = new mod.SerialPort({ path: opts.path, baudRate: opts.baudRate ?? 9600 });
    framer = createScanFramer(opts.terminator ?? "lf");
    port.on("data", (buf) => onChunk(buf.toString("utf8")));
    port.on("error", (err) => setStatus({ connected: false, error: err.message }));
    port.on("close", () => setStatus({ connected: false }));
    active = { close: () => port.close() };
    setStatus({ connected: true, transport: "serial", path: opts.path, error: null });
  } catch (e) {
    setStatus({ connected: false, transport: "serial", path: opts.path, error: (e as Error).message });
  }
  return status;
}

function openHid(opts: ScannerOpenOpts): ScannerStatus {
  const { mod, error } = loadHid();
  if (!mod) {
    setStatus({ connected: false, transport: "hid", path: opts.path, error: error ?? "node-hid yüklenemedi" });
    return status;
  }
  try {
    const dev =
      opts.path
        ? new mod.HID(opts.path)
        : new mod.HID(opts.vendorId ?? 0, opts.productId ?? 0);
    framer = createScanFramer(opts.terminator ?? "lf");
    dev.on("data", (buf) => onChunk(sanitizeHidChunk(buf)));
    dev.on("error", (err) => setStatus({ connected: false, error: err.message }));
    active = { close: () => dev.close() };
    setStatus({ connected: true, transport: "hid", path: opts.path, error: null });
  } catch (e) {
    setStatus({ connected: false, transport: "hid", path: opts.path, error: (e as Error).message });
  }
  return status;
}

function openMock(opts: ScannerOpenOpts): ScannerStatus {
  closeActive();
  framer = createScanFramer(opts.terminator ?? "lf");
  active = { close: () => undefined };
  setStatus({ connected: true, transport: "mock", path: "mock", error: null });
  return status;
}

function listDevices(transport: ScannerTransport): Promise<ScannerListResult> {
  if (transport === "mock") {
    return Promise.resolve({
      available: true,
      error: null,
      devices: [{ path: "mock", label: "Sahte cihaz (test)" }],
    });
  }
  if (transport === "serial") {
    const { mod, error } = loadSerial();
    if (!mod) return Promise.resolve({ available: false, error: error ?? null, devices: [] });
    return mod.SerialPort.list()
      .then((ports): ScannerListResult => ({
        available: true,
        error: null,
        devices: ports.map(
          (p): ScannerDeviceInfo => ({
            path: p.path,
            label: [p.manufacturer, p.path].filter(Boolean).join(" — ") || p.path,
            vendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
            productId: p.productId ? parseInt(p.productId, 16) : undefined,
          }),
        ),
      }))
      .catch((e: Error) => ({ available: true, error: e.message, devices: [] }));
  }
  // hid
  const { mod, error } = loadHid();
  if (!mod) return Promise.resolve({ available: false, error: error ?? null, devices: [] });
  try {
    const devices = mod.devices().map(
      (d): ScannerDeviceInfo => ({
        path: d.path ?? "",
        label:
          [d.manufacturer, d.product].filter(Boolean).join(" ") ||
          `HID ${d.vendorId}:${d.productId}`,
        vendorId: d.vendorId,
        productId: d.productId,
      }),
    );
    return Promise.resolve({ available: true, error: null, devices: devices.filter((d) => d.path) });
  } catch (e) {
    return Promise.resolve({ available: true, error: (e as Error).message, devices: [] });
  }
}

export function registerScannerIpc(): void {
  ipcMain.handle("scanner:list", (_e, transport: ScannerTransport) => listDevices(transport));

  ipcMain.handle("scanner:open", (_e, opts: ScannerOpenOpts) => {
    closeActive();
    if (opts.transport === "serial") return openSerial(opts);
    if (opts.transport === "hid") return openHid(opts);
    return openMock(opts);
  });

  ipcMain.handle("scanner:close", () => {
    closeActive();
    setStatus({ connected: false, transport: null, path: null, error: null });
    return status;
  });

  ipcMain.handle("scanner:status", () => status);

  // Donanımsız boru hattı testi: sahte tam kod enjekte et (çerçeveleme atlanır).
  ipcMain.on("scanner:mock-emit", (_e, code: string) => emitCode(String(code)));
}
