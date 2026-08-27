// Sipariş Karnesi (giriş tarafı) — servis tipleri + dışa aktarım spec'i.
// Backend `order-intake.report.service.ts` tipinin aynası.

import { reportsClient } from "../_services/reportsClient";
import type { ReportCompareParams, ReportResponse } from "../_services/types";
import type { BreakdownRow } from "../_components";
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";

export interface OrderIntake {
  summary: {
    orderCount: number;
    cancelledCount: number;
    cancelledPct: number;
    activeOrderCount: number;
    lineCount: number;
    totalQty: number;
    avgOrderQty: number;
    avgLinesPerOrder: number;
    customerCount: number;
    withDeadlineCount: number;
    prevOrderCount?: number;
    prevTotalQty?: number;
    prevAvgOrderQty?: number;
  };
  byCustomer: BreakdownRow[];
  byItem: BreakdownRow[];
  daily: Array<{ day: string; orderCount: number; qty: number }>;
}

export const orderIntakeApi = {
  get: (params: ReportCompareParams): Promise<ReportResponse<OrderIntake>> =>
    reportsClient.get<OrderIntake>("sales/order-intake", params),
};

/** Kırılım tablosu — karşılaştırma açıksa "Önceki" + "Δ" kolonları eklenir. */
function table(
  name: string,
  labelHeader: string,
  countHeader: string,
  rows: BreakdownRow[],
  hasCompare: boolean,
): ReportTableSpec {
  const columns = [
    { header: labelHeader, key: "label", width: 28 },
    { header: countHeader, key: "count", width: 12, numFmt: "#,##0" },
    { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
  ];
  if (hasCompare) {
    columns.push(
      { header: "Önceki (m)", key: "prevQty", width: 14, numFmt: "#,##0.#" },
      { header: "Δ (m)", key: "delta", width: 12, numFmt: "#,##0.#" },
    );
  }
  return {
    name,
    columns,
    rows: rows.map((r) => ({
      ...r,
      delta: hasCompare ? Math.round((r.qty - (r.prevQty ?? 0)) * 10) / 10 : undefined,
    })) as unknown as Record<string, unknown>[],
    totalRow: {
      label: "TOPLAM",
      count: rows.reduce((s, r) => s + r.count, 0),
      qty: Math.round(rows.reduce((s, r) => s + r.qty, 0) * 10) / 10,
      ...(hasCompare
        ? {
            prevQty: Math.round(rows.reduce((s, r) => s + (r.prevQty ?? 0), 0) * 10) / 10,
            delta:
              Math.round(
                (rows.reduce((s, r) => s + r.qty, 0) -
                  rows.reduce((s, r) => s + (r.prevQty ?? 0), 0)) * 10,
              ) / 10,
          }
        : {}),
    },
  };
}

export function buildOrderIntakeExport(opts: {
  oi: OrderIntake;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { oi, periodLabel, compareLabel } = opts;
  const hasCompare = Boolean(compareLabel);
  return {
    title: "Sipariş Karnesi",
    subtitle: periodLabel,
    meta: [
      // Tanımlar rakamla aynı dosyada dursun — dosya bağlamından koparak dolaşır.
      "ÇIPA: siparişin ALINDIĞI tarih (orderDate) — kaydın sisteme yazıldığı an değil.",
      `ADET dönemde açılan TÜM siparişleri sayar (sonradan iptal edilen ${oi.summary.cancelledCount} sipariş DAHİL).`,
      "METRAJ iptalleri DIŞLAR — iptal edilmiş siparişin üretilecek metrajı yoktur.",
      `ORTALAMA sipariş büyüklüğünün paydası iptalsiz sipariş adedidir (${oi.summary.activeOrderCount}).`,
      `Dönemde ${oi.summary.customerCount} farklı müşteri sipariş verdi; ${oi.summary.withDeadlineCount} siparişte termin var.`,
      ...(compareLabel ? [`Karşılaştırma dönemi: ${compareLabel}`] : []),
    ],
    tables: [
      table("Müşteri", "Müşteri", "Sipariş", oi.byCustomer, hasCompare),
      table("Kumaş", "Kumaş", "Kalem", oi.byItem, hasCompare),
      {
        name: "Günlük",
        columns: [
          { header: "Gün", key: "day", width: 14 },
          { header: "Sipariş", key: "orderCount", width: 12, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "qty", width: 14, numFmt: "#,##0.#" },
        ],
        rows: oi.daily as unknown as Record<string, unknown>[],
        totalRow: {
          day: "TOPLAM",
          orderCount: oi.daily.reduce((s, d) => s + d.orderCount, 0),
          qty: Math.round(oi.daily.reduce((s, d) => s + d.qty, 0) * 10) / 10,
        },
      },
    ],
  };
}
