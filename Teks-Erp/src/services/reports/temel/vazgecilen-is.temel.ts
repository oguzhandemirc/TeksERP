// =============================================================================
// Temel rapor 8 — "Ne geri geldi, neden vazgeçildi?" (`sales/vazgecilen-is`)
// =============================================================================
// Kaynak: İade Karnesi (`getReturnScorecard`) + Sipariş İptal Karnesi
// (`getOrderCancellationScorecard`). İade ve iptal İKİ AYRI satırdır; ana sayı ikisinin
// metre toplamıdır. İptal oranı TEK tanımdan: iptal karnesinin `cancelRatePct`si (çıpa
// iptal anı) — Sipariş Karnesi'nin `cancelledPct`si (çıpa sipariş tarihi) KULLANILMAZ.
// Süzgeç yok: iki kaynağın yön anlamı farklı (iade = sevkin donmuş yönü, iptal = sipariş yönü).

import { anlatiUret } from "../anlati/anlati";
import { round1 } from "../_breakdown";
import { factoryDateTr } from "../../../constants/time";
import type { BreakdownRow } from "../_breakdown";
import { getOrderCancellationScorecard, type OrderCancellationReport, type OrderCancellationSummary } from "../order-cancellation.report.service";
import { getReturnScorecard, type ReturnScorecard, type ReturnScorecardSummary } from "../return-scorecard.report.service";
import type { CompareMode, DateRange } from "../_shared";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, rangeParameters, viewParameter, type CoreReportResult } from "./_common";

/** Tablo görünümleri — eski İptal Karnesi ve İade Karnesi'nin listeleri (aynı servis, aynı süzgeçsiz dönem). */
export const LOST_WORK_VIEWS = ["ozet", "iptaller", "iptalSebep", "iptalMusteri", "iadeMusteri", "iadeKumas", "iadeRenk", "iadeSebep"] as const;
export type LostWorkView = (typeof LOST_WORK_VIEWS)[number];
const LOST_WORK_VIEW_LABEL: Readonly<Record<LostWorkView, string>> = {
  ozet: "Özet",
  iptaller: "İptal edilen siparişler",
  iptalSebep: "İptal sebepleri",
  iptalMusteri: "İptal: müşteri",
  iadeMusteri: "İade: müşteri",
  iadeKumas: "İade: kumaş",
  iadeRenk: "İade: renk",
  iadeSebep: "İade sebepleri",
};

export interface LostWorkReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  /** Uygulanan kıyas kipi (K-KIYAS: `resolveCoreCompare`). */
  compareMode: CompareMode;
  /** Tablo görünümü; yoksa `ozet`. */
  view?: LostWorkView;
}

function returnTable(first: string, rows: readonly BreakdownRow[], withCompare: boolean): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ad", baslik: first, hiza: "sol" },
      { anahtar: "top", baslik: "Top", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "İade", birim: "m", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "onceki", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: rows.map((r) => ({ ad: r.label, top: r.count, metre: r.qty, ...(withCompare ? { onceki: r.prevQty ?? null } : {}) })),
  };
}

