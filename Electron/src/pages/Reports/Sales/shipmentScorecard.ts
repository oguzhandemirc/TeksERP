// Sevk & Termin Karnesi (OTIF) — servis tipleri + dışa aktarım spec'i.

import { reportsClient } from "../_services/reportsClient";
import type { BreakdownRow } from "../_components/BreakdownTable";
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { ReportCompareParams } from "../_services/types";

export interface ShipmentScorecard {
  summary: {
    shippedQty: number;
    shippedRollCount: number;
    completedOrders: number;
    onTimeOrders: number;
    withDeadlineOrders: number;
    /** Termini olmayan — orandan çıkarıldı, gizlenmedi. */
    noDeadlineOrders: number;
    onTimePct: number;
    avgLateDays: number | null;
    prevShippedQty?: number;
    prevOnTimePct?: number;
  };
  byCustomer: BreakdownRow[];
  byItem: BreakdownRow[];
  daily: Array<{ day: string; qty: number }>;
  overdueOpen: Array<{
    orderId: string;
    orderNumber: string;
    customerName: string;
    deadline: string;
    daysLate: number;
    plannedQty: number;
    shippedQty: number;
  }>;
}

export const shipmentScorecardApi = {
  get: (p: ReportCompareParams) =>
    reportsClient.get<ShipmentScorecard>("sales/shipment-scorecard", p),
};

function table(name: string, labelHeader: string, rows: BreakdownRow[], hasCompare: boolean): ReportTableSpec {
  return {
    name,
    columns: [
      { header: labelHeader, key: "label", width: 28 },
      { header: "Top", key: "count", width: 8, numFmt: "#,##0", align: "right" },
      { header: "Sevk (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
      ...(hasCompare
        ? [
            { header: "Önceki (m)", key: "prevQty", width: 13, numFmt: "#,##0.0", align: "right" as const },
            { header: "Δ (m)", key: "delta", width: 11, numFmt: "#,##0.0", align: "right" as const },
          ]
        : []),
    ],
    rows: rows.map((r) => ({
      label: r.label, count: r.count, qty: r.qty,
      ...(hasCompare ? { prevQty: r.prevQty ?? 0, delta: Math.round((r.qty - (r.prevQty ?? 0)) * 10) / 10 } : {}),
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

export function buildShipmentExport(opts: {
  sc: ShipmentScorecard;
  periodLabel: string;
  compareLabel: string | null;
  /** Ekrandaki süzgeç satırları — çıktıya AYNI dizi girer. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel, filterNotes = [] } = opts;
  const hasCompare = compareLabel !== null;

  const meta = [
    "SEVK metrajı, sevkiyatın çıkış (DISPATCHED) anına göre alınır ve BRÜT'tür (iade düşülmez). Doğrudan sevkler dahildir.",
    `ZAMANINDA TESLİM oranı AYRI bir çıpa kullanır: dönemde KAPANAN siparişler (${sc.summary.completedOrders} adet), termin tarihiyle karşılaştırılır.`,
    `Termini olmayan ${sc.summary.noDeadlineOrders} sipariş orana DAHİL EDİLMEDİ — "zamanında" saymak oranı sahte yükseltir, "geç" saymak haksız düşürürdü.`,
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);
  meta.unshift(...filterNotes);

  return {
    title: "Sevk ve Termin Karnesi",
    subtitle: periodLabel,
    meta,
    tables: [
      table("Müşteri Bazında Sevk", "Müşteri", sc.byCustomer, hasCompare),
      table("Kumaş Bazında Sevk", "Kumaş", sc.byItem, hasCompare),
      {
        name: "Geciken Açık Siparişler",
        columns: [
          { header: "Sipariş No", key: "orderNumber", width: 18 },
          { header: "Müşteri", key: "customerName", width: 26 },
          { header: "Termin", key: "deadline", width: 14 },
          { header: "Gecikme (gün)", key: "daysLate", width: 14, numFmt: "0.0", align: "right" },
          { header: "İstenen (m)", key: "plannedQty", width: 13, numFmt: "#,##0.0", align: "right" },
          { header: "Sevk (m)", key: "shippedQty", width: 13, numFmt: "#,##0.0", align: "right" },
        ],
        rows: sc.overdueOpen.map((r) => ({ ...r, deadline: r.deadline.slice(0, 10) })),
        notes: ["Bu liste DÖNEMDEN BAĞIMSIZDIR: şu an termini geçmiş ve hâlâ açık siparişleri gösterir."],
      },
      {
        name: "Günlük Sevk",
        columns: [
          { header: "Gün", key: "day", width: 12 },
          { header: "Sevk (m)", key: "qty", width: 13, numFmt: "#,##0.0", align: "right" },
        ],
        rows: sc.daily.map((d) => ({ ...d })),
      },
    ],
  };
}
