// Yurtiçi / Yurtdışı Satış (R2, 2026-09-23) — servis tipleri, kapsam metinleri, dışa aktarım.
// Her sayının kaynağı ve kapsamı metinde durur: fiyatsız satır 0 değil "fiyat girilmemiş",
// tartısız çuval "ölçülmedi", kur yoksa TL karşılığı verilmez.

import { reportsClient } from "../_services/reportsClient";
import type { ReportExportSpec, ReportTableSpec } from "../_components/reportExport";
import type { ReportCompareParams } from "../_services/types";
import { fmtInt, fmtNum } from "../_components/formatters";

export type MixBucket = "DOMESTIC" | "EXPORT" | "NONE";
export type OrderBucket = "DOMESTIC" | "EXPORT" | "UNSET";

export interface MoneyAgg {
  lineCount: number;
  pricedLineCount: number;
  amounts: Array<{ currency: string; amount: number; pricedQty: number; avgUnitPrice: number }>;
  tlTotal: number;
  noRateLineCount: number;
}
export interface MixBucketSummary {
  bucket: MixBucket;
  label: string;
  meters: number;
  rollCount: number;
  shipmentCount: number;
  kg: number;
  weighedSacks: number;
  totalSacks: number;
  returnQty: number;
  money: MoneyAgg;
}
export interface MixBreakdownRow { key: string; label: string; bucket: MixBucket; meters: number; money: MoneyAgg; customerCount?: number; country?: string }
export interface BacklogSummary {
  bucket: OrderBucket;
  label: string;
  openQty: number;
  overdueQty: number;
  openLines: number;
  overdueOrders: number;
  nonMtLines: number;
  pricedOpenQty: number;
  amounts: Array<{ currency: string; amount: number }>;
}
export interface BacklogRow { bucket: OrderBucket; customerId: string; customerName: string; currency: string; openQty: number; overdueQty: number; openAmount: number; earliestDeadline: string | null }
export interface FulfillmentBucket { bucket: OrderBucket; orderCount: number; onTime: number; lateCompleted: number; openLate: number; avgLateDays: number | null; shippedPct: number | null }
export interface DestinationMix {
  kapsam: { kurKaynagi: string; customersInPeriod: number; customersWithCountry: number };
  buckets: MixBucketSummary[];
  prevBuckets?: MixBucketSummary[];
  byCustomer: MixBreakdownRow[];
  byCountry: MixBreakdownRow[];
  byItem: MixBreakdownRow[];
  backlog: BacklogSummary[];
  backlogExport: BacklogRow[];
  fulfillment: FulfillmentBucket[];
}

export const destinationMixApi = {
  get: (p: ReportCompareParams) => reportsClient.get<DestinationMix>("sales/destination-mix", p),
};

export const BUCKET_LABELS: Record<MixBucket | OrderBucket, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
  NONE: "Yön kaydı yok (doğrudan sevk)",
  UNSET: "Yön belirsiz (kartta yön yok)",
};

const money = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tutar metni — fiyatlı satır yoksa "fiyat girilmemiş" (0 yazılmaz). */
export function amountText(m: MoneyAgg): string {
  if (m.pricedLineCount === 0) return m.lineCount === 0 ? "—" : "fiyat girilmemiş";
  return m.amounts.map((a) => `${a.currency} ${money(a.amount)}`).join(" · ");
}
/** Ortalama birim fiyat — para birimi başına; fiyat yoksa "—". */
export function avgPriceText(m: MoneyAgg): string {
  return m.amounts.length === 0 ? "—" : m.amounts.map((a) => `${a.currency} ${money(a.avgUnitPrice)}/m`).join(" · ");
}
export const pricedCoverageText = (m: MoneyAgg): string => `fiyatlı ${fmtInt(m.pricedLineCount)} / ${fmtInt(m.lineCount)} satır`;
/** TL karşılığı — yalnız kayıtlı kurla; kuru olmayan satır sayısı ayrıca söylenir. */
export function tlText(m: MoneyAgg): string {
  if (m.pricedLineCount === 0) return "—";
  return `TL ${money(m.tlTotal)}${m.noRateLineCount > 0 ? ` (kur yok: ${fmtInt(m.noRateLineCount)} satır hariç)` : ""}`;
}
/** Kg metni — tartısız çuval 0 değil "ölçülmedi". */
export function kgText(b: Pick<MixBucketSummary, "kg" | "weighedSacks" | "totalSacks">): string {
  if (b.totalSacks === 0) return "kg ölçülmez (çuval yok)";
  if (b.weighedSacks === 0) return `kg ölçülmedi (tartılı 0 / ${fmtInt(b.totalSacks)} çuval)`;
  return `${fmtNum(b.kg)} kg · tartılı ${fmtInt(b.weighedSacks)} / ${fmtInt(b.totalSacks)} çuval`;
}
/** Dönemin tutar kapsamı — ekranın başında durur. */
export function totalCoverage(buckets: MixBucketSummary[]): { priced: number; lines: number } {
  return buckets.reduce((a, b) => ({ priced: a.priced + b.money.pricedLineCount, lines: a.lines + b.money.lineCount }), { priced: 0, lines: 0 });
}

