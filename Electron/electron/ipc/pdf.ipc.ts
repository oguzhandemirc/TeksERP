import { ipcMain, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { showSaveDialogFor, showOpenDialogFor } from "./dialog-window.js";
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

async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Görsellerin (logo/QR data-uri) yerleşmesi için kısa bekleme.
    await new Promise((r) => setTimeout(r, 250));
    return await win.webContents.printToPDF({
      printBackground: true,
      // Kenar boşluğu belgenin kendi @page kuralından gelsin (0 = belge yönetir).
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    win.destroy();
  }
}

export function registerPdfIpc(): void {
  ipcMain.handle("pdf:save", async (e, opts: PdfSaveOpts): Promise<PdfSaveResult> => {
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
  ipcMain.handle("pdf:saveBatch", async (e, opts: PdfSaveBatchOpts): Promise<SaveBatchResult> => {
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
