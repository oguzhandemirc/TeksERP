// Sipariş → Teslim Süresi — servis tipleri + dışa aktarım spec'i.
// Backend `order-leadtime.report.service.ts` tipinin aynası.

import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams, ReportResponse } from "../_services/types";
import type { ReportExportSpec } from "../_components/reportExport";

export interface LeadTimeStats {
  sampleSize: number;
  medianDays: number | null;
  avgDays: number | null;
  p90Days: number | null;
  minDays: number | null;
  maxDays: number | null;
}

export interface LeadTimeBucketRow {
  key: string;
  label: string;
  firstShip: LeadTimeStats;
  fullClose: LeadTimeStats;
}

export interface LeadTimeOrderRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  firstShipDate: string | null;
  firstShipDays: number | null;
  completedAt: string | null;
  fullCloseDays: number | null;
  openDays: number | null;
}

export interface OrderLeadTime {
  firstShip: LeadTimeStats;
  fullClose: LeadTimeStats;
  byCustomer: LeadTimeBucketRow[];
  byItem: LeadTimeBucketRow[];
  orders: LeadTimeOrderRow[];
  neverShippedCount: number;
  minSample: number;
}

export const orderLeadTimeApi = {
  get: (params: ReportDateParams): Promise<ReportResponse<OrderLeadTime>> =>
    reportsClient.get<OrderLeadTime>("sales/order-leadtime", params),
};

/** Örneklem eşiğin altındaysa SAYI BASILMAZ — sebebi yazılır. */
export const statText = (s: LeadTimeStats, minSample: number): string =>
  s.sampleSize === 0
    ? "veri yok"
    : s.sampleSize < minSample
      ? `${s.medianDays} gün (yalnız ${s.sampleSize} örnek — güvenilmez)`
      : `${s.medianDays} gün`;

export function buildLeadTimeExport(opts: {
  lt: OrderLeadTime;
  periodLabel: string;
  /** Süzgeç satırları (K10) — ekrandakiyle AYNI dizi. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { lt, periodLabel, filterNotes = [] } = opts;
  const bucketCols = (labelHeader: string) => [
    { header: labelHeader, key: "label", width: 28 },
    { header: "İlk sevk örneklemi", key: "fsN", width: 16, numFmt: "#,##0" },
    { header: "İlk sevk medyan (gün)", key: "fsMed", width: 18, numFmt: "#,##0.#" },
    { header: "Kapanış örneklemi", key: "fcN", width: 16, numFmt: "#,##0" },
    { header: "Kapanış medyan (gün)", key: "fcMed", width: 18, numFmt: "#,##0.#" },
    { header: "Kapanış P90 (gün)", key: "fcP90", width: 16, numFmt: "#,##0.#" },
  ];
  const bucketRows = (rows: LeadTimeBucketRow[]) =>
    rows.map((r) => ({
      label: r.label,
      fsN: r.firstShip.sampleSize,
      fsMed: r.firstShip.medianDays ?? "",
      fcN: r.fullClose.sampleSize,
      fcMed: r.fullClose.medianDays ?? "",
      fcP90: r.fullClose.p90Days ?? "",
    }));

  return {
    title: "Sipariş → Teslim Süresi",
    subtitle: periodLabel,
    meta: [
      ...filterNotes,
      "ÇIPA: siparişin ALINDIĞI tarih (orderDate).",
      "İKİ AYRI SÜRE: 'ilk sevk' = mal ne zaman çıkmaya başladı · 'tam kapanış' = sipariş ne zaman bitti. Kısmi sevkli siparişte ikisi çok farklıdır.",
      "ANA RAKAM MEDYANDIR — ortalama tek bir felaket siparişle yukarı çekilir. P90 taahhüt için: her 10 siparişten 9'u bu sürede çıktı.",
      `ÖRNEKLEM EŞİĞİ ${lt.minSample}: altında kalan satırlarda medyan bir istatistik değil tesadüftür ve öyle işaretlenir.`,
      `${lt.neverShippedCount} sipariş hiç sevk görmedi — istatistiğe GİRMEDİ (0 gün gibi sayılsalardı medyanı çökertirlerdi), ayrıca sayıldı.`,
      "İptal edilmiş siparişler kapsam dışıdır.",
    ],
    tables: [
      {
        name: "Özet",
        columns: [
          { header: "Ölçü", key: "label", width: 24 },
          { header: "Örneklem", key: "n", width: 12, numFmt: "#,##0" },
          { header: "Medyan (gün)", key: "med", width: 14, numFmt: "#,##0.#" },
          { header: "Ortalama (gün)", key: "avg", width: 14, numFmt: "#,##0.#" },
          { header: "P90 (gün)", key: "p90", width: 12, numFmt: "#,##0.#" },
          { header: "En hızlı", key: "min", width: 12, numFmt: "#,##0.#" },
          { header: "En yavaş", key: "max", width: 12, numFmt: "#,##0.#" },
        ],
        rows: [
          { label: "İlk sevke kadar", n: lt.firstShip.sampleSize, med: lt.firstShip.medianDays ?? "", avg: lt.firstShip.avgDays ?? "", p90: lt.firstShip.p90Days ?? "", min: lt.firstShip.minDays ?? "", max: lt.firstShip.maxDays ?? "" },
          { label: "Tam kapanışa kadar", n: lt.fullClose.sampleSize, med: lt.fullClose.medianDays ?? "", avg: lt.fullClose.avgDays ?? "", p90: lt.fullClose.p90Days ?? "", min: lt.fullClose.minDays ?? "", max: lt.fullClose.maxDays ?? "" },
        ],
      },
      { name: "Müşteri", columns: bucketCols("Müşteri"), rows: bucketRows(lt.byCustomer) },
      {
        name: "Kumaş",
        columns: bucketCols("Kumaş"),
        rows: bucketRows(lt.byItem),
        notes: ["Çok kumaşlı sipariş her kumaşa sayılır — satır toplamı sipariş sayısını aşabilir."],
      },
      {
        name: "Siparişler",
        columns: [
          { header: "Sipariş", key: "orderNumber", width: 18 },
          { header: "Müşteri", key: "customerName", width: 24 },
          { header: "Sipariş tarihi", key: "orderDateText", width: 14 },
          { header: "İlk sevk", key: "firstShipText", width: 14 },
          { header: "İlk sevk (gün)", key: "firstShipDays", width: 14, numFmt: "#,##0.#" },
          { header: "Kapanış (gün)", key: "fullCloseDays", width: 14, numFmt: "#,##0.#" },
          { header: "Açık (gün)", key: "openDays", width: 12, numFmt: "#,##0.#" },
        ],
        rows: lt.orders.map((o) => ({
          ...o,
          orderDateText: new Date(o.orderDate).toLocaleDateString("tr-TR"),
          firstShipText: o.firstShipDate ? new Date(o.firstShipDate).toLocaleDateString("tr-TR") : "—",
          firstShipDays: o.firstShipDays ?? "",
          fullCloseDays: o.fullCloseDays ?? "",
          openDays: o.openDays ?? "",
        })),
      },
    ],
  };
}
