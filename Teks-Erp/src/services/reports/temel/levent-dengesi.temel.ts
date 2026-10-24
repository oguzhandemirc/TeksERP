// =============================================================================
// Temel rapor 13 — "Leventten beklenen kumaş çıktı mı?" (`dokuma/levent-dengesi`)
// =============================================================================
// Kaynak: Levent Sonucu (`beamResultReport`, aynı gün aralığı). Ana sayı levent dengesi = biten ve
// beklenen kumaşı BİLİNEN leventlerde dokunan / beklenen. Beklenen kumaşı bilinmeyen (çekme payı
// girilmemiş) levent orana 0 metre olarak GİRMEZ — ayrı "ölçülemeyen levent" sayısıdır.
// Fark metresi Levent Sonucu'nun `ozet.fireM`idir; fire tanımı "Ne kaybettik?" raporunda.

import { anlatiUret } from "../anlati/anlati";
import { roundM, shareOfPct } from "../../helpers/dokuma-levent-rapor.helper";
import { beamResultReport, type BeamResultRow } from "../levent-sonucu.report.service";
import type { GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, periodOf, plainFigure, type CoreReportResult } from "./_common";
import { dayRangeParameters, type ResolvedDayRange } from "./_day-range";

export interface BeamBalance {
  /** Beklenen kumaşı bilinen biten leventlerin beklenen toplamı (= Levent Sonucu `ozet.beklenenM`). */
  expectedM: number;
  /** Aynı leventlerde gerçekten dokunan. */
  wovenM: number;
  balancePct: number | null;
  /** Beklenen kumaşı bilinmeyen biten levent sayısı (= `ozet.olculemedi`). */
  unmeasured: number;
}

/** Levent dengesi — ölçülemeyen levent pay da payda da OLMAZ (sıfıra çökmez). */
export function beamBalance(closed: ReadonlyArray<Pick<BeamResultRow, "beklenenKumasM" | "gercekKumasM">>): BeamBalance {
  const measurable = closed.filter((r) => r.beklenenKumasM !== null);
  const expectedM = roundM(measurable.reduce((a, r) => a + (r.beklenenKumasM ?? 0), 0));
  const wovenM = roundM(measurable.reduce((a, r) => a + r.gercekKumasM, 0));
  return { expectedM, wovenM, balancePct: measurable.length > 0 ? shareOfPct(wovenM, expectedM) : null, unmeasured: closed.length - measurable.length };
}

export interface BeamBalanceInput {
  window: ResolvedDayRange;
}

function beamTable(closed: BeamResultRow[], bal: BeamBalance, fireM: number): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "levent", baslik: "Levent", hiza: "sol" },
      { anahtar: "cozgu", baslik: "Çözgü kartı", hiza: "sol" },
      { anahtar: "beklenen", baslik: "Beklenen", birim: "m", hiza: "sag" },
      { anahtar: "dokunan", baslik: "Dokunan", birim: "m", hiza: "sag" },
      { anahtar: "fark", baslik: "Fark", birim: "m", hiza: "sag" },
      { anahtar: "denge", baslik: "Denge", birim: "yuzde", hiza: "sag" },
      { anahtar: "not", baslik: "Not", hiza: "sol" },
    ],
    satirlar: closed.map((r) => ({
      levent: r.physicalBeamNo ? `${r.beamNo} (${r.physicalBeamNo})` : r.beamNo,
      cozgu: `${r.warpSpec.code} · ${r.warpSpec.name}`,
      beklenen: r.beklenenKumasM,
      dokunan: r.gercekKumasM,
      fark: r.fireM,
      denge: beamBalance([r]).balancePct,
      not: r.beklenenKumasM === null ? "Çekme payı girilmemiş; beklenen kumaş hesaplanamadı" : null,
    })),
    toplam: { levent: "Toplam (ölçülebilenler)", beklenen: bal.expectedM, dokunan: bal.wovenM, fark: fireM, denge: bal.balancePct },
  };
}

export async function buildBeamBalanceReport(input: BeamBalanceInput): Promise<CoreReportResult> {
  const { days, range, compareDays, compareRange, mode } = input.window;
  const [now, prev] = await Promise.all([
    beamResultReport({ from: days.from, to: days.to }),
    compareDays ? beamResultReport({ from: compareDays.from, to: compareDays.to }) : Promise.resolve(null),
  ]);
  const closed = now.data.kapananlar;
  const o = now.data.ozet;
  const bal = beamBalance(closed);
  const prevBal = prev ? beamBalance(prev.data.kapananlar) : null;

  const mainFigure = metricFigure("levent.dengeYuzde", bal.balancePct, {
    unmeasured: closed.length === 0 ? "Bu dönemde biten levent yok" : "Biten leventlerin hiçbirinde beklenen kumaş bilinmiyor",
    ...(prevBal ? { previous: prevBal.balancePct } : {}),
  });
  const sideFigures = [
    metricFigure("fire.leventMetre", bal.balancePct === null ? null : o.fireM, {
      name: "Beklenenle dokunan farkı",
      unmeasured: "Beklenen kumaşı bilinen levent yok",
      ...(prev && prevBal?.balancePct !== null ? { previous: prev.data.ozet.fireM } : {}),
    }),
    plainFigure("levent.olculemeyen", "Beklenen kumaşı bilinmeyen levent", bal.unmeasured, { unit: "levent", direction: "asagi" }),
    plainFigure("levent.biten", "Biten levent", o.leventSayisi, { unit: "levent", ...(prev ? { previous: prev.data.ozet.leventSayisi } : {}) }),
  ];

  const table = beamTable(closed, bal, o.fireM);
  const capped = capTable(table, "Biten leventler");

  const measurable = closed.filter((r) => r.beklenenKumasM !== null).slice(0, 20);
  const chart: GrafikBlok | null = measurable.length
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Levent", tur: "kategori" }, y: { ad: "Kumaş", birim: "m" } },
        kategoriler: measurable.map((r) => r.beamNo),
        seriler: [
          { ad: "Beklenen", veri: measurable.map((r) => r.beklenenKumasM), soluk: true },
          { ad: "Dokunan", veri: measurable.map((r) => r.gercekKumasM) },
        ],
      }
    : null;

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "beklenen kumaşa ulaştı", ozne: "Biten leventler" },
    veri: { satirSayisi: closed.length },
    kapsam: bal.unmeasured > 0 ? [{ sayi: bal.unmeasured, nesne: "levent", neden: "Beklenen kumaşı bilinmeyen", sonuc: "orana katılmadı" }] : [],
  });

  return {
    sunum: {
      ...catalogHeader("dokuma/levent-dengesi"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["levent.dengeYuzde", "fire.leventMetre"]),
      parametreler: dayRangeParameters(days, mode),
      uyarilar: capped.uyarilar,
    },
  };
}
