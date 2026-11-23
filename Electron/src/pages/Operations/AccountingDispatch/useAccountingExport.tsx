import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ExportDialog } from "@/components/data-table/export-dialog/ExportDialog";
import { exportSheetsAs, pickSheetColumns, sheetColumnCatalog } from "@/lib/sheet-export";
import { accountingDispatchService } from "./service";
import { accountingExportFileName, buildAccountingWorkbookSheets } from "./accounting-export";
import type { AccountingExportData } from "./types";

/** Sayfa/kolon yapısı veriden bağımsızdır — katalog boş veri setinden kurulur (veri indirmede çekilir). */
const EMPTY: AccountingExportData = {
  range: { from: null, to: null, field: null },
  shipments: [],
  detail: [],
  byCustomer: [],
  byProduct: [],
  returns: [],
  totals: {} as AccountingExportData["totals"],
} as AccountingExportData;
const CATALOG = sheetColumnCatalog(buildAccountingWorkbookSheets(EMPTY));

type Target = { mode: "period" } | { mode: "selected"; ids: string[] };

/**
 * "Sevk Edilenler" muhasebe dökümü (5 sayfa) — ortak çıktı diyaloğuyla: Excel ya da PDF, sayfa·sütun seçimi.
 *  • period — "Dönem dökümü": ekran filtresine göre tüm dönem.
 *  • selected — seçili sevkler (backend ids ile yalnız işaretlileri toplar).
 * Excel ve PDF aynı SheetSpec'ten (`lib/sheet-export`); "her sevk ayrı dosya" ihtiyacını seçim çubuğundaki
 * **Belgeler** karşılar. API hataları apiClient interceptor'ına bırakılır; üretim hataları burada yakalanır.
 */
export function useAccountingExport() {
  const [searchParams] = useSearchParams();
  const [target, setTarget] = useState<Target | null>(null);

  const run = async (t: Target, format: "xlsx" | "pdf" | "csv", columns: string[]): Promise<boolean> => {
    try {
      const query = t.mode === "period" ? searchParams.toString() : `ids=${t.ids.join(",")}`;
      const data = (await accountingDispatchService.getAccountingExport(query)).data;
      if (!data || data.shipments.length === 0) {
        toast.info(t.mode === "period" ? "Seçili aralıkta sevk yok" : "Seçili sevk bulunamadı");
        return false;
      }
      const sheets = pickSheetColumns(buildAccountingWorkbookSheets(data), columns);
      const name = t.mode === "period" ? accountingExportFileName(data.range) : `Sevk_Edilenler_Secili_${data.shipments.length}`;
      const ok = await exportSheetsAs(format, "Sevk Edilenler — muhasebe dökümü", sheets, name);
      if (ok) toast.success(format === "pdf" ? "PDF kaydedildi" : "Excel indirildi");
      return ok;
    } catch {
      toast.error("Dosya oluşturulamadı");
      return false;
    }
  };

  const dialog = target && (
    <ExportDialog
      open
      onOpenChange={(o) => !o && setTarget(null)}
      title={target.mode === "period" ? "Dönem dökümü — muhasebe" : `Seçili ${target.ids.length} sevk — muhasebe dökümü`}
      info="Sevk listesi, detay, müşteri ve kumaş icmali, iade — BRÜT (iade düşülmemiş). Metre/kg ekrandaki listeyle aynı hassasiyette; Excel ve PDF aynı satırları taşır."
      catalog={CATALOG}
      formats={["xlsx", "pdf"]}
      prefKey="muhasebe:sevk-edilenler"
      onRun={(c) => run(target, c.format, c.columns)}
    />
  );

  return {
    openPeriod: () => setTarget({ mode: "period" }),
    openSelected: (ids: string[]) => ids.length > 0 && setTarget({ mode: "selected", ids }),
    dialog,
  };
}
