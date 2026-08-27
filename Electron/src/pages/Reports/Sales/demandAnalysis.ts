// Talep Analizi — servis tipleri + dışa aktarım spec'i.
// Backend `demand-analysis.report.service.ts` tipinin aynası.

import { reportsClient } from "../_services/reportsClient";
import type { ReportCompareParams, ReportResponse } from "../_services/types";
import type { BreakdownRow } from "../_components";
import type { ReportExportSpec } from "../_components/reportExport";

export interface DemandSpecRow {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  lineCount: number;
  customerCount: number;
  qty: number;
  sharePct: number;
  prevQty?: number;
}

export interface DemandAnalysis {
  summary: {
    totalQty: number;
    lineCount: number;
    specCount: number;
    itemCount: number;
    colorCount: number;
    coreSpecCount: number;
    colorlessQty: number;
    prevTotalQty?: number;
    specsOmitted: number;
  };
  specs: DemandSpecRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  monthly: Array<{ month: string; qty: number; lineCount: number }>;
}

export const demandAnalysisApi = {
  get: (params: ReportCompareParams): Promise<ReportResponse<DemandAnalysis>> =>
    reportsClient.get<DemandAnalysis>("sales/demand-analysis", params),
};

export function buildDemandExport(opts: {
  da: DemandAnalysis;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { da, periodLabel, compareLabel } = opts;
  const hasCompare = Boolean(compareLabel);
  return {
    title: "Talep Analizi",
    subtitle: periodLabel,
    meta: [
      "TALEP kumaş + renk + EN üçlüsünde sayılır. Depodaki mal ancak birebir aynı üçlüyü karşılar; kumaş düzeyinde sıralamak yanlış renk/en üretmeye yol açar.",
      "MÜŞTERİ sütunu FARKLI müşteri sayısıdır — tek müşterinin üç kalemi 'üç müşteri istiyor' diye okunmasın.",
      `ÇEKİRDEK: ${da.summary.coreSpecCount} spec dönem metrajının %80'ini taşıyor (toplam ${da.summary.specCount} spec).`,
      "AYLIK seri SON 24 AYI okur ve seçili tarih aralığından BAĞIMSIZDIR — 30 günlük pencerede mevsim yoktur.",
      "İptal edilmiş siparişler hiçbir rakama girmez.",
      da.summary.colorlessQty > 0
        ? `${da.summary.colorlessQty} m talepte renk belirtilmemiş (ham/serbest boyanacak) — renk kırılımında ayrı satırda.`
        : "Tüm talepte renk belirtilmiş.",
      da.summary.specsOmitted > 0
        ? `⚠️ ${da.summary.specsOmitted} spec listeye SIĞMADI (tavan 300). Özet rakamları tümünü kapsar.`
        : "Tüm spec'ler listelendi.",
      ...(compareLabel ? [`Karşılaştırma dönemi: ${compareLabel}`] : []),
    ],
    tables: [
      {
        name: "Spec (kumaş-renk-en)",
        columns: [
          { header: "#", key: "rank", width: 6, numFmt: "#,##0" },
          { header: "Kumaş", key: "itemName", width: 24 },
          { header: "Renk", key: "colorText", width: 18 },
          { header: "En", key: "width", width: 8, numFmt: "#,##0.#" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
          ...(hasCompare ? [{ header: "Önceki (m)", key: "prevQty", width: 14, numFmt: "#,##0.#" }] : []),
          { header: "Pay %", key: "sharePct", width: 10, numFmt: "#,##0.#" },
          { header: "Kalem", key: "lineCount", width: 10, numFmt: "#,##0" },
          { header: "Müşteri", key: "customerCount", width: 10, numFmt: "#,##0" },
        ],
        rows: da.specs.map((s, i) => ({
          ...s,
          rank: i + 1,
          colorText: s.colorName ?? "Renk belirtilmemiş",
          width: s.width ?? "",
        })),
        totalRow: { itemName: "TOPLAM", qty: da.summary.totalQty, lineCount: da.summary.lineCount },
      },
      {
        name: "Kumaş",
        columns: [
          { header: "Kumaş", key: "label", width: 28 },
          { header: "Kalem", key: "count", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
        ],
        rows: da.byItem as unknown as Record<string, unknown>[],
      },
      {
        name: "Renk",
        columns: [
          { header: "Renk", key: "label", width: 28 },
          { header: "Kalem", key: "count", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
        ],
        rows: da.byColor as unknown as Record<string, unknown>[],
      },
      {
        name: "Aylık (son 24 ay)",
        columns: [
          { header: "Ay", key: "month", width: 12 },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
          { header: "Kalem", key: "lineCount", width: 10, numFmt: "#,##0" },
        ],
        rows: da.monthly as unknown as Record<string, unknown>[],
        notes: ["Bu tablo seçili tarih aralığından bağımsızdır — mevsimsellik için son 24 ay."],
      },
    ],
  };
}
