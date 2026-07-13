import { ipcMain } from "electron";
import { createRequire } from "node:module";
import net from "node:net";
import { spawn } from "node:child_process";
import { sendWinspool, listWinspool } from "./winspool.js";
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

function sendTcp(opts: PrinterSendOpts, buf: Buffer): Promise<PrinterSendResult> {
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

function sendSerial(opts: PrinterSendOpts, buf: Buffer): Promise<PrinterSendResult> {
  const { mod, error } = loadSerial();
  if (!mod) return Promise.resolve({ ok: false, bytes: 0, available: false, error: error ?? "serialport yüklenemedi" });
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

// macOS/Linux CUPS: ham PPLB/PPLA'yı `lp -d <kuyruk> -o raw` ile stdin'den yazıcıya.
// USB printer-class cihaz seri düğümü açmadığı için Mac'te tek doğru yol budur.
// Windows'ta lp yoktu → spawn "error" → available:false (uygulama çökmez).
function sendCups(opts: PrinterSendOpts, buf: Buffer): Promise<PrinterSendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PrinterSendResult) => { if (settled) return; settled = true; resolve(r); };
    try {
      const child = spawn("lp", ["-d", opts.target, "-o", "raw"], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (c) => (stderr += String(c)));
      child.on("error", (e) => done({ ok: false, bytes: 0, available: false, error: `lp çalıştırılamadı: ${e.message}` }));
      child.on("close", (code) =>
        code === 0
          ? done({ ok: true, bytes: buf.length, available: true, error: null })
          : done({ ok: false, bytes: 0, available: true, error: stderr.trim() || `lp çıkış kodu ${code}` }),
      );
      child.stdin?.on("error", () => { /* EPIPE: error handler zaten döner */ });
      child.stdin?.end(buf);
    } catch (e) {
      done({ ok: false, bytes: 0, available: false, error: (e as Error).message });
    }
  });
}

// CUPS kuyruklarını listele (lpstat -e — sürücüsüz/raw dahil tüm hedefler).
function listCups(): Promise<ScannerListResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn("lpstat", ["-e"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout?.on("data", (c) => (out += String(c)));
      child.stderr?.on("data", (c) => (err += String(c)));
      child.on("error", (e) => resolve({ available: false, error: e.message, devices: [] }));
      child.on("close", (code) => {
        if (code !== 0 && !out.trim()) {
          resolve({ available: false, error: err.trim() || `lpstat çıkış ${code}`, devices: [] });
          return;
        }
        const devices: ScannerDeviceInfo[] = out
          .split("\n").map((s) => s.trim()).filter(Boolean)
          .map((name) => ({ path: name, label: name }));
        resolve({ available: true, error: null, devices });
      });
    } catch (e) {
      resolve({ available: false, error: (e as Error).message, devices: [] });
    }
  });
}

export function registerPrinterIpc(): void {
  ipcMain.handle("printer:list-serial", () => listSerial());
  ipcMain.handle("printer:list-cups", () => listCups());
  ipcMain.handle("printer:list-winspool", () => listWinspool());
  ipcMain.handle("printer:send", (_e, opts: PrinterSendOpts) => {
    // TEK NOKTADA string→Buffer ayrımı: contentB64 (raster/binary) öncelikli, yoksa
    // content (latin1 komut). Aşağıdaki transportlar artık hazır Buffer alır.
    const payload =
      opts?.contentB64 != null
        ? Buffer.from(opts.contentB64, "base64")
        : opts?.content != null
          ? Buffer.from(opts.content, "latin1")
          : null;
    if (!payload || payload.length === 0) return Promise.resolve({ ok: false, bytes: 0, available: true, error: "İçerik boş" });
    if (opts.transport === "winspool") return sendWinspool(opts.target, payload);
    if (opts.transport === "cups") return sendCups(opts, payload);
    return opts.transport === "serial" ? sendSerial(opts, payload) : sendTcp(opts, payload);
  });
}