function breakdownTable(name: string, labelHeader: string, rows: MixBreakdownRow[], extra?: "country" | "customerCount"): ReportTableSpec {
  return {
    name,
    columns: [
      { header: labelHeader, key: "label", width: 28 },
      ...(extra === "country" ? [{ header: "Ülke", key: "country", width: 16 }] : []),
      ...(extra === "customerCount" ? [{ header: "Müşteri", key: "customerCount", width: 9, numFmt: "#,##0", align: "right" as const }] : []),
      { header: "Yön", key: "yon", width: 22 },
      { header: "Sevk (m)", key: "meters", width: 12, numFmt: "#,##0.0", align: "right" },
      { header: "Tutar", key: "tutar", width: 26 },
      { header: "Ort. birim fiyat", key: "ort", width: 24 },
      { header: "Fiyat kapsamı", key: "kapsam", width: 20 },
    ],
    rows: rows.map((r) => ({
      label: r.label, country: r.country ?? "", customerCount: r.customerCount ?? 0, yon: BUCKET_LABELS[r.bucket], meters: r.meters,
      tutar: amountText(r.money), ort: avgPriceText(r.money), kapsam: pricedCoverageText(r.money),
    })),
  };
}

export function buildDestinationMixExport(opts: { r: DestinationMix; periodLabel: string; compareLabel: string | null }): ReportExportSpec {
  const { r, periodLabel, compareLabel } = opts;
  const cov = totalCoverage(r.buckets);
  const meta = [
    "Sevk tarafı sevkiyatın SEVK ANINDA donmuş yönünü okur; fasondan doğrudan sevkin yön kaydı yoktur (ayrı satır).",
    "Metre BRÜT'tür (iade düşülmez, ayrı sütunda). Kg sevk anındaki brüt çuval tartısıdır; tartısız çuval ölçülmedi sayılır.",
    `Tutar = sevk anındaki tahsis × sipariş satırı fiyatı, para birimleri ayrı. Kapsam: fiyatlı ${cov.priced} / ${cov.lines} satır.`,
    `TL karşılığı: ${r.kapsam.kurKaynagi}.`,
    `Ülke serbest metindir (düzeltilmez); ${r.kapsam.customersWithCountry} / ${r.kapsam.customersInPeriod} müşteride dolu.`,
    "Açık sipariş ve termin siparişin AÇILIŞTA donmuş yönünü okur (cari kartı sonradan değişse de küme değişmez).",
  ];
  if (compareLabel) meta.push(`Karşılaştırma dönemi: ${compareLabel}`);
  const kova = (b: MixBucketSummary) => ({
    yon: b.label, meters: b.meters, rollCount: b.rollCount, shipmentCount: b.shipmentCount, kg: kgText(b), iade: b.returnQty,
    tutar: amountText(b.money), tl: tlText(b.money), kapsam: pricedCoverageText(b.money),
  });
  return {
    title: "Yurtiçi / Yurtdışı Satış",
    subtitle: periodLabel,
    meta,
    orientation: "landscape",
    tables: [
      {
        name: "Yön Dağılımı",
        columns: [
          { header: "Yön", key: "yon", width: 26 },
          { header: "Sevk (m)", key: "meters", width: 12, numFmt: "#,##0.0", align: "right" },
          { header: "Top", key: "rollCount", width: 8, numFmt: "#,##0", align: "right" },
          { header: "Sevk sayısı", key: "shipmentCount", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Kg (brüt)", key: "kg", width: 30 },
          { header: "İade (m)", key: "iade", width: 10, numFmt: "#,##0.0", align: "right" },
          { header: "Tutar", key: "tutar", width: 26 },
          { header: "TL karşılığı", key: "tl", width: 28 },
          { header: "Fiyat kapsamı", key: "kapsam", width: 20 },
        ],
        rows: [...r.buckets.map(kova), ...(r.prevBuckets ?? []).map((b) => ({ ...kova(b), yon: `Önceki dönem · ${b.label}` }))],
      },
      breakdownTable("Müşteri", "Müşteri", r.byCustomer, "country"),
      breakdownTable("Ülke", "Ülke", r.byCountry, "customerCount"),
      breakdownTable("Ürün", "Ürün", r.byItem),
      {
        name: "Açık Sipariş ve Termin",
        columns: [
          { header: "Yön (sipariş açılışında)", key: "yon", width: 28 },
          { header: "Açık (m)", key: "openQty", width: 12, numFmt: "#,##0.0", align: "right" },
          { header: "Termini geçen (m)", key: "overdueQty", width: 16, numFmt: "#,##0.0", align: "right" },
          { header: "Açık tutar", key: "tutar", width: 26 },
          { header: "Termini dönemde", key: "orderCount", width: 14, numFmt: "#,##0", align: "right" },
          { header: "Zamanında", key: "onTime", width: 11, numFmt: "#,##0", align: "right" },
          { header: "Geç kapanan", key: "late", width: 12, numFmt: "#,##0", align: "right" },
          { header: "Gerçekleşme %", key: "pct", width: 14 },
        ],
        rows: r.backlog.map((b) => {
          const f = r.fulfillment.find((x) => x.bucket === b.bucket);
          return {
            yon: b.label, openQty: b.openQty, overdueQty: b.overdueQty,
            tutar: b.amounts.length ? b.amounts.map((a) => `${a.currency} ${money(a.amount)}`).join(" · ") : "fiyat girilmemiş",
            orderCount: f?.orderCount ?? 0, onTime: f?.onTime ?? 0, late: f?.lateCompleted ?? 0,
            pct: f?.shippedPct == null ? "—" : `%${fmtNum(f.shippedPct)}`,
          };
        }),
        notes: ["Açık sipariş BUGÜNÜN durumudur (dönemden bağımsız); termin satırları termini dönem içinde olan siparişlerdir."],
      },
    ],
  };
}
