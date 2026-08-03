import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { accountingDispatchService } from "./service";
import { accountingExportFileName, buildAccountingWorkbookSheets } from "./accounting-export";

/**
 * "Sevk Edilenler (Muhasebe)" Excel export'ları:
 *  • period — üstteki "Dönem Excel": ekran filtresine göre tüm dönem (tek dosya, 5 sayfa).
 *  • single — seçili sevkler tek 5-sayfalık dosyada (backend ids ile yalnız işaretlileri toplar).
 *
 * "Her sevk AYRI dosya" ihtiyacını seçim çubuğundaki **Belgeler → Excel** karşılar
 * (`shipmentDocExport`): sevk fişini sevk no adıyla ayrı ayrı indirir. Burada bir zamanlar
 * aynı işi yapan `exportSelectedSeparate` vardı; sayfaya HİÇ bağlanmamıştı (ölü kod) ve
 * dosyanın açıklaması olmayan bir düğmeyi anlatıyordu → 2026-08-02'de kaldırıldı.
 *
 * API hataları apiClient interceptor'ına bırakılır; build hataları burada yakalanır.
 */
export function useAccountingExport() {
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState<null | "single">(null);

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
        if (await saveWorkbook(blob, accountingExportFileName(data.range))) {
          toast.success("Excel indirildi");
        }
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
      if (await saveWorkbook(blob, `Sevk_Edilenler_Secili_${data.shipments.length}`)) {
        toast.success(`${data.shipments.length} sevk tek Excel'e aktarıldı`);
      }
    } catch {
      toast.error("Excel oluşturulamadı");
    } finally {
      setBusy(null);
    }
  };

  return { periodMut, busy, exportSelectedSingle };
}
