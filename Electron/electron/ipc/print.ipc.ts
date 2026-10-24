// =============================================================================
// Belge basımı — gizli pencere + `webContents.print` (izlenebilirlik A2)
// =============================================================================
// Renderer'ın iframe `print()`i sonucu bilmez; burada Chromium'un geri çağrısı sonucu söyler
// (gitti · iptal · hata). Pencere PDF penceresiyle AYNI duruştadır: JS kapalı, köprüsüz, ağsız,
// gezinmesiz, aynı ayrık oturum. Diyalog kipi (varsayılan) bugünkü sistem penceresini açar.
// =============================================================================
import { BrowserWindow } from "electron";
import type { BrowserWindowConstructorOptions, WebContentsPrintOptions } from "electron";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { PDF_WINDOW_OPTIONS, hardenPdfContents, hardenedPdfSession, serveDoc } from "./pdf.ipc.js";
import {
  DOC_PRINT_CHANNEL,
  DOC_PRINT_MAX_HTML_BYTES,
  DOC_PRINT_PRINTERS_CHANNEL,
  classifyPrintFailure,
  parseDocPrintRequest,
  type DocPrintRequest,
  type DocPrintResult,
  type DocPrinterInfo,
} from "@shared/doc-print";

/** Offscreen çizim yazdırmaz → `offscreen` düşer; geri kalan her bayrak PDF penceresinin aynısı. */
const { offscreen: _offscreen, ...printPrefs } = PDF_WINDOW_OPTIONS.webPreferences;
export const PRINT_WINDOW_OPTIONS = {
  show: false,
  webPreferences: printPrefs,
} satisfies BrowserWindowConstructorOptions;

/** Yükleme + sessiz gönderimin üst süresi; diyalog kipinde kullanıcı beklenir (süre yok). */
export const DOC_PRINT_LOAD_TIMEOUT_MS = 60_000;
export const DOC_PRINT_SILENT_TIMEOUT_MS = 120_000;

function timeout<T>(ms: number, value: T): { promise: Promise<T>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** Tek basım: pencere her durumda yok edilir; sonuç asla fırlatmaz (renderer basımı bildirir). */
export async function printDocument(req: DocPrintRequest): Promise<DocPrintResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  if (Buffer.byteLength(req.html, "utf8") > DOC_PRINT_MAX_HTML_BYTES) {
    return { status: "HATA", errorCode: "BELGE_COK_BUYUK", durationMs: elapsed() };
  }
  hardenedPdfSession();
  const win = new BrowserWindow(PRINT_WINDOW_OPTIONS);
  hardenPdfContents(win.webContents);
  const doc = serveDoc(req.html);
  try {
    const load = timeout(DOC_PRINT_LOAD_TIMEOUT_MS, "timeout" as const);
    const loaded = await Promise.race([win.loadURL(doc.url).then(() => "ok" as const), load.promise]);
    load.cancel();
    if (loaded === "timeout") return { status: "HATA", errorCode: "ZAMAN_ASIMI", durationMs: elapsed() };
    // Görsellerin (logo/QR data-URI) yerleşmesi — PDF yolundaki tekil beklemeyle aynı.
    await new Promise((r) => setTimeout(r, 250));

    const opts: WebContentsPrintOptions = {
      silent: req.silent,
      printBackground: true,
      ...(req.deviceName ? { deviceName: req.deviceName } : {}),
      ...(req.copies ? { copies: req.copies } : {}),
    };
    const printed = new Promise<DocPrintResult>((resolve) => {
      win.webContents.print(opts, (success, failureReason) => {
        if (success) return resolve({ status: "ILETILDI", durationMs: elapsed() });
        const c = classifyPrintFailure(failureReason);
        if (c.status === "HATA") log.warn("[belge-basimi] basılamadı", { errorCode: c.errorCode, reason: String(failureReason).slice(0, 120) });
        resolve(c.status === "IPTAL" ? { status: "IPTAL", durationMs: elapsed() } : { status: "HATA", errorCode: c.errorCode, durationMs: elapsed() });
      });
    });
    if (!req.silent) return await printed;
    const t = timeout<DocPrintResult>(DOC_PRINT_SILENT_TIMEOUT_MS, { status: "HATA", errorCode: "ZAMAN_ASIMI", durationMs: DOC_PRINT_SILENT_TIMEOUT_MS });
    const r = await Promise.race([printed, t.promise]);
    t.cancel();
    return r;
  } catch (err) {
    log.warn("[belge-basimi] pencere hatası", { message: err instanceof Error ? err.message.slice(0, 120) : "" });
    return { status: "HATA", errorCode: "BILINMEYEN", durationMs: elapsed() };
  } finally {
    doc.release();
    if (!win.isDestroyed()) win.destroy();
  }
}

/** İşletim sistemi yazıcıları — ana pencere yoksa geçici gizli pencereden okunur. */
export async function listDocPrinters(): Promise<DocPrinterInfo[]> {
  const host = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const temp = host ? null : new BrowserWindow(PRINT_WINDOW_OPTIONS);
  try {
    const list = await (host ?? temp!).webContents.getPrintersAsync();
    return list.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      // macOS/Linux CUPS seçeneği; Windows'ta yoktur (varsayılan işaretsiz kalır).
      isDefault: (p.options as Record<string, unknown> | undefined)?.["printer-is-default"] === "true",
    }));
  } catch {
    return [];
  } finally {
    if (temp && !temp.isDestroyed()) temp.destroy();
  }
}

export function registerDocPrintIpc(): void {
  handleTrusted(DOC_PRINT_CHANNEL, async (_e, raw: unknown): Promise<DocPrintResult> => {
    const req = parseDocPrintRequest(raw);
    if (!req) return { status: "HATA", errorCode: "BILINMEYEN", durationMs: 0 };
    return printDocument(req);
  });
  handleTrusted(DOC_PRINT_PRINTERS_CHANNEL, () => listDocPrinters());
}
