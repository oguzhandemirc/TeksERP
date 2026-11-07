import { useState } from "react";
import { toast } from "sonner";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { exportListName } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { Order } from "../types";
import { aggregateStockLines, type StockCellInput } from "./aggregate";
import { loadAllFinishedStock, loadFinishedStock, loadLiveMetersByWorkOrder, type SourceResult } from "./sources";
import { buildStockLineSheet, stockLineNotes } from "./sheet";
import { describeOrderScope, type OrderListScope } from "./scope-summary";
import type { StockLineOptions } from "./options";

// Bakım hattı (1.3.x) `useDataTable.fetchAll` imzası: yalnız ilerleme (tavan uyarısı/100K onayı yok).
export type OrdersFetchAll = (onProgress?: (loaded: number, total?: number) => void) => Promise<Order[]>;

const TITLE = "Siparişler — Stok Kalemi Bazında";

/**
 * Siparişler ekranının süzgeciyle AYNI küme (`fetchAll`) + stok + canlı top → tek Excel sayfası.
 * Dönen `true` = dosya üretildi (modal kapanabilir).
 */
export function useStockLineExportRun(props: { fetchAll: OrdersFetchAll; listScope: OrderListScope; productionEnabled: boolean }) {
  const [progress, setProgress] = useState<string | null>(null);
  const range = useExportRange();
  const { hasPermission } = useRoleAccess();

  const run = async (options: StockLineOptions): Promise<boolean> => {
    if (progress !== null) return false;
    setProgress("Hazırlanıyor…");
    try {
      // Kaynaklar sipariş çekimiyle paralel; ölçülemeyen kaynak null + not döner (hata fırlatmaz).
      const stockP = loadFinishedStock(hasPermission("report:inventory"));
      const liveP = loadLiveMetersByWorkOrder(hasPermission("roll:read"), props.productionEnabled);
      // "Depoda (tümü)" yalnız seçiliyse çekilir (tüm depo topları imleçle iner).
      const stockAllP: Promise<SourceResult<StockCellInput[]>> = options.columns.includes("inStockAll")
        ? loadAllFinishedStock(hasPermission("roll:read"))
        : Promise.resolve({ value: null, notes: [] });
      const orders = await props.fetchAll(
        (loaded, total) =>
          setProgress(`${loaded.toLocaleString("tr-TR")}${total ? ` / ~${total.toLocaleString("tr-TR")}` : ""} sipariş…`),
      );
      const [stock, stockAll, live] = await Promise.all([stockP, stockAllP, liveP]);
      const result = aggregateStockLines(orders, options, {
        stock: stock.value,
        stockAll: stockAll.value,
        liveMetersByWorkOrder: live.value,
      });
      if (result.rows.length === 0) {
        toast.info(options.onlyOpen ? "Açığı olan stok kalemi yok." : "İndirilecek kalem yok.");
        return false;
      }
      const name = exportListName("Siparişler - Stok Kalemi Bazında", { range });
      const sheet = buildStockLineSheet({
        title: TITLE,
        result,
        options,
        scopeLines: describeOrderScope(props.listScope, orders),
        notes: stockLineNotes(options, [...stock.notes, ...stockAll.notes, ...live.notes]),
      });
      await saveWorkbook(await buildWorkbook([sheet]), name);
      return true;
    } catch {
      toast.error("İndirme hazırlanamadı.");
      return false;
    } finally {
      setProgress(null);
    }
  };

  return { run, progress };
}
