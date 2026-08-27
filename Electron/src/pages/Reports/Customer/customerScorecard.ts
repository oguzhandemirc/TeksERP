// Müşteri Karnesi (ABC + RFM) — servis tipleri + dışa aktarım spec'i.
// Backend `customer-scorecard.report.service.ts` tipinin aynası.

import { reportsClient } from "../_services/reportsClient";
import type { ReportCompareParams, ReportResponse } from "../_services/types";
import type { ReportExportSpec } from "../_components/reportExport";

export type AbcClass = "A" | "B" | "C";

export interface CustomerRankRow {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  orderCount: number;
  lineCount: number;
  totalQty: number;
  avgOrderQty: number;
  sharePct: number;
  cumulativePct: number;
  abcClass: AbcClass;
  lifetimeOrderCount: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  avgIntervalDays: number | null;
  topItemName: string | null;
  prevQty?: number;
}

export interface AtRiskCustomerRow {
  customerId: string;
  customerName: string;
  lastOrderDate: string;
  daysSinceLastOrder: number;
  avgIntervalDays: number;
  overdueRatio: number;
  lifetimeOrderCount: number;
  lifetimeQty: number;
}

export interface CustomerScorecard {
  summary: {
    customerCount: number;
    orderCount: number;
    totalQty: number;
    aClassCount: number;
    bClassCount: number;
    cClassCount: number;
    aClassQtyPct: number;
    dormantCount: number;
    atRiskCount: number;
    insufficientHistoryCount: number;
    prevCustomerCount?: number;
    prevTotalQty?: number;
  };
  ranking: CustomerRankRow[];
  atRisk: AtRiskCustomerRow[];
}

export const customerScorecardApi = {
  get: (params: ReportCompareParams): Promise<ReportResponse<CustomerScorecard>> =>
    reportsClient.get<CustomerScorecard>("customer/scorecard", params),
};

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "—");

export function buildCustomerScorecardExport(opts: {
  sc: CustomerScorecard;
  periodLabel: string;
  compareLabel: string | null;
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel } = opts;
  const hasCompare = Boolean(compareLabel);
  return {
    title: "Müşteri Karnesi",
    subtitle: periodLabel,
    meta: [
      // İki zaman kapsamı dosyada da yazılı olmalı — dışa aktarılan tablo
      // bağlamından koparak dolaşır ve iki sütun farklı dönemi anlatır.
      "ABC sıralaması ve dönem metrikleri SEÇİLİ TARİH ARALIĞINA aittir.",
      "'Kaç gündür sessiz' ve 'ortalama sipariş aralığı' TÜM GEÇMİŞTEN hesaplanır — dönem içine hapsedilse herkes sessiz görünürdü.",
      "ABC: kümülatif payın %80'ine kadar A, %95'e kadar B, gerisi C.",
      "RİSK ölçüsü mutlak gün değil ORANDIR: geçen süre / müşterinin kendi ortalama sipariş aralığı. Eşik 2×.",
      `Ritim en az 3 sipariş ister; ${sc.summary.insufficientHistoryCount} müşterinin geçmişi yetersiz olduğu için risk listesine GİRMEDİ (yok sayılmadı).`,
      `Dönemde ${sc.summary.aClassCount} A-sınıfı müşteri metrajın %${sc.summary.aClassQtyPct}'ini taşıdı.`,
      `${sc.summary.dormantCount} müşteri geçmişte sipariş verdi ama bu dönemde vermedi.`,
      ...(compareLabel ? [`Karşılaştırma dönemi: ${compareLabel}`] : []),
    ],
    tables: [
      {
        name: "Sıralama (ABC)",
        columns: [
          { header: "#", key: "rank", width: 6, numFmt: "#,##0" },
          { header: "Sınıf", key: "abcClass", width: 8 },
          { header: "Müşteri", key: "customerName", width: 28 },
          { header: "Kod", key: "customerCode", width: 14 },
          { header: "Sipariş", key: "orderCount", width: 10, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "totalQty", width: 14, numFmt: "#,##0.#" },
          ...(hasCompare
            ? [{ header: "Önceki (m)", key: "prevQty", width: 14, numFmt: "#,##0.#" }]
            : []),
          { header: "Ort. sipariş (m)", key: "avgOrderQty", width: 16, numFmt: "#,##0.#" },
          { header: "Pay %", key: "sharePct", width: 10, numFmt: "#,##0.#" },
          { header: "Kümülatif %", key: "cumulativePct", width: 14, numFmt: "#,##0.#" },
          { header: "Ort. aralık (gün)", key: "avgIntervalDays", width: 16, numFmt: "#,##0.#" },
          { header: "Son sipariş", key: "lastOrderText", width: 14 },
          { header: "Sessiz (gün)", key: "daysSinceLastOrder", width: 12, numFmt: "#,##0" },
          { header: "Favori kumaş", key: "topItemName", width: 22 },
        ],
        rows: sc.ranking.map((r, i) => ({
          ...r,
          rank: i + 1,
          customerCode: r.customerCode ?? "—",
          avgIntervalDays: r.avgIntervalDays ?? "",
          lastOrderText: dt(r.lastOrderDate),
          daysSinceLastOrder: r.daysSinceLastOrder ?? "",
          topItemName: r.topItemName ?? "—",
        })),
        totalRow: {
          customerName: "TOPLAM",
          orderCount: sc.summary.orderCount,
          totalQty: sc.summary.totalQty,
        },
      },
      {
        name: "Risk (kaybolan müşteri)",
        columns: [
          { header: "Müşteri", key: "customerName", width: 28 },
          { header: "Son sipariş", key: "lastOrderText", width: 14 },
          { header: "Sessiz (gün)", key: "daysSinceLastOrder", width: 12, numFmt: "#,##0" },
          { header: "Ort. aralık (gün)", key: "avgIntervalDays", width: 16, numFmt: "#,##0.#" },
          { header: "Kat", key: "overdueRatio", width: 8, numFmt: "#,##0.#" },
          { header: "Toplam sipariş", key: "lifetimeOrderCount", width: 14, numFmt: "#,##0" },
          { header: "Toplam metraj (m)", key: "lifetimeQty", width: 16, numFmt: "#,##0.#" },
        ],
        rows: sc.atRisk.map((r) => ({ ...r, lastOrderText: dt(r.lastOrderDate) })),
        notes: [
          "Kat = sessiz geçen süre / müşterinin kendi ortalama sipariş aralığı. 2 ve üzeri listeye girer.",
          "Bu liste DÖNEMDEN BAĞIMSIZDIR — tüm müşteri geçmişi üzerinden hesaplanır.",
        ],
      },
    ],
  };
}
