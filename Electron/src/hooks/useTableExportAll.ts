import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  exportListName,
  exportTableToCsv,
  exportTableToPdf,
  exportTableToXlsx,
} from "@/lib/table-export";
import { useExportRange } from "./useExportRange";
import { useExportConfirm } from "./useExportConfirm";
import { isExportCancelled } from "@/lib/export-drain";

/**
 * "Tümünü İndir" — aktif filtreye uyan SUNUCUDAKİ tüm kayıtları çekip PDF/Excel/CSV
 * yazar. `DataTableTools` ile AYNI işi yapar; bu hook, indirmeyi araç menüsünde değil
 * kendi düğmesinde (ör. sayfalama çubuğunda `ExportMenu`) gösteren sayfalar içindir.
 * İki yerde ayrı ayrı yazılmıştı; ayrışınca "aynı listeden iki farklı dosya" olurdu.
 */
export function useTableExportAll<T>(opts: {
  table: Table<T>;
  fetchAll: (
    onProgress?: (loaded: number, total?: number) => void,
    onTruncated?: (loaded: number) => void,
    confirmTotal?: (total: number) => Promise<boolean>,
  ) => Promise<T[]>;
  /** Dosya adı tabanı (ör. "Envanter"). Tarih/aralık damgası otomatik eklenir. */
  name: string;
}): {
  /** İndirme sürerken "N / ~T indiriliyor…" — `ExportMenu.busyLabel`'a verilir. */
  busyLabel: string | undefined;
  onPdf: () => Promise<void>;
  onExcel: () => Promise<void>;
  onCsv: () => Promise<void>;
  /** Büyük liste onayı — çağıran sayfa ağacında çizer. */
  confirmDialog: ReactNode;
} {
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const range = useExportRange();
  const { confirmTotal, confirmDialog } = useExportConfirm();

  const run = async (kind: "pdf" | "xlsx" | "csv"): Promise<void> => {
    setProgress(null);
    try {
      const rows = await opts.fetchAll((loaded, total) => setProgress({ loaded, total }), undefined, confirmTotal);
      if (rows.length === 0) {
        toast.info("İndirilecek kayıt yok.");
        return;
      }
      const filename = exportListName(opts.name, { range });
      if (kind === "pdf") await exportTableToPdf(opts.table, rows, filename);
      else if (kind === "csv") await exportTableToCsv(opts.table, rows, filename);
      else await exportTableToXlsx(opts.table, rows, filename);
    } catch (err) {
      if (!isExportCancelled(err)) toast.error("İndirme hazırlanamadı.");
    } finally {
      setProgress(null);
    }
  };

  return {
    busyLabel: progress
      ? `${progress.loaded.toLocaleString("tr-TR")}${
          progress.total ? ` / ~${progress.total.toLocaleString("tr-TR")}` : ""
        } indiriliyor…`
      : undefined,
    onPdf: () => run("pdf"),
    onExcel: () => run("xlsx"),
    onCsv: () => run("csv"),
    confirmDialog,
  };
}
