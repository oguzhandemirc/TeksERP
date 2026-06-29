import { ipcMain } from "electron";
import { createRequire } from "node:module";
import net from "node:net";
import type {
  PrinterSendOpts,
  PrinterSendResult,
  ScannerListResult,
  ScannerDeviceInfo,
} from "@shared/ipc-contract.js";

// ESM main → CJS native modülü (serialport) createRequire ile TEMBEL + try/catch.
// Electron ABI'sine derlenmemişse (electron:rebuild yapılmadıysa) require hata
// verir → available:false; uygulama ASLA çökmez. TCP için Node core `net` (yerleşik).
// Varsayılan Electron baskısı HTML + OS sürücüsüdür; bu yol opsiyonel native gönderim.
const req = createRequire(import.meta.url);

interface SerialPortInstance {
  write(data: Buffer, cb?: (err?: Error | null) => void): boolean;
  drain(cb?: (err?: Error | null) => void): void;
  close(cb?: (err?: Error | null) => void): void;
  on(event: "open", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}
interface SerialPortListItem {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}
interface SerialPortCtor {
  new (opts: { path: string; baudRate: number; autoOpen?: boolean }): SerialPortInstance;
  list(): Promise<SerialPortListItem[]>;
}
interface SerialportModule {
  SerialPort: SerialPortCtor;
}

function loadSerial(): { mod?: SerialportModule; error?: string } {
  try {
    return { mod: req("serialport") as SerialportModule };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function listSerial(): Promise<ScannerListResult> {
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

function sendTcp(opts: PrinterSendOpts): Promise<PrinterSendResult> {
  const buf = Buffer.from(opts.content, "latin1");
  const port = opts.port ?? 9100;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (r: PrinterSendResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(5000);
    socket.once("error", (e) => done({ ok: false, bytes: 0, available: true, error: e.message }));
    socket.once("timeout", () => done({ ok: false, bytes: 0, available: true, error: "Bağlantı zaman aşımı" }));
    socket.connect(port, opts.target, () => {
      socket.write(buf, () => socket.end(() => done({ ok: true, bytes: buf.length, available: true, error: null })));
    });
  });
}

function sendSerial(opts: PrinterSendOpts): Promise<PrinterSendResult> {
  const { mod, error } = loadSerial();
  if (!mod) return Promise.resolve({ ok: false, bytes: 0, available: false, error: error ?? "serialport yüklenemedi" });
  const buf = Buffer.from(opts.content, "latin1");
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PrinterSendResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const sp = new mod.SerialPort({ path: opts.target, baudRate: opts.baudRate ?? 9600, autoOpen: true });
      sp.on("error", (e) => done({ ok: false, bytes: 0, available: true, error: e.message }));
      sp.on("open", () => {
        sp.write(buf, (err) => {
          if (err) return done({ ok: false, bytes: 0, available: true, error: err.message });
          sp.drain(() => sp.close(() => done({ ok: true, bytes: buf.length, available: true, error: null })));
        });
      });
    } catch (e) {
      done({ ok: false, bytes: 0, available: true, error: (e as Error).message });
    }
  });
}

export function registerPrinterIpc(): void {
  ipcMain.handle("printer:list-serial", () => listSerial());
  ipcMain.handle("printer:send", (_e, opts: PrinterSendOpts) => {
    if (!opts?.content) return Promise.resolve({ ok: false, bytes: 0, available: true, error: "İçerik boş" });
    return opts.transport === "serial" ? sendSerial(opts) : sendTcp(opts);
  });
}
