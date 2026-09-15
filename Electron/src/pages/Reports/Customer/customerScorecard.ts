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
  /** Sipariş BELGESİ adedi — giriş alışkanlığına duyarlı, tek başına sıralanmaz. */
  orderCount: number;
  /** Aktif kalem adedi — "kaç ayrı mal istedi", belge sayısından bağımsız. */
  lineCount: number;
  /** Kalem/sipariş — iki giriş alışkanlığını ayırt eden sayı. */
  avgLinesPerOrder: number;
  /** Sipariş verilen ayrı gün sayısı — "sıklık"ın dürüst ölçüsü. */
  orderDayCount: number;
  totalQty: number;
  avgOrderQty: number;
  sharePct: number;
  cumulativePct: number;
  abcClass: AbcClass;
  cancelledQty: number;
  cancelRatePct: number;
  /** Dönemde SEVK EDİLEN brüt metraj — aynı siparişlere ait değil. */
  shippedQty: number;
  lifetimeOrderCount: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  avgIntervalDays: number | null;
  topItemName: string | null;
  topColorName: string | null;
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
    lineCount: number;
    avgLinesPerOrder: number;
    totalQty: number;
    cancelledQty: number;
    cancelRatePct: number;
    cancelledOrderCount: number;
    shippedQty: number;
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

/** Çıktı başlığındaki şerhler — süzgeç satırları EN ÜSTTE (K10). */
function scorecardMeta(sc: CustomerScorecard, filterNotes: string[], compareLabel: string | null): string[] {
  return [
    ...filterNotes,
    // İki zaman kapsamı dosyada da yazılı olmalı — dışa aktarılan tablo
    // bağlamından koparak dolaşır ve iki sütun farklı dönemi anlatır.
    "ABC sıralaması ve dönem metrikleri SEÇİLİ TARİH ARALIĞINA aittir.",
    "'Kaç gündür sessiz' ve 'ortalama sipariş aralığı' TÜM GEÇMİŞTEN hesaplanır — dönem içine hapsedilse herkes sessiz görünürdü.",
    "ABC: kümülatif payın %80'ine kadar A, %95'e kadar B, gerisi C.",
    // Kullanıcının işaret ettiği gerçek problem dosyanın İÇİNDE de yazılı olmalı:
    // Excel tablo bağlamından koparak dolaşır ve "Sipariş" sütunu tek başına
    // okunduğunda giriş alışkanlığını müşteri davranışı sanmak çok kolaydır.
    "⚠️ 'Sipariş' sütunu BELGE sayısıdır ve giriş alışkanlığına duyarlıdır: aynı işi 10 kaleme tek siparişte yazan müşteri 1, 10 ayrı siparişe yazan 10 görünür.",
    "Bu yüzden sıklık ÜÇ sütunla okunur: 'Sipariş' (belge) · 'Kalem' (kaç ayrı mal) · 'Sipariş günü' (kaç ayrı gün — aynı gün girilen 5 sipariş 1 sayılır).",
    "'Kalem/sipariş' bir sıralama ölçütü DEĞİL, okuma anahtarıdır: ~1 ise müşteri tek tek giriyor, yüksekse kalem kalem. Fabrika ortalaması " +
      `${sc.summary.avgLinesPerOrder}.`,
    "Metraj alışkanlıktan BAĞIMSIZDIR — ABC sıralaması bu yüzden metraja dayanır, sipariş adedine değil.",
    `İptal: dönemde verilen siparişlerin %${sc.summary.cancelRatePct}'i (metraj) iptal edildi; ${sc.summary.cancelledOrderCount} sipariş belgesi tümüyle iptal.`,
    "'Sevk (brüt)' dönemde müşteriye ÇIKAN maldır ve aynı siparişlere ait DEĞİLDİR (bugün sevk edilen mal eski siparişten gelmiş olabilir); iade ayrı belgeyle kapanır, rakam brüttür.",
    `Dönemde sevk edilen toplam brüt metraj ${sc.summary.shippedQty} m — bu toplam, dönemde sipariş vermeyip yalnız mal alan müşterileri de kapsar, yani satır toplamından büyük olabilir.`,
    "RİSK ölçüsü mutlak gün değil ORANDIR: geçen süre / müşterinin kendi ortalama sipariş aralığı. Eşik 2×.",
    `Ritim en az 3 sipariş ister; ${sc.summary.insufficientHistoryCount} müşterinin geçmişi yetersiz olduğu için risk listesine GİRMEDİ (yok sayılmadı).`,
    `Dönemde ${sc.summary.aClassCount} A-sınıfı müşteri metrajın %${sc.summary.aClassQtyPct}'ini taşıdı.`,
    `${sc.summary.dormantCount} müşteri geçmişte sipariş verdi ama bu dönemde vermedi.`,
    ...(compareLabel ? [`Karşılaştırma dönemi: ${compareLabel}`] : []),
  ];
}

