import { ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { showSaveDialogFor, showOpenDialogFor } from "./dialog-window.js";
import type {
  FilesSaveBatchOpts,
  SaveBatchResult,
  FileSaveOpts,
  FileSaveResult,
} from "../../shared/ipc-contract.js";

// =============================================================================
// Toplu dosya kaydı — renderer'ın ürettiği dosyaları (base64) seçilen KLASÖRE
// yazar. Toplu Excel gibi: her sevkiyat ayrı .xlsx, tek klasör diyaloğuyla.
// =============================================================================

/** Yasak karakterleri _ yap; uzantıyı koru. */
function sanitize(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const raw = dot > 0 ? name.slice(0, dot) : name;
  const base = raw.replace(/[^\p{L}\p{N}\-_. ]/gu, "_").slice(0, 100) || "dosya";
  return { base, ext };
}

export function registerFilesIpc(): void {
  // Tek dosya → kaydet dialoğu (pencereye bağlı: arka plan kararır + kullanıcı
  // onaylayınca döner → toast doğru zamanda). Excel indirmeleri bunu kullanır.
  ipcMain.handle("files:save", async (e, opts: FileSaveOpts): Promise<FileSaveResult> => {
    try {
      const { base, ext } = sanitize(opts.name);
      const finalExt = ext || ".xlsx";
      const { canceled, filePath } = await showSaveDialogFor(e, {
        title: "Kaydet",
        defaultPath: `${base}${finalExt}`,
        filters:
          finalExt === ".xlsx"
            ? [{ name: "Excel", extensions: ["xlsx"] }]
            : [{ name: "Dosya", extensions: [finalExt.replace(/^\./, "")] }],
      });
      if (canceled || !filePath) return { saved: false };
      await writeFile(filePath, Buffer.from(opts.base64, "base64"));
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : "Dosya yazılamadı" };
    }
  });

  ipcMain.handle("files:saveBatch", async (e, opts: FilesSaveBatchOpts): Promise<SaveBatchResult> => {
    try {
      if (!opts.items?.length) return { saved: false, error: "Dosya yok" };
      const { canceled, filePaths } = await showOpenDialogFor(e, {
        title: "Dosyaları kaydetmek için klasör seçin",
        properties: ["openDirectory", "createDirectory"],
      });
      if (canceled || !filePaths?.[0]) return { saved: false };
      const dir = filePaths[0];
      const used = new Set<string>();
      let count = 0;
      for (const item of opts.items) {
        const { base, ext } = sanitize(item.name);
        let final = `${base}${ext}`;
        let n = 2;
        while (used.has(final.toLowerCase())) final = `${base} (${n++})${ext}`;
        used.add(final.toLowerCase());
        await writeFile(join(dir, final), Buffer.from(item.base64, "base64"));
        count++;
      }
      return { saved: true, dir, count };
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : "Dosyalar yazılamadı" };
    }
  });
}
