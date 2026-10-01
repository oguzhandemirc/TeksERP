import { BrowserWindow, session } from "electron";
import type { BrowserWindowConstructorOptions, Session, WebContents } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { showSaveDialogFor, showOpenDialogFor } from "./dialog-window.js";
import { applyPdfLicenseMeta, sanitizePdfLicenseMeta, type PdfLicenseMeta } from "./pdf-metadata.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import type {
  PdfSaveOpts,
  PdfSaveResult,
  PdfSaveBatchOpts,
  SaveBatchResult,
} from "../../shared/ipc-contract.js";

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

/** Belgenin kendi gömülü içeriği dışında (data:/blob:/about:) hiçbir istek çıkmaz — dosya/UNC/ağ dahil. */
export function isPdfResourceAllowed(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:");
}

let pdfSessionHardened: Session | null = null;

function hardenedPdfSession(): Session {
  if (pdfSessionHardened) return pdfSessionHardened;
  const ses = session.fromPartition(PDF_PARTITION);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isPdfResourceAllowed(details.url) }));
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

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  hardenedPdfSession();
  const win = new BrowserWindow(PDF_WINDOW_OPTIONS);
  hardenPdfContents(win.webContents);
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Görsellerin (logo/QR data-uri) yerleşmesi için kısa bekleme.
    await new Promise((r) => setTimeout(r, 250));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      // Kenar boşluğu belgenin kendi @page kuralından gelsin (0 = belge yönetir).
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return await applyPdfLicenseMeta(pdf, licenseMeta);
  } finally {
    win.destroy();
  }
}

export function registerPdfIpc(): void {
  handleTrusted("pdf:setLicenseMeta", (_e, meta: unknown): void => {
    licenseMeta = sanitizePdfLicenseMeta(meta);
  });

  handleTrusted("pdf:save", async (e, opts: PdfSaveOpts): Promise<PdfSaveResult> => {
    try {
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
      return { saved: false, error: err instanceof Error ? err.message : "PDF oluşturulamadı" };
    }
  });

  // Toplu belge → seçilen KLASÖRE her biri ayrı <name>.pdf. Tek klasör diyaloğu,
  // sonra sırayla üret+yaz (bellek/pencere kontrollü). Ad çakışırsa " (2)" eklenir.
  handleTrusted("pdf:saveBatch", async (e, opts: PdfSaveBatchOpts): Promise<SaveBatchResult> => {
    try {
      if (!opts.items?.length) return { saved: false, error: "Belge yok" };
      const { canceled, filePaths } = await showOpenDialogFor(e, {
        title: "Belgeleri kaydetmek için klasör seçin",
        properties: ["openDirectory", "createDirectory"],
      });
      if (canceled || !filePaths?.[0]) return { saved: false };
      const dir = filePaths[0];
      const used = new Set<string>();
      let count = 0;
      for (const item of opts.items) {
        let base = safeFileName(item.name);
        let name = base;
        let n = 2;
        while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
        used.add(name.toLowerCase());
        const pdf = await htmlToPdf(item.html);
        await writeFile(join(dir, `${name}.pdf`), pdf);
        count++;
      }
      return { saved: true, dir, count };
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : "PDF'ler oluşturulamadı" };
    }
  });
}
