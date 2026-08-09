// Stok & Ölü Stok — servis tipleri + dışa aktarım spec'i.

import apiClient from "@/services/apiClient";
import type { ReportExportSpec } from "../_components/reportExport";
import type { ReportResponse } from "../_services/types";

export interface StockScorecard {
  summary: {
    finishedQty: number;
    finishedCount: number;
    rawQty: number;
    rawCount: number;
    agedQty: number;
    /** Eşikten eski VE siparişsiz — asıl "ölü stok". */
    deadQty: number;
    deadStockDays: number;
    /** Yaş çıpası olmayan toplar — kovalara girmez, toplam metraja girer. */
    unagedCount: number;
    unagedQty: number;
  };
  byAge: Array<{ key: string; label: string; count: number; qty: number; pct: number }>;
  byItem: Array<{
    key: string; label: string; count: number; qty: number;
    oldestDays: number | null; uncoveredQty: number;
  }>;
  oldest: Array<{
    rollId: string; barcode: string | null; itemName: string;
    colorName: string | null; status: string; qty: number; days: number;
  }>;
}

export const stockScorecardApi = {
  get: async (): Promise<ReportResponse<StockScorecard>> => {
    const res = await apiClient.get<ReportResponse<StockScorecard>>("/api/reports/inventory/scorecard");
    return res.data;
  },
};

export function buildStockExport(sc: StockScorecard): ReportExportSpec {
  return {
    title: "Stok ve Ölü Stok",
    subtitle: "Anlık durum",
    meta: [
      // Tanım rakamla aynı dosyada dursun: "ölü stok" herkesin kafasında farklı.
      `ÖLÜ STOK = ${sc.summary.deadStockDays} günden eski VE açık siparişi olmayan bitmiş mal. İkisinden yalnız biri sorun değildir.`,
      "Yaş, topun bulunduğu rafa GİRDİĞİ ana göre ölçülür (statü değişimi), kayıt güncellemesine göre değil.",
      "Siparişsizlik SPEC bazındadır (kumaş+renk+en): hangi FİZİKSEL topun karşılıksız olduğu iddia edilmez.",
      "Sevkiyata okutulmuş / çuvala girmiş toplar raf sayılmaz.",
      sc.summary.unagedCount > 0
        ? `${sc.summary.unagedCount} topun (${sc.summary.unagedQty} m) yaşı bilinmiyor — yaş kovalarına dahil değil, toplam metraja dahil.`
        : "Tüm topların yaş çıpası mevcut.",
    ],
    tables: [
      {
        name: "Yaş Dağılımı",
        columns: [
          { header: "Yaş", key: "label", width: 18 },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.0", align: "right" },
          { header: "Pay %", key: "pct", width: 10, numFmt: "0.0", align: "right" },
        ],
        rows: sc.byAge.map((r) => ({ ...r })),
        totalRow: {
          label: "TOPLAM (yaşı bilinen)",
          count: sc.byAge.reduce((a, r) => a + r.count, 0),
          qty: Math.round(sc.byAge.reduce((a, r) => a + r.qty, 0) * 10) / 10,
          pct: 100,
        },
      },
      {
        name: "Kumaş Bazında",
        columns: [
          { header: "Kumaş", key: "label", width: 28 },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Stok (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Siparişsiz (m)", key: "uncoveredQty", width: 15, numFmt: "#,##0.0", align: "right" },
          { header: "En eski (gün)", key: "oldestDays", width: 14, numFmt: "0.0", align: "right" },
        ],
        rows: sc.byItem.map((r) => ({ ...r })),
        totalRow: {
          label: "TOPLAM",
          count: sc.summary.finishedCount,
          qty: sc.summary.finishedQty,
          uncoveredQty: Math.round(sc.byItem.reduce((a, r) => a + r.uncoveredQty, 0) * 10) / 10,
        },
      },
      {
        name: "En Eski Toplar",
        columns: [
          { header: "Barkod", key: "barcode", width: 18 },
          { header: "Kumaş", key: "itemName", width: 24 },
          { header: "Renk", key: "colorName", width: 16 },
          { header: "Durum", key: "status", width: 14 },
          { header: "Metraj (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Yaş (gün)", key: "days", width: 12, numFmt: "0.0", align: "right" },
        ],
        rows: sc.oldest.map((r) => ({ ...r, barcode: r.barcode ?? "—", colorName: r.colorName ?? "—" })),
      },
    ],
  };
}
