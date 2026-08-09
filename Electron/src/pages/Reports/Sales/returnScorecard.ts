// İade Karnesi — servis tipleri + dışa aktarım spec'i.
// Backend `return-scorecard.report.service` ile birebir.

import { reportsClient } from "../_services/reportsClient";
import type { BreakdownRow } from "../_components/BreakdownTable";
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { ReportCompareParams } from "../_services/types";

export interface ReturnScorecard {
  summary: {
    returnQty: number;
    returnRollCount: number;
    /** Aynı dönemde sevk edilen BRÜT metraj (iade geri eklenmiş). */
    shippedQty: number;
    returnPct: number;
    freeTextReasonCount: number;
    missingReasonCount: number;
    prevReturnQty?: number;
    prevReturnPct?: number;
    prevShippedQty?: number;
  };
  byCustomer: BreakdownRow[];
  byReason: BreakdownRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  daily: Array<{ day: string; qty: number; count: number }>;
}

export const returnScorecardApi = {
  get: (p: ReportCompareParams) => reportsClient.get<ReturnScorecard>("sales/return-scorecard", p),
};

function table(name: string, labelHeader: string, rows: BreakdownRow[], hasCompare: boolean): ReportTableSpec {
  return {
    name,
    columns: [
      { header: labelHeader, key: "label", width: 28 },
      { header: "Top", key: "count", width: 8, numFmt: "#,##0", align: "right" },
      { header: "İade (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
      ...(hasCompare
        ? [
            { header: "Önceki (m)", key: "prevQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
            { header: "Δ (m)", key: "delta", width: 11, numFmt: "#,##0.0", align: "right" as const },
          ]
        : []),
    ],
    rows: rows.map((r) => ({
      label: r.label,
      count: r.count,
      qty: r.qty,
      ...(hasCompare
        ? { prevQty: r.prevQty ?? 0, delta: Math.round((r.qty - (r.prevQty ?? 0)) * 10) / 10 }
        : {}),
    })),
    totalRow: {
      label: "TOPLAM",
      count: rows.reduce((a, r) => a + r.count, 0),
      qty: Math.round(rows.reduce((a, r) => a + r.qty, 0) * 10) / 10,
      ...(hasCompare
        ? {
            prevQty: Math.round(rows.reduce((a, r) => a + (r.prevQty ?? 0), 0) * 10) / 10,
            delta: Math.round(rows.reduce((a, r) => a + (r.qty - (r.prevQty ?? 0)), 0) * 10) / 10,
          }
        : {}),
    },
  };
}

export function buildReturnExport(opts: {
  sc: ReturnScorecard;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel } = opts;
  const hasCompare = compareLabel !== null;

  const meta = [
    // Oranın TANIMI rakamla aynı dosyada durmalı — Excel elden ele dolaşıyor.
    `İade oranı = dönemde iade alınan (${sc.summary.returnQty} m) / dönemde sevk edilen (${sc.summary.shippedQty} m).`,
    "Sevk metrajı BRÜT'tür: iade edilen toplar sevk rakamından düşülmez (sevk anı esas alınır).",
    "İki kümenin kapsamı bilinçli olarak farklıdır: bu ay iade alınan bir mal geçen ay sevk edilmiş olabilir — oran bir KOHORT oranı değildir.",
    "İptal edilen (yanlış kabul edilip geri alınan) iadeler hiçbir yerde sayılmaz.",
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);
  if (sc.summary.freeTextReasonCount > 0 || sc.summary.missingReasonCount > 0) {
    meta.push(
      `Sebep verisi: ${sc.summary.freeTextReasonCount} iade serbest metinle, ${sc.summary.missingReasonCount} iade sebepsiz kaydedildi.`,
    );
  }

  return {
    title: "İade Karnesi",
    subtitle: periodLabel,
    meta,
    tables: [
      table("Müşteri Bazında", "Müşteri", sc.byCustomer, hasCompare),
      table("Neden Bazında", "İade nedeni", sc.byReason, hasCompare),
      table("Kumaş Bazında", "Kumaş", sc.byItem, hasCompare),
      table("Renk Bazında", "Renk", sc.byColor, hasCompare),
      {
        name: "Günlük Seyir",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "İade (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Top", key: "count", width: 9, numFmt: "#,##0", align: "right" },
        ],
        rows: sc.daily.map((d) => ({ ...d })),
      },
    ],
  };
}
