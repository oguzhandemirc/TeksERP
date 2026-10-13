import { BrowserWindow, session } from "electron";
import type { BrowserWindowConstructorOptions, PrintToPDFOptions, Session, WebContents } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { showSaveDialogFor, showOpenDialogFor } from "./dialog-window.js";
import { applyPdfLicenseMeta, sanitizePdfLicenseMeta, type PdfLicenseMeta } from "./pdf-metadata.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import type {
  PdfSaveOpts,
  PdfSaveResult,
  PdfSaveBatchOpts,
  SaveBatchResult,
} from "../../shared/ipc-contract.js";
import {
  PDF_MAX_HTML_BYTES,
  PDF_TIMEOUT_MESSAGE,
  PDF_TIMEOUT_MS,
  pdfTooLargeMessage,
} from "../../shared/pdf-limits.js";
import { PDF_BATCH_PROGRESS_CHANNEL, type PdfBatchProgress } from "../../shared/pdf-progress.js";

/** Dosya adını güvenli hale getir (yasak karakterler → _), max 100. */
function safeFileName(name: string): string {
  return (name || "belge").replace(/[^\p{L}\p{N}\-_. ]/gu, "_").slice(0, 100);
}

// =============================================================================
// PDF export — backend renderer HTML'ini gizli bir BrowserWindow'da yükleyip
// webContents.printToPDF ile PDF'e çevirir, sistem kaydet dialoğuyla diske yazar.
// Belge HTML'i kendi <style> + @page (sayfa boyutu/margin) taşır → printBackground
// açık, geri kalan yerleşim belgenin kendi CSS'inden gelir.
// =============================================================================

/** Lisans filigranı (renderer lisans durumundan bildirir); main süreç ömrü boyunca bellekte. */
let licenseMeta: PdfLicenseMeta | null = null;

// GÜVENLİK: bu pencere kullanıcı yazımı olabilen belge HTML'ini (uzman şablonu) çizer.
// Önizleme ve kâğıt baskısı zaten script'siz sandbox iframe'de; PDF de AYNI duruşta:
// JS kapalı, köprü (preload) yok, ağ yok, gezinme/yeni pencere yok. Belge HTML'leri
// script'e dayanmaz (logo/QR data-URI); dış kaynak önizleme/baskıda da yüklenmiyordu
// (panel CSP'si img-src 'self' data: blob:) → PDF = ekran = baskı.

/** Bellek içi ayrık oturum (`persist:` öneki YOK): çerez/önbellek ana pencereyle paylaşılmaz. */
export const PDF_PARTITION = "tekserp-pdf";

export const PDF_WINDOW_OPTIONS = {
  show: false,
  webPreferences: {
    offscreen: true,
    javascript: false,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    spellcheck: false,
    navigateOnDragDrop: false,
    partition: PDF_PARTITION,
  },
} satisfies BrowserWindowConstructorOptions;

/**
 * Belge HTML'i bu şemadan, BELLEKTEN servis edilir: `data:` URL Chromium'un 2 MB URL
 * sınırına takılıyordu ve geçici dosya belge verisini diske yazardı.
 */
export const PDF_DOC_SCHEME = "tekserp-pdf";
const PDF_DOC_PREFIX = `${PDF_DOC_SCHEME}://doc/`;
const pendingDocs = new Map<string, string>();

/** Belgenin kendi gömülü içeriği ve bellekteki belge dışında hiçbir istek çıkmaz — dosya/UNC/ağ dahil. */
export function isPdfResourceAllowed(url: string): boolean {
  return (
    url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:") || url.startsWith(PDF_DOC_PREFIX)
  );
}

/** Kullanıcıya OLDUĞU GİBİ gösterilebilen hata (sabit Türkçe metin; URL/HTML taşımaz). */
export class PdfUserError extends Error {}

/** Hata metni IPC'ye ve toast'a gider: ham Chromium mesajı (içinde tüm URL olabilir) asla. */
export function pdfErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof PdfUserError) return err.message;
  const raw = err instanceof Error ? err.message.slice(0, 200) : "";
  const code = /\bERR_[A-Z0-9_]+\b/.exec(raw)?.[0];
  return code ? `${fallback} (${code})` : fallback;
}

/** Bayt kapısı — çizimden ve kaydet diyaloğundan ÖNCE. */
export function assertPdfSize(html: string): void {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > PDF_MAX_HTML_BYTES) throw new PdfUserError(pdfTooLargeMessage(bytes));
}

let pdfSessionHardened: Session | null = null;

