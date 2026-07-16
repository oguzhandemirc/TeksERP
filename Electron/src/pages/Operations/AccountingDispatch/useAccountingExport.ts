import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { buildWorkbook, downloadWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "./service";
import {
  accountingExportFileName,
  buildAccountingWorkbookSheets,
  buildDispatchReportSheets,
} from "./accounting-export";
import type { DispatchListItem } from "./types";

// İki seçili sevk arası bekleme — paralel değil SIRALI indirme; sunucu (DB) + tarayıcı
// indirme kuyruğu nefes alsın, CPU/RAM şişmesin.
const SEQUENTIAL_DELAY_MS = 350;

/**
 * "Sevk Edilenler (Muhasebe)" Excel export'ları:
 *  • period  — üstteki "Excel'e Aktar": ekran filtresine göre tüm dönem (tek dosya, 5 sayfa).
 *  • single  — seçili sevkler tek 5-sayfalık dosyada (backend ids ile yalnız işaretlileri toplar).
 *  • separate— her seçili sevk ayrı .xlsx; SIRAYLA + throttle (sunucu yükü kontrollü).
 * API hataları apiClient interceptor'ına bırakılır; build hataları burada yakalanır.
 */
export function useAccountingExport() {
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState<null | "single" | "separate">(null);
  const [progress, setProgress] = useState(0);

  const periodMut = useMutation({
    mutationFn: () => accountingDispatchService.getAccountingExport(searchParams.toString()),
    onSuccess: async (res) => {
      try {
        const data = res.data;
        if (!data || data.shipments.length === 0) {
          toast.info("Seçili aralıkta sevk yok");
          return;
        }
        const blob = await buildWorkbook(buildAccountingWorkbookSheets(data));
        downloadWorkbook(blob, accountingExportFileName(data.range));
        toast.success("Excel indirildi");
      } catch {
        toast.error("Excel oluşturulamadı");
      }
    },
  });

  const exportSelectedSingle = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    setBusy("single");
    try {
      const res = await accountingDispatchService.getAccountingExport(`ids=${ids.join(",")}`);
      const data = res.data;
      if (!data || data.shipments.length === 0) {
        toast.info("Seçili sevk bulunamadı");
        return;
      }
      const blob = await buildWorkbook(buildAccountingWorkbookSheets(data));
      downloadWorkbook(blob, `Sevk_Edilenler_Secili_${data.shipments.length}`);
      toast.success(`${data.shipments.length} sevk tek Excel'e aktarıldı`);
    } catch {
      toast.error("Excel oluşturulamadı");
    } finally {
      setBusy(null);
    }
  };

  const exportSelectedSeparate = async (rows: DispatchListItem[]) => {
    if (rows.length === 0 || busy) return;
    setBusy("separate");
    setProgress(0);
    let ok = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        try {
          // DIRECT satır → fasondan sevk fişi ucu (çuval sevkiyatı ucu 404 verir).
          const report = (
            row.kind === "DIRECT"
              ? await accountingDispatchService.getDirectReport(row.id)
              : await accountingDispatchService.getReport(row.id)
          ).data;
          if (report) {
            const blob = await buildWorkbook(buildDispatchReportSheets(report));
            downloadWorkbook(blob, `Sevk_Fisi_${report.header.shipmentNo}`);
            ok++;
          }
        } catch {
          /* tek sevkin hatası tüm batch'i durdurmasın */
        }
        setProgress(i + 1);
        if (i < rows.length - 1) await new Promise((r) => setTimeout(r, SEQUENTIAL_DELAY_MS));
      }
      toast.success(`${ok}/${rows.length} sevk ayrı Excel olarak indirildi`);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  return { periodMut, busy, progress, exportSelectedSingle, exportSelectedSeparate };
}
