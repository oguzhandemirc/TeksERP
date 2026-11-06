// Stok & Ölü Stok — "Kalem bazında" sekmesi: servis tipleri + dışa aktarım spec'i.
// Toplamlar sunucudan gelir (tüm küme, Stok & Ölü Stok kutularıyla aynı rakam);
// ekran ve Excel/PDF aynı spec'i basar.

import apiClient from "@/services/apiClient";
import type { ReportExportSpec } from "../_components/reportExport";
import type { ReportResponse } from "../_services/types";

export interface StockKalemHamRow {
  key: string;
  itemId: string;
  itemName: string;
  count: number;
  qty: number;
}

export interface StockKalemBitmisRow {
  key: string;
  itemId: string;
  itemName: string;
  width: number | null;
  colorId: string | null;
  colorName: string | null;
  foldType: string | null;
  foldName: string | null;
  count: number;
  qty: number;
}

export interface StockKalem {
  totals: { hamCount: number; hamQty: number; bitmisCount: number; bitmisQty: number };
  ham: StockKalemHamRow[];
  bitmis: StockKalemBitmisRow[];
}

export const stockKalemApi = {
  /** `warnings`: satır tavanı aşılırsa sunucunun Türkçe uyarısı (toplamlar yine tam küme). */
  get: async (): Promise<ReportResponse<StockKalem> & { warnings?: string[] }> => {
    // Hata sekmenin içinde yazılır (eski sunucuda uç yok → 404); genel toast çift mesaj olurdu.
    const res = await apiClient.get<ReportResponse<StockKalem> & { warnings?: string[] }>(
      "/api/reports/inventory/scorecard/kalem",
      { suppressErrorToast: true },
    );
    return res.data;
  },
};

export const KALEM_SERVER_OUTDATED = "Bu rapor için sunucunun güncellenmesi gerekiyor.";

/** Sekmede gösterilecek hata cümlesi: 404 = sunucu bu ucu henüz taşımıyor (2.11.7 öncesi). */
export function kalemErrorText(error: unknown): string {
  const res = (error as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  if (res?.status === 404) return KALEM_SERVER_OUTDATED;
  if (!res) return "Sunucuya ulaşılamıyor.";
  return typeof res.data?.message === "string" && res.data.message ? res.data.message : "Kalem bazında rapor yüklenemedi.";
}

/** En metni — ekran ve çıktı aynı metni basar. */
export const widthText = (w: number | null): string => (w === null ? "—" : `${w} cm`);

export function buildStockKalemExport(k: StockKalem, warnings: string[] = []): ReportExportSpec {
  return {
    title: "Stok ve Ölü Stok — Kalem Bazında",
    subtitle: "Anlık durum",
    meta: [
      "Ham: kumaş başına; dışarıdan alınan yarı mamul dahil değil. Bitmiş: kumaş + en + renk + kat başına (depo + A1 stok).",
      "Sevkiyata okutulmuş / çuvala girmiş toplar raf sayılmaz. Toplamlar Stok & Ölü Stok kutularıyla aynıdır.",
      ...warnings,
    ],
    tables: [
      {
        name: "Ham",
        columns: [
          { header: "Kumaş", key: "itemName", width: 32 },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Metre", key: "qty", width: 14, numFmt: "#,##0.0", align: "right" },
        ],
        rows: k.ham.map((r) => ({ itemName: r.itemName, count: r.count, qty: r.qty })),
        totalRow: { itemName: "TOPLAM", count: k.totals.hamCount, qty: k.totals.hamQty },
      },
      {
        name: "Bitmiş",
        columns: [
          { header: "Kumaş", key: "itemName", width: 28 },
          { header: "En", key: "width", width: 10 },
          { header: "Renk", key: "colorName", width: 18 },
          { header: "Kat", key: "foldName", width: 12 },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
          { header: "Metre", key: "qty", width: 14, numFmt: "#,##0.0", align: "right" },
        ],
        rows: k.bitmis.map((r) => ({
          itemName: r.itemName,
          width: widthText(r.width),
          colorName: r.colorName ?? "—",
          foldName: r.foldName ?? "—",
          count: r.count,
          qty: r.qty,
        })),
        totalRow: { itemName: "TOPLAM", width: "", colorName: "", foldName: "", count: k.totals.bitmisCount, qty: k.totals.bitmisQty },
      },
    ],
  };
}