function hardenedPdfSession(): Session {
  if (pdfSessionHardened) return pdfSessionHardened;
  const ses = session.fromPartition(PDF_PARTITION);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isPdfResourceAllowed(details.url) }));
  ses.protocol.handle(PDF_DOC_SCHEME, (req) => {
    const html = req.url.startsWith(PDF_DOC_PREFIX) ? pendingDocs.get(req.url.slice(PDF_DOC_PREFIX.length)) : undefined;
    if (html === undefined) return new Response(null, { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  pdfSessionHardened = ses;
  return ses;
}

/** Gezinme, yönlendirme, webview ve yeni pencere: HEPSİ engelli; işletim sistemine hiçbir şey devredilmez. */
export function hardenPdfContents(contents: WebContents): void {
  const block = (event: { preventDefault(): void }): void => event.preventDefault();
  contents.on("will-navigate", block);
  contents.on("will-frame-navigate", block);
  contents.on("will-redirect", block);
  contents.on("will-attach-webview", block);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfUserError(PDF_TIMEOUT_MESSAGE)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function makePdfWindow(): BrowserWindow {
  const win = new BrowserWindow(PDF_WINDOW_OPTIONS);
  hardenPdfContents(win.webContents);
  return win;
}

/**
 * Tekil ve toplu PDF'in TEK baskı seçeneği. `preferCSSPageSize` olmadan belgenin `@page { size }`
 * boyutu yok sayılır ve PDF Letter çıkar; `@page` boyutu tanımlamayan belge A4'e düşer.
 */
export const PDF_PRINT_OPTIONS = {
  printBackground: true,
  preferCSSPageSize: true,
  pageSize: "A4",
  // Kenar boşluğu belgenin kendi @page kuralından gelsin (0 = belge yönetir).
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
} satisfies PrintToPDFOptions;

/** Belgeyi verilen pencerede çizer; pencerenin ömrü çağıranındır. Zaman aşımı belge başınadır. */
async function renderInWindow(win: BrowserWindow, html: string, settleMs: number): Promise<Uint8Array> {
  const token = randomUUID();
  pendingDocs.set(token, html);
  try {
    const pdf = await withTimeout(
      (async () => {
        await win.loadURL(PDF_DOC_PREFIX + token);
        // Görsellerin (logo/QR data-uri) yerleşmesi için kısa bekleme (tekil kayıt; toplu yolda 0, bkz. htmlsToPdfs).
        if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
        return win.webContents.printToPDF(PDF_PRINT_OPTIONS);
      })(),
      PDF_TIMEOUT_MS,
    );
    return await applyPdfLicenseMeta(pdf, licenseMeta);
  } finally {
    pendingDocs.delete(token);
  }
}

async function renderPdf(html: string): Promise<Uint8Array> {
  hardenedPdfSession();
  const win = makePdfWindow();
  try {
    return await renderInWindow(win, html, 250);
  } finally {
    win.destroy();
  }
}

// Tek kuyruk: büyük belge render süreci GB mertebesinde bellek ister, iki paralel PDF bunu ikiye katlar.
let pdfQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = pdfQueue.then(job);
  pdfQueue = run.catch(() => undefined);
  return run;
}

export function htmlToPdf(html: string): Promise<Uint8Array> {
  try {
    assertPdfSize(html);
  } catch (err) {
    return Promise.reject(err);
  }
  return enqueue(() => renderPdf(html));
}

/**
 * Toplu PDF: TEK gizli pencere ardışık belgeleri çizer; kuyruk yuvası iş boyunca tutulur. Sabit
 * bekleme yok: 1 MB data-URI görselli 40 belgede 250 ms ↔ 0 çıktısı piksel-eşit ölçüldü (Perf-2 B8).
 * İlk hatada (zaman aşımı dahil) durur, pencere her durumda yok edilir.
 */
export function htmlsToPdfs(htmls: readonly string[], onEach: (pdf: Uint8Array, index: number) => Promise<void>): Promise<void> {
  try {
    for (const html of htmls) assertPdfSize(html);
  } catch (err) {
    return Promise.reject(err);
  }
  return enqueue(async () => {
    hardenedPdfSession();
    const win = makePdfWindow();
    try {
      for (let i = 0; i < htmls.length; i++) await onEach(await renderInWindow(win, htmls[i]!, 0), i);
    } finally {
      win.destroy();
    }
  });
}

export function registerPdfIpc(): void {
  handleTrusted("pdf:setLicenseMeta", (_e, meta: unknown): void => {
    licenseMeta = sanitizePdfLicenseMeta(meta);
  });

  handleTrusted("pdf:save", async (e, opts: PdfSaveOpts): Promise<PdfSaveResult> => {
    try {
      assertPdfSize(opts.html);
      const { canceled, filePath } = await showSaveDialogFor(e, {
        title: "PDF Kaydet",
        defaultPath: `${safeFileName(opts.suggestedName)}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) return { saved: false };
      const pdf = await htmlToPdf(opts.html);
      await writeFile(filePath, pdf);
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false, error: pdfErrorMessage(err, "PDF oluşturulamadı") };
    }
  });

  // Toplu belge → seçilen KLASÖRE her biri ayrı <name>.pdf. Tek klasör diyaloğu,
  // sonra sırayla üret+yaz (bellek/pencere kontrollü). Ad çakışırsa " (2)" eklenir.
  handleTrusted("pdf:saveBatch", async (e, opts: PdfSaveBatchOpts): Promise<SaveBatchResult> => {
    try {
      if (!opts.items?.length) return { saved: false, error: "Belge yok" };
      for (const item of opts.items) assertPdfSize(item.html);
      const { canceled, filePaths } = await showOpenDialogFor(e, {
        title: "Belgeleri kaydetmek için klasör seçin",
        properties: ["openDirectory", "createDirectory"],
      });
      if (canceled || !filePaths?.[0]) return { saved: false };
      const dir = filePaths[0];
      const used = new Set<string>();
      const names = opts.items.map((item) => {
        const base = safeFileName(item.name);
        let name = base;
        let n = 2;
        while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
        used.add(name.toLowerCase());
        return name;
      });
      const total = opts.items.length;
      let count = 0;
      await htmlsToPdfs(
        opts.items.map((item) => item.html),
        async (pdf, i) => {
          await writeFile(join(dir, `${names[i]}.pdf`), pdf);
          count++;
          if (!e.sender.isDestroyed()) e.sender.send(PDF_BATCH_PROGRESS_CHANNEL, { done: count, total } satisfies PdfBatchProgress);
        },
      );
      return { saved: true, dir, count };
    } catch (err) {
      return { saved: false, error: pdfErrorMessage(err, "PDF'ler oluşturulamadı") };
    }
  });
}
