// =============================================================================
// "Ne sevk ettik?" TABLO GÖRÜNÜMLERİ — eski Yurtiçi/Yurtdışı Satış kırılımları (2026-11-12)
// =============================================================================
// Ana/yan sayı, grafik ve anlatı Sevkiyat raporundan gelir; görünüm yalnız `tablo`yu eski
// raporun kendi servisinden (`getDestinationMix`) kurar — sayı burada hesaplanmaz (bekçi
// `test_temel_rapor_esitlik` §S2y hücre hücre ölçer). Yön süzgeci aynı kovayı seçer.
// Yurtdışı açık sipariş / termin tablosu TAŞINMAZ (gecikme ağırlıklı; Açık Siparişler ve Termin raporları).

import type { ShipmentDestination } from "@prisma/client";
import { getDestinationMix, type MixBreakdownRow, type MixBucketSummary } from "../destination-mix.report.service";
import type { MoneyAgg } from "../_destination-mix-money";
import type { DateRange } from "../_shared";
import type { TabloBlok, TabloHucresi } from "../sunum/sunum.types";

export const SHIPPED_VIEWS = ["ozet", "yon", "tutar", "musteri", "ulke", "kumas"] as const;
export type ShippedView = (typeof SHIPPED_VIEWS)[number];
export const SHIPPED_VIEW_LABEL: Readonly<Record<ShippedView, string>> = {
  ozet: "Müşteri",
  yon: "Yön (yurtiçi / yurtdışı)",
  tutar: "Yön × para birimi",
  musteri: "Müşteri × yön",
  ulke: "Ülke × yön",
  kumas: "Kumaş × yön",
};
/** TL karşılığı yalnız sevk gününün kayıtlı kuruyla (eski raporun kur kuralı) — ekranda söylenir. */
export const TL_VIEW_NOTE = "TL karşılığı yalnız sevk gününün kayıtlı kuruyla hesaplanır; kuru olmayan satır katılmaz.";

/** Fiyatlı satır yoksa TL karşılığı ölçülmedi (0 değil). */
const tlOf = (m: MoneyAgg): TabloHucresi => (m.pricedLineCount === 0 ? null : m.tlTotal);