/** Görünüm → tablo; her satır eski karnenin aynı alanı (`test_temel_rapor_esitlik` §S5v). */
export function lostWorkViewTable(view: LostWorkView, returns: ReturnScorecard, cancels: OrderCancellationReport, withCompare: boolean): TabloBlok {
  switch (view) {
    case "ozet":
      return lostWorkTable(returns.summary, cancels.summary);
    case "iptaller":
      return {
        kolonlar: [
          { anahtar: "siparis", baslik: "Sipariş", hiza: "sol" },
          { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
          { anahtar: "iptalGunu", baslik: "İptal günü", hiza: "sol" },
          { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
          { anahtar: "sevkEdilen", baslik: "Sevk edilmiş", birim: "m", hiza: "sag" },
          { anahtar: "gun", baslik: "Açılıştan iptale", birim: "gun", hiza: "sag" },
          { anahtar: "sebep", baslik: "Sebep", hiza: "sol" },
        ],
        satirlar: cancels.orders.map((o) => ({
          siparis: o.orderNumber, musteri: o.customerName, iptalGunu: factoryDateTr(new Date(o.cancelledAt)),
          metre: o.qty, sevkEdilen: o.shippedQty, gun: o.daysToCancel, sebep: o.reasonLabel ?? "Sebep girilmemiş",
        })),
      };
    case "iptalSebep":
      return {
        kolonlar: [
          { anahtar: "sebep", baslik: "Sebep", hiza: "sol" },
          { anahtar: "adet", baslik: "Sipariş", birim: "siparis", hiza: "sag" },
          { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
          { anahtar: "pay", baslik: "Pay", birim: "yuzde", hiza: "sag" },
        ],
        satirlar: cancels.byReason.map((r) => ({ sebep: r.label, adet: r.count, metre: r.qty, pay: r.sharePct })),
      };
    case "iptalMusteri":
      return {
        kolonlar: [
          { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
          { anahtar: "adet", baslik: "İptal", birim: "siparis", hiza: "sag" },
          { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
          { anahtar: "oran", baslik: "İptal oranı", birim: "yuzde", hiza: "sag" },
          { anahtar: "sebep", baslik: "En sık sebep", hiza: "sol" },
        ],
        satirlar: cancels.byCustomer.map((r) => ({ musteri: r.customerName, adet: r.count, metre: r.qty, oran: r.cancelRatePct, sebep: r.topReasonLabel })),
      };
    case "iadeMusteri":
      return returnTable("Müşteri", returns.byCustomer, withCompare);
    case "iadeKumas":
      return returnTable("Kumaş", returns.byItem, withCompare);
    case "iadeRenk":
      return returnTable("Renk", returns.byColor, withCompare);
    case "iadeSebep":
      return returnTable("Sebep", returns.byReason, withCompare);
  }
}

/** İade ve iptal İKİ AYRI satır; toplam yalnız metrede. */
function lostWorkTable(r: ReturnScorecardSummary, c: OrderCancellationSummary): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "tur", baslik: "Ne oldu", hiza: "sol" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      { anahtar: "adet", baslik: "Adet", hiza: "sag" },
      { anahtar: "sayilan", baslik: "Sayılan", hiza: "sol" },
    ],
    satirlar: [
      { tur: "İade gelen", metre: r.returnQty, adet: r.returnRollCount, sayilan: "top" },
      { tur: "İptal edilen sipariş", metre: c.cancelledQty, adet: c.cancelledCount, sayilan: "sipariş" },
    ],
    toplam: { tur: "Toplam", metre: round1(r.returnQty + c.cancelledQty), adet: null, sayilan: null },
  };
}

export async function buildLostWorkReport(input: LostWorkReportInput): Promise<CoreReportResult> {
  const { range, compareRange } = input;
  const [returns, cancels, prevCancels] = await Promise.all([
    getReturnScorecard(range, compareRange),
    getOrderCancellationScorecard(range),
    compareRange ? getOrderCancellationScorecard(compareRange) : Promise.resolve(null),
  ]);
  const r = returns.summary;
  const c = cancels.summary;

  const mainFigure = plainFigure("vazgecilen.metre", "İade ve iptal", round1(r.returnQty + c.cancelledQty), { unit: "m",
    direction: "asagi",
    ...(prevCancels ? { previous: round1((r.prevReturnQty ?? 0) + prevCancels.summary.cancelledQty) } : {}),
  });
  const sideFigures = [
    metricFigure("siparis.iptalOrani", c.cancelRatePct, {
      unmeasured: "Bu dönemde açılan sipariş yok",
      ...(prevCancels ? { previous: prevCancels.summary.cancelRatePct } : {}),
    }),
    metricFigure("iade.oran", r.shippedQty > 0 ? r.returnPct : null, {
      unmeasured: "Bu dönemde sevk yok",
      ...(compareRange ? { previous: (r.prevShippedQty ?? 0) > 0 ? (r.prevReturnPct ?? null) : null } : {}),
    }),
    plainFigure("siparis.iptalAdedi", "İptal edilen sipariş", c.cancelledCount, { unit: "siparis",
      direction: "asagi",
      ...(prevCancels ? { previous: prevCancels.summary.cancelledCount } : {}),
    }),
  ];

  const reasonRows = [
    ...returns.byReason.map((x) => ({ ad: `İade: ${x.label}`, deger: x.qty })),
    ...cancels.byReason.map((x) => ({ ad: `İptal: ${x.label}`, deger: x.qty })),
  ].sort((a, b) => b.deger - a.deger || (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0));

  const chart: GrafikBlok | null = reasonRows.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Sebep", tur: "kategori" }, y: { ad: "Metre", birim: "m" } },
        kategoriler: reasonRows.map((x) => x.ad),
        seriler: [{ ad: "Metre", veri: reasonRows.map((x) => x.deger) }],
      }
    : null;

  const view = input.view ?? "ozet";
  const table = lostWorkViewTable(view, returns, cancels, compareRange !== null);
  const capped = capTable(table, LOST_WORK_VIEW_LABEL[view]);

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "iade geldi ya da iptal edildi" },
    veri: { satirSayisi: r.returnRollCount + c.cancelledCount },
    kirilim: { boyut: "sebep", birim: "m", adTuru: "ozel", satirlar: reasonRows },
    kapsam: [
      { sayi: c.undatedCancelCount, nesne: "iptal", neden: "İptal anı kaydı olmayan (eski)", sonuc: "hiçbir döneme yazılmadı" },
      { sayi: r.missingReasonCount, nesne: "iade", neden: "Sebebi girilmemiş", sonuc: "sebepsiz kovasında" },
    ],
  });

  return {
    sunum: {
      ...catalogHeader("sales/vazgecilen-is"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["siparis.iptalOrani", "iade.oran"]),
      parametreler: [...rangeParameters(range, input.compareMode), viewParameter(LOST_WORK_VIEW_LABEL, view)],
      uyarilar: capped.uyarilar,
    },
  };
}
