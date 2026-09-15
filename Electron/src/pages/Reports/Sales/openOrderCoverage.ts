// Açık Sipariş Karşılanma — servis tipleri + dışa aktarım spec'i.
// Backend `open-order-coverage.report.service.ts` tipinin aynası
// (Electron backend'i import edemez).

import apiClient from "@/services/apiClient";
import type { ReportExportSpec } from "../_components/reportExport";
import type { ReportResponse } from "../_services/types";

export type CoverageState = "HAZIR" | "KISMI" | "URETIM_GEREKLI";

export const COVERAGE_STATE_LABEL: Record<CoverageState, string> = {
  HAZIR: "Sevk edilebilir",
  KISMI: "Kısmen hazır",
  URETIM_GEREKLI: "Üretim gerekli",
};

export interface CoverageBucketRow {
  key: string;
  label: string;
  lineCount: number;
  openQty: number;
  fromWarehouseQty: number;
  fromProductionQty: number;
  uncoveredQty: number;
  coveragePct: number;
}

export interface CoverageLineRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  deadline: string | null;
  daysLate: number | null;
  openQty: number;
  fromWarehouseQty: number;
  fromProductionQty: number;
  uncoveredQty: number;
  state: CoverageState;
}

export interface OpenOrderCoverage {
  summary: {
    openLineCount: number;
    openQty: number;
    fromWarehouseQty: number;
    fromProductionQty: number;
    uncoveredQty: number;
    materialGapQty: number;
    fullyCoveredLines: number;
    partiallyCoveredLines: number;
    uncoveredLines: number;
    overdueUncoveredLines: number;
    overdueUncoveredQty: number;
    coveragePct: number;
  };
  byCustomer: CoverageBucketRow[];
  byItem: CoverageBucketRow[];
  lines: CoverageLineRow[];
  linesOmitted: number;
}

export const openOrderCoverageApi = {
  get: async (params: Record<string, string> = {}): Promise<ReportResponse<OpenOrderCoverage>> => {
    const res = await apiClient.get<ReportResponse<OpenOrderCoverage>>(
      "/api/reports/sales/open-order-coverage",
      { params },
    );
    return res.data;
  },
};

const bucketTable = (name: string, labelHeader: string, rows: CoverageBucketRow[]) => ({
  name,
  columns: [
    { header: labelHeader, key: "label", width: 28 },
    { header: "Kalem", key: "lineCount", width: 10, numFmt: "#,##0" },
    { header: "Açık (m)", key: "openQty", width: 14, numFmt: "#,##0.#" },
    { header: "Depodan (m)", key: "fromWarehouseQty", width: 14, numFmt: "#,##0.#" },
    { header: "Üretimde (m)", key: "fromProductionQty", width: 14, numFmt: "#,##0.#" },
    { header: "Karşılanamayan (m)", key: "uncoveredQty", width: 18, numFmt: "#,##0.#" },
    { header: "Karşılanma %", key: "coveragePct", width: 14, numFmt: "#,##0.#" },
  ],
  rows: rows as unknown as Record<string, unknown>[],
  totalRow: {
    label: "TOPLAM",
    lineCount: rows.reduce((s, r) => s + r.lineCount, 0),
    openQty: rows.reduce((s, r) => s + r.openQty, 0),
    fromWarehouseQty: rows.reduce((s, r) => s + r.fromWarehouseQty, 0),
    fromProductionQty: rows.reduce((s, r) => s + r.fromProductionQty, 0),
    uncoveredQty: rows.reduce((s, r) => s + r.uncoveredQty, 0),
  },
});

export function buildCoverageExport(c: OpenOrderCoverage, filterNotes: string[] = []): ReportExportSpec {
  return {
    title: "Açık Sipariş Karşılanma",
    subtitle: "Anlık durum",
    meta: [
      ...filterNotes,
      // Tanımlar rakamla AYNI dosyada dursun — dışa aktarılan tablo bağlamından
      // koparak dolaşır ve "karşılanıyor" herkesin kafasında farklı bir şeydir.
      "AÇIK = istenen − sevk edilen. Rezerv/çuvallanmış düşülmez; düşüş yalnız sevkte olur.",
      "DEPODAN = elde duran bitmiş mal. ÜRETİMDE = canlı iş emirlerindeki henüz bitmemiş mal.",
      "Bir stok havuzu YALNIZ BİR KEZ dağıtılır: aynı kumaş+renk+en'i isteyen siparişler havuzu PAYLAŞIR, her biri tamamını almaz. Dağıtım sırası termini yakın olandan uzağa; termini olmayan en sona.",
      "KARŞILANAMAYAN = ne depoda ne üretimde — yeni iş emri gerekir.",
      "MALZEME AÇIĞI = karşılanamayanın ham kumaşı da yok (kumaş tedariki gerekir).",
      "Anlık fotoğraftır: tarih aralığı almaz.",
      c.linesOmitted > 0
        ? `⚠️ ${c.linesOmitted} kalem listeye SIĞMADI (tavan 500). Özet rakamları TÜM kalemleri kapsar, detay tablosu kapsamaz.`
        : "Tüm açık kalemler detay tablosunda listelendi.",
    ],
    tables: [
      bucketTable("Müşteri", "Müşteri", c.byCustomer),
      bucketTable("Kumaş", "Kumaş", c.byItem),
      {
        name: "Kalemler",
        columns: [
          { header: "Sipariş", key: "orderNumber", width: 18 },
          { header: "Müşteri", key: "customerName", width: 24 },
          { header: "Kumaş", key: "itemName", width: 22 },
          { header: "Renk", key: "colorName", width: 16 },
          { header: "En", key: "width", width: 8, numFmt: "#,##0.#" },
          { header: "Termin", key: "deadlineText", width: 14 },
          { header: "Gecikme (gün)", key: "daysLate", width: 14, numFmt: "#,##0" },
          { header: "Açık (m)", key: "openQty", width: 12, numFmt: "#,##0.#" },
          { header: "Depodan (m)", key: "fromWarehouseQty", width: 14, numFmt: "#,##0.#" },
          { header: "Üretimde (m)", key: "fromProductionQty", width: 14, numFmt: "#,##0.#" },
          { header: "Karşılanamayan (m)", key: "uncoveredQty", width: 18, numFmt: "#,##0.#" },
          { header: "Durum", key: "stateText", width: 18 },
        ],
        rows: c.lines.map((l) => ({
          ...l,
          colorName: l.colorName ?? "—",
          deadlineText: l.deadline ? new Date(l.deadline).toLocaleDateString("tr-TR") : "—",
          daysLate: l.daysLate ?? "",
          stateText: COVERAGE_STATE_LABEL[l.state],
        })),
      },
    ],
  };
}