function bucketTable(buckets: readonly MixBucketSummary[], prev: readonly MixBucketSummary[] | undefined): TabloBlok {
  const withCompare = prev !== undefined;
  return {
    kolonlar: [
      { anahtar: "yon", baslik: "Yön", hiza: "sol" },
      { anahtar: "sevk", baslik: "Sevkiyat", birim: "adet", hiza: "sag" },
      { anahtar: "top", baslik: "Top", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "Sevk edilen", birim: "m", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "oncekiMetre", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
      { anahtar: "kg", baslik: "Tartılan", birim: "kg", hiza: "sag" },
      { anahtar: "cuval", baslik: "Tartılı / toplam çuval", hiza: "sag" },
      { anahtar: "iade", baslik: "İade (brütten düşülmez)", birim: "m", hiza: "sag" },
      { anahtar: "tl", baslik: "TL karşılığı", birim: "TRY", hiza: "sag" },
    ],
    satirlar: buckets.map((b) => ({
      yon: b.label, sevk: b.shipmentCount, top: b.rollCount, metre: b.meters,
      ...(withCompare ? { oncekiMetre: prev.find((p) => p.bucket === b.bucket)?.meters ?? 0 } : {}),
      kg: b.weighedSacks > 0 ? b.kg : null, cuval: `${b.weighedSacks} / ${b.totalSacks}`, iade: b.returnQty, tl: tlOf(b.money),
    })),
  };
}

/** Kova × para birimi — tutarlar AYRI kalır (çevrim uydurulmaz); fiyatsız kovada tek "fiyat girilmemiş" satırı. */
function moneyTable(buckets: readonly MixBucketSummary[]): TabloBlok {
  const rows: Record<string, TabloHucresi>[] = [];
  for (const b of buckets) {
    const coverage = { fiyatli: b.money.pricedLineCount, satir: b.money.lineCount };
    if (b.money.amounts.length === 0) rows.push({ yon: b.label, para: "fiyat girilmemiş", tutar: null, ortFiyat: null, ...coverage });
    for (const a of b.money.amounts) rows.push({ yon: b.label, para: a.currency, tutar: a.amount, ortFiyat: a.avgUnitPrice, ...coverage });
  }
  return {
    kolonlar: [
      { anahtar: "yon", baslik: "Yön", hiza: "sol" },
      { anahtar: "para", baslik: "Para birimi", hiza: "sol" },
      { anahtar: "tutar", baslik: "Tutar", hiza: "sag" },
      { anahtar: "ortFiyat", baslik: "Ort. birim fiyat (/m)", hiza: "sag" },
      { anahtar: "fiyatli", baslik: "Fiyatlı satır", birim: "adet", hiza: "sag" },
      { anahtar: "satir", baslik: "Toplam satır", birim: "adet", hiza: "sag" },
    ],
    satirlar: rows,
  };
}

function breakdownTable(first: string, rows: readonly MixBreakdownRow[], extra?: "country" | "customerCount"): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ad", baslik: first, hiza: "sol" },
      ...(extra === "country" ? [{ anahtar: "ulke", baslik: "Ülke", hiza: "sol" as const }] : []),
      ...(extra === "customerCount" ? [{ anahtar: "musteri", baslik: "Müşteri", birim: "adet" as const, hiza: "sag" as const }] : []),
      { anahtar: "yon", baslik: "Yön", hiza: "sol" },
      { anahtar: "metre", baslik: "Sevk edilen", birim: "m", hiza: "sag" },
      { anahtar: "tl", baslik: "TL karşılığı", birim: "TRY", hiza: "sag" },
      { anahtar: "fiyatli", baslik: "Fiyatlı satır", birim: "adet", hiza: "sag" },
      { anahtar: "satir", baslik: "Toplam satır", birim: "adet", hiza: "sag" },
    ],
    satirlar: rows.map((r) => ({
      ad: r.label,
      ...(extra === "country" ? { ulke: r.country ?? null } : {}),
      ...(extra === "customerCount" ? { musteri: r.customerCount ?? 0 } : {}),
      yon: BUCKET_SHORT[r.bucket], metre: r.meters, tl: tlOf(r.money), fiyatli: r.money.pricedLineCount, satir: r.money.lineCount,
    })),
  };
}

const BUCKET_SHORT: Readonly<Record<MixBreakdownRow["bucket"], string>> = { DOMESTIC: "Yurtiçi", EXPORT: "Yurtdışı", NONE: "Yön kaydı yok" };

/** Görünümün kaynağı: eski Yurtiçi/Yurtdışı servisi, raporun kıyas dönemiyle; yön süzgeci kovayı seçer. */
export async function loadShippedView(
  view: Exclude<ShippedView, "ozet">,
  range: DateRange,
  compareRange: DateRange | null,
  destination: ShipmentDestination | undefined,
): Promise<{ table: TabloBlok; notes: string[] }> {
  const r = await getDestinationMix(range, compareRange);
  const keep = <T extends { bucket: string }>(rows: readonly T[]): T[] => rows.filter((x) => !destination || x.bucket === destination);
  const notes = view === "musteri" || view === "ulke" || view === "kumas" || view === "yon" ? [TL_VIEW_NOTE] : [];
  switch (view) {
    case "yon":
      return { table: bucketTable(keep(r.buckets), r.prevBuckets ? keep(r.prevBuckets) : undefined), notes };
    case "tutar":
      return { table: moneyTable(keep(r.buckets)), notes };
    case "musteri":
      return { table: breakdownTable("Müşteri", keep(r.byCustomer), "country"), notes };
    case "ulke":
      return { table: breakdownTable("Ülke", keep(r.byCountry), "customerCount"), notes };
    case "kumas":
      return { table: breakdownTable("Kumaş", keep(r.byItem)), notes };
  }
}
