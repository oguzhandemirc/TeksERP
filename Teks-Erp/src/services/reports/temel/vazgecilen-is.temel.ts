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
import { getOrderCancellationScorecard, type OrderCancellationSummary } from "../order-cancellation.report.service";
import { getReturnScorecard, type ReturnScorecardSummary } from "../return-scorecard.report.service";
import type { CompareMode, DateRange } from "../_shared";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, rangeParameters, type CoreReportResult } from "./_common";

export interface LostWorkReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  /** Uygulanan kıyas kipi (K-KIYAS: `resolveCoreCompare`). */
  compareMode: CompareMode;
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

  const table = lostWorkTable(r, c);
  const capped = capTable(table, "İade ve iptal");

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
      parametreler: rangeParameters(range, input.compareMode),
      uyarilar: capped.uyarilar,
    },
  };
}
