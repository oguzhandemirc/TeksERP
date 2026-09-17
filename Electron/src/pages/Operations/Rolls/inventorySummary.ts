import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { exportListName } from "@/lib/table-export";
import { rollService, buildRollForceFilters, type RollStatusTabKey } from "./service";

export interface SummaryTab {
  key: RollStatusTabKey;
  label: string;
}

/**
 * "Kumaş Stoğu Özeti" — her kategori (Ham Stok, Bitmiş Depo, Çuvalda, Fasonda…) için
 * backend SAYIM sorgusu (top sayısı + toplam metre) çekip TEK Excel sayfasına dizer.
 * Tüm satırları indirmez, yalnız hafif COUNT/SUM. TEK istek: `stats-batch` uç noktası
 * tüm kategorileri tek çağrıda (backend Promise.all) sayar — 8 ayrı HTTP değil.
 *
 * GENEL TOPLAM satırı YOK bilinçli: kategoriler örtüşebilir (Kurşun/Tambur Bekleyen,
 * "Üretimde"nin alt kümesidir) → sekmeleri toplamak çift sayardı. Her kategori ayrı okunur.
 */
export async function downloadInventorySummary(tabs: SummaryTab[]): Promise<boolean> {
  const res = await rollService.getStatsBatch(
    tabs.map((t) => ({ key: t.key, filters: buildRollForceFilters(t.key) })),
  );
  const byKey = new Map((res.data ?? []).map((s) => [s.key, s]));
  const rows = tabs.map((t) => {
    const s = byKey.get(t.key);
    return { label: t.label, count: s?.totalCount ?? 0, qty: s?.totalQty ?? 0 };
  });
  const blob = await buildWorkbook([
    {
      name: "Kumaş Stoğu Özeti",
      columns: [
        { header: "Kategori", key: "label", width: 24 },
        { header: "Top Sayısı", key: "count", width: 14, numFmt: "#,##0" },
        { header: "Toplam Metre", key: "qty", width: 16, numFmt: "#,##0.###" },
      ],
      rows,
    },
  ]);
  return saveWorkbook(blob, exportListName("Kumaş Stoğu Özeti"));
}
