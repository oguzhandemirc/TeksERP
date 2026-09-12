// Fason Karnesi — servis tipleri + dışa aktarım spec'i.
// Backend `subcontract-scorecard.report.service` ile birebir.

import { reportsClient } from "../_services/reportsClient";
import type { ReportExportSpec } from "../_components/reportExport";
import type { ReportCompareParams } from "../_services/types";

export interface SubcontractScorecardRow {
  key: string;
  label: string;
  dispatchItems: number;
  dispatchedQty: number;
  /** Fire PAYDASI — yalnız dönüşü gelmiş kalemler. */
  closedDispatchedQty: number;
  returnedQty: number;
  /** Fasondan doğrudan müşteriye giden metre — başarılı teslim, fire değil. */
  deliveredQty: number;
  fireQty: number;
  firePct: number;
  openItems: number;
  openQty: number;
  /** Topu BAŞKA sevkin doğrudan sevkiyle çıkmış kalemler — ölçülemez, oranın dışında. */
  unattributedItems: number;
  unattributedQty: number;
  avgTurnaroundDays: number | null;
  prevFirePct?: number;
  prevDispatchedQty?: number;
}

export interface SubcontractScorecard {
  summary: {
    dispatchedQty: number;
    closedDispatchedQty: number;
    returnedQty: number;
    deliveredQty: number;
    fireQty: number;
    firePct: number;
    openItems: number;
    openQty: number;
    unattributedItems: number;
    unattributedQty: number;
    avgTurnaroundDays: number | null;
    prevFirePct?: number;
    prevDispatchedQty?: number;
  };
  bySubcontractor: SubcontractScorecardRow[];
  oldestOpen: Array<{
    dispatchId: string;
    dispatchNo: string;
    subcontractorName: string;
    dispatchedAt: string;
    daysOpen: number;
    openItems: number;
    openQty: number;
  }>;
}

export const subcontractScorecardApi = {
  get: (p: ReportCompareParams) =>
    reportsClient.get<SubcontractScorecard>("subcontract/scorecard", p),
};

export function buildSubcontractExport(opts: {
  sc: SubcontractScorecard;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel } = opts;
  const hasCompare = compareLabel !== null;

  const meta = [
    // Fire oranının tanımı — bu cümle olmadan rakam "giden−dönen / giden" sanılır
    // ve henüz dönmemiş mal yüzünden abartılı okunur.
    "FİRE = (kapanmış kalemlerin giden metrajı − dönen metraj − müşteriye giden metraj) / kapanmış kalemlerin giden metrajı.",
    "Henüz dönmemiş (açık) kalemler fire hesabına GİRMEZ; ayrı 'açık bakiye' olarak raporlanır.",
    "Topu BAŞKA bir sevkin doğrudan sevkiyle çıkmış kalemler ölçülemez sayılır: ne fireye ne açık bakiyeye girer.",
    "Fasondan doğrudan müşteriye sevk edilen metre başarılı teslimdir: fire sayılmaz, paydadan da düşülmez. İptal edilen sevkler kapsam dışıdır.",
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);

  return {
    title: "Fason Karnesi",
    subtitle: periodLabel,
    meta,
    tables: [
      {
        name: "Firma Bazında",
        columns: [
          { header: "Fason firma", key: "label", width: 26 },
          { header: "Kalem", key: "dispatchItems", width: 8, numFmt: "#,##0", align: "right" },
          { header: "Giden (m)", key: "dispatchedQty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Kapanan (m)", key: "closedDispatchedQty", width: 14, numFmt: "#,##0.0", align: "right" },
          { header: "Dönen (m)", key: "returnedQty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Müşteriye (m)", key: "deliveredQty", width: 14, numFmt: "#,##0.0", align: "right" },
          { header: "Fire (m)", key: "fireQty", width: 12, numFmt: "#,##0.0", align: "right" },
          { header: "Fire %", key: "firePct", width: 10, numFmt: "0.0", align: "right" },
          { header: "Açık (m)", key: "openQty", width: 12, numFmt: "#,##0.0", align: "right" },
          { header: "Ölçülemez (m)", key: "unattributedQty", width: 14, numFmt: "#,##0.0", align: "right" },
          { header: "Süre (gün)", key: "avgTurnaroundDays", width: 12, numFmt: "0.0", align: "right" },
          ...(hasCompare
            ? [{ header: "Önceki fire %", key: "prevFirePct", width: 14, numFmt: "0.0", align: "right" as const }]
            : []),
        ],
        rows: sc.bySubcontractor.map((r) => ({ ...r })),
        totalRow: {
          label: "TOPLAM",
          dispatchItems: sc.bySubcontractor.reduce((a, r) => a + r.dispatchItems, 0),
          dispatchedQty: sc.summary.dispatchedQty,
          closedDispatchedQty: sc.summary.closedDispatchedQty,
          returnedQty: sc.summary.returnedQty,
          deliveredQty: sc.summary.deliveredQty,
          fireQty: sc.summary.fireQty,
          firePct: sc.summary.firePct,
          openQty: sc.summary.openQty,
          unattributedQty: sc.summary.unattributedQty,
          avgTurnaroundDays: sc.summary.avgTurnaroundDays,
          ...(hasCompare ? { prevFirePct: sc.summary.prevFirePct ?? 0 } : {}),
        },
      },
      {
        name: "Açık Sevkler",
        columns: [
          { header: "Sevk No", key: "dispatchNo", width: 18 },
          { header: "Fason firma", key: "subcontractorName", width: 24 },
          { header: "Gün", key: "daysOpen", width: 9, numFmt: "0.0", align: "right" },
          { header: "Kalem", key: "openItems", width: 8, numFmt: "#,##0", align: "right" },
          { header: "Metraj (m)", key: "openQty", width: 13, numFmt: "#,##0.0", align: "right" },
        ],
        rows: sc.oldestOpen.map((r) => ({ ...r })),
        notes: [
          "Bu liste DÖNEMDEN BAĞIMSIZDIR: hâlâ dönmemiş tüm sevkleri en eskiden başlayarak gösterir.",
        ],
      },
    ],
  };
}