export function buildCustomerScorecardExport(opts: {
  sc: CustomerScorecard;
  periodLabel: string;
  compareLabel: string | null;
  /** Süzgeç satırları (K10) — ABC'nin süzülmüş evren şerhi de bunun içinde. */
  filterNotes?: string[];
}): ReportExportSpec {
  const { sc, periodLabel, compareLabel, filterNotes = [] } = opts;
  const hasCompare = compareLabel !== null;
  return {
    title: "Müşteri Karnesi", subtitle: periodLabel,
    meta: scorecardMeta(sc, filterNotes, compareLabel),
    tables: [
      {
        name: "Sıralama (ABC)",
        columns: [
          { header: "#", key: "rank", width: 6, numFmt: "#,##0" },
          { header: "Sınıf", key: "abcClass", width: 8 },
          { header: "Müşteri", key: "customerName", width: 28 },
          { header: "Kod", key: "customerCode", width: 14 },
          { header: "Sipariş", key: "orderCount", width: 10, numFmt: "#,##0" },
          { header: "Kalem", key: "lineCount", width: 10, numFmt: "#,##0" },
          { header: "Kalem/sipariş", key: "avgLinesPerOrder", width: 14, numFmt: "#,##0.00" },
          { header: "Sipariş günü", key: "orderDayCount", width: 13, numFmt: "#,##0" },
          { header: "Metraj (m)", key: "totalQty", width: 14, numFmt: "#,##0.#" },
          ...(hasCompare
            ? [{ header: "Önceki (m)", key: "prevQty", width: 14, numFmt: "#,##0.#" }]
            : []),
          { header: "Ort. sipariş (m)", key: "avgOrderQty", width: 16, numFmt: "#,##0.#" },
          { header: "Pay %", key: "sharePct", width: 10, numFmt: "#,##0.#" },
          { header: "Kümülatif %", key: "cumulativePct", width: 14, numFmt: "#,##0.#" },
          { header: "Ort. aralık (gün)", key: "avgIntervalDays", width: 16, numFmt: "#,##0.#" },
          { header: "İlk sipariş", key: "firstOrderText", width: 14 },
          { header: "Son sipariş", key: "lastOrderText", width: 14 },
          { header: "Sessiz (gün)", key: "daysSinceLastOrder", width: 12, numFmt: "#,##0" },
          { header: "İptal (m)", key: "cancelledQty", width: 12, numFmt: "#,##0.#" },
          { header: "İptal %", key: "cancelRatePct", width: 10, numFmt: "#,##0.#" },
          { header: "Sevk brüt (m)", key: "shippedQty", width: 14, numFmt: "#,##0.#" },
          { header: "Favori kumaş", key: "topItemName", width: 22 },
          { header: "Favori renk", key: "topColorName", width: 18 },
        ],
        rows: sc.ranking.map((r, i) => ({
          ...r,
          rank: i + 1,
          customerCode: r.customerCode ?? "—",
          avgIntervalDays: r.avgIntervalDays ?? "",
          firstOrderText: dt(r.firstOrderDate),
          lastOrderText: dt(r.lastOrderDate),
          daysSinceLastOrder: r.daysSinceLastOrder ?? "",
          topItemName: r.topItemName ?? "—",
          topColorName: r.topColorName ?? "—",
        })),
        // ⚠️ TOPLAM SATIRINDA `shippedQty` YOK — bilinçli. Sevk toplamı dönemde
        // sipariş VERMEYEN müşterileri de kapsıyor, yani sütun toplamıyla
        // özet rakamı meşruen ayrışıyor. Toplam basmak, ayrışmayı "hata" gibi
        // gösterip rapora olan güveni bitirirdi; fark meta satırında yazılı.
        totalRow: {
          customerName: "TOPLAM",
          orderCount: sc.summary.orderCount,
          lineCount: sc.summary.lineCount,
          avgLinesPerOrder: sc.summary.avgLinesPerOrder,
          totalQty: sc.summary.totalQty,
          cancelledQty: sc.summary.cancelledQty,
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
